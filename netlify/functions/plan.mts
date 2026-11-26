// The dispatch agent's daily plan.
//   GET  /api/plan?days=14   -> ranked best spots (multi-source) + suggested rep assignments
//   POST /api/plan {action:"approve", assignments:[{repId,address}]}  -> sends reps to their spots
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { getDatabase } from "@netlify/database";
import { distanceToI25Miles, formatAddressFromNominatim, reverseGeocode } from "./lib/geo.js";
import { ymd } from "./lib/history.js";
import { fetchLSR, fetchRadarCells, fetchSPC, mergeReports } from "./lib/sources.js";
import { clusterSpots } from "./lib/spots.js";

const db = getDatabase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function addressFor(spot: any, geoStore: any) {
  const key = `geo-${spot.key}`;
  try {
    const c = await geoStore.get(key, { type: "json" });
    if (c) return c.address;
  } catch {}
  try {
    await sleep(1100); // Nominatim allows ~1 request/second
    const data = await reverseGeocode(spot.lat, spot.lon);
    const address = formatAddressFromNominatim(data);
    if (address) {
      try { await geoStore.setJSON(key, { address }); } catch {}
      return address;
    }
  } catch {}
  return `${spot.lat.toFixed(4)}, ${spot.lon.toFixed(4)}`;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (req.method === "POST") {
      const b = await req.json();
      if (b.action !== "approve" || !Array.isArray(b.assignments) || !b.assignments.length) {
        return Response.json({ error: "Nothing to approve." }, { status: 400 });
      }
      for (const a of b.assignments) {
        await db.sql`UPDATE reps SET assigned_address = ${String(a.address).slice(0, 300)}, status = 'dispatched', updated_at = NOW() WHERE id = ${Number(a.repId)}`;
        await db.sql`INSERT INTO rep_activity_log (rep_id, event_type, event_value) VALUES (${Number(a.repId)}, 'dispatched', ${String(a.address).slice(0, 300)})`;
      }
      await db.sql`INSERT INTO dispatch_plans (assignments) VALUES (${JSON.stringify(b.assignments)}::jsonb)`;
      return Response.json({ ok: true, sent: b.assignments.length });
    }

    const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "14", 10) || 14, 1), 60);
    const today = new Date();
    const to = ymd(today);
    const from = ymd(new Date(today.getTime() - days * 86400000));
    const blobStore = getStore("storm-history");
    const geoStore = getStore("storm-geocode");

    const [spc, lsr, radar] = await Promise.all([fetchSPC(from, to, blobStore), fetchLSR(from, to), fetchRadarCells()]);
    const statuses = [spc.status, lsr.status, radar.status];
    const inRegion = (r: any) => (r.state === "CO" || r.state === "WY" || !r.state) && r.lat > 36.8 && r.lat < 45.1 && r.lon > -111.1 && r.lon < -102 && distanceToI25Miles(r.lat, r.lon) <= 60;
    const merged = mergeReports([spc.reports, lsr.reports, radar.reports].map((l) => l.filter(inRegion)));

    const spots = clusterSpots(merged).filter((s) => s.verdict !== "skip").slice(0, 5);
    for (const s of spots) (s as any).address = await addressFor(s, geoStore);

    const reps = await db.sql`SELECT id, name FROM reps WHERE active = TRUE ORDER BY name`;
    // Split reps across the top 3 spots, most to the best spot.
    const assignments: any[] = [];
    let left = reps.slice();
    const targets = spots.slice(0, 3);
    targets.forEach((s: any, i: number) => {
      const take = i === targets.length - 1 ? left.length : Math.ceil(left.length / 2);
      left.splice(0, take).forEach((r: any) => assignments.push({ repId: r.id, name: r.name, address: s.address, spotKey: s.key, place: s.place }));
    });

    return Response.json({ from, to, days, spots, statuses, reps: reps.length, assignments });
  } catch (err: any) {
    console.error("plan error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = { path: "/api/plan" };
