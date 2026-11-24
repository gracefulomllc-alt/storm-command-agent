// GET /api/history?from=YYYY-MM-DD&to=YYYY-MM-DD&lat=..&lon=..&radius=<miles>
// Pulls SPC hail reports for each day, keeps those inside the circle, scores the area.
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { haversineMiles } from "./lib/geo.js";
import { daysBetween, parseDay, scoreArea, spcUrlFor, ymd } from "./lib/history.js";

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
  const all: any[] = [];
  let failed = 0;
  // Fetch in batches of 8 so we don't hammer SPC.
  for (let i = 0; i < days.length; i += 8) {
    const batch = await Promise.all(days.slice(i, i + 8).map((d) => loadDay(store, d, todayStr)));
    for (const b of batch) {
      if (!b.ok) failed++;
      all.push(...b.reports);
    }
  }

  const inside = all
    .map((r) => ({ ...r, distMi: haversineMiles(lat, lon, r.lat, r.lon) }))
    .filter((r) => r.distMi <= radius)
    .sort((a, b) => b.sizeInches - a.sizeInches);

  const result = scoreArea(inside);
  return Response.json({
    from,
    to,
    center: { lat, lon },
    radiusMi: radius,
    daysChecked: days.length,
    daysFailed: failed,
    ...result,
    reports: inside.slice(0, 300),
  });
};

export const config: Config = { path: "/api/history" };
