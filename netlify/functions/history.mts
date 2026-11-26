// GET /api/history?from=YYYY-MM-DD&to=YYYY-MM-DD&lat=..&lon=..&radius=<miles>
// Pulls SPC hail reports for each day, keeps those inside the circle, scores the area.
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { haversineMiles } from "./lib/geo.js";
import { daysBetween, scoreArea, ymd } from "./lib/history.js";
import { fetchLSR, fetchSPC, mergeReports } from "./lib/sources.js";

const MAX_SPAN_DAYS = 92;
const MAX_LOOKBACK_DAYS = 740; // ~2 years
const MAX_RADIUS_MI = 60;

async function loadDay(store: any, dateStr: string, todayStr: string) {
  const cacheKey = `spc-day-${dateStr}`;
  const cacheable = dateStr < todayStr; // past days don't change
  if (cacheable) {
    try {
      const cached = await store.get(cacheKey, { type: "json" });
      if (cached) return { reports: cached, ok: true };
    } catch {}
  }
  try {
    const res = await fetch(spcUrlFor(dateStr));
    if (res.status === 404) return { reports: [], ok: true }; // no file = no reports
    if (!res.ok) return { reports: [], ok: false };
    const reports = parseDay(await res.text(), dateStr);
    if (cacheable) {
      try {
        await store.setJSON(cacheKey, reports);
      } catch {}
    }
    return { reports, ok: true };
  } catch {
    return { reports: [], ok: false };
  }
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");
  let radius = parseFloat(url.searchParams.get("radius") || "");

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(from) || !dateRe.test(to) || from > to) {
    return Response.json({ error: "Pick a valid date range." }, { status: 400 });
  }
  if ([lat, lon, radius].some((n) => Number.isNaN(n))) {
    return Response.json({ error: "Pick an area on the map." }, { status: 400 });
  }
  radius = Math.min(Math.max(radius, 1), MAX_RADIUS_MI);

  const today = new Date();
  const todayStr = ymd(today);
  const earliest = ymd(new Date(today.getTime() - MAX_LOOKBACK_DAYS * 86400000));
  if (from < earliest || to > todayStr) {
    return Response.json({ error: "Dates must be within the last 2 years." }, { status: 400 });
  }
  const days = daysBetween(from, to);
  if (days.length > MAX_SPAN_DAYS) {
    return Response.json({ error: `Pick a range of ${MAX_SPAN_DAYS} days or less.` }, { status: 400 });
  }

  const store = getStore("storm-history");
  const [spc, lsr] = await Promise.all([fetchSPC(from, to, store), fetchLSR(from, to)]);
  const all: any[] = mergeReports([spc.reports, lsr.reports]);
  const failed = [spc.status, lsr.status].filter((x) => !x.ok).length;

  const inside = all
    .map((r) => ({ ...r, distMi: haversineMiles(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distMi <= radius)
    .sort((a, b) => b.sizeInches - a.sizeInches);

  const result = scoreArea(inside);
  const venues = new Set(inside.flatMap((r: any) => r.sources || []));
  if (venues.size >= 2 && result.maxHail >= 1) {
    result.score = Math.min(10, result.score + 1);
    result.verdict = result.score >= 7 ? "go" : result.score >= 5 ? "maybe" : "skip";
    result.verdictLabel = { go: "Go", maybe: "Maybe", skip: "Skip" }[result.verdict as "go" | "maybe" | "skip"];
    result.approvalPct = ({ 1: 3, 2: 8, 3: 15, 4: 25, 5: 38, 6: 52, 7: 65, 8: 76, 9: 85, 10: 90 } as any)[result.score];
    result.reasons.splice(1, 0, `Confirmed by ${venues.size} independent sources.`);
  }
  return Response.json({
    from,
    to,
    center: { lat, lon },
    radiusMi: radius,
    daysChecked: days.length,
    daysFailed: failed,
    sources: [spc.status, lsr.status],
    ...result,
    reports: inside.slice(0, 300),
  });
};

export const config: Config = { path: "/api/history" };
