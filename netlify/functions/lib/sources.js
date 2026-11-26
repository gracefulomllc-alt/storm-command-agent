// Multiple research "venues" for hail. Every venue reports its own status so
// the dashboard can show which ones contributed and which failed.
//   spc    - NOAA Storm Prediction Center daily hail reports (historical + today)
//   lsr    - NWS Local Storm Reports via Iowa Environmental Mesonet (independent feed)
//   radar  - live NEXRAD storm-cell hail estimates via IEM (current storms only)
import { daysBetween, parseDay, spcUrlFor, ymd } from "./history.js";

const IEM = "https://mesonet.agron.iastate.edu";

async function getJSON(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export async function fetchSPC(from, to, store) {
  const today = ymd(new Date());
  const days = daysBetween(from, to);
  const out = [];
  let failed = 0;
  for (let i = 0; i < days.length; i += 8) {
    const batch = await Promise.all(
      days.slice(i, i + 8).map(async (d) => {
        const key = `spc-day-${d}`;
        if (d < today && store) {
          try {
            const c = await store.get(key, { type: "json" });
            if (c) return c;
          } catch {}
        }
        try {
          const res = await fetch(spcUrlFor(d));
          if (res.status === 404) return [];
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const rows = parseDay(await res.text(), d);
          if (d < today && store) {
            try { await store.setJSON(key, rows); } catch {}
          }
          return rows;
        } catch {
          failed++;
          return [];
        }
      })
    );
    batch.forEach((b) => out.push(...b));
  }
  return {
    reports: out.map((r) => ({ ...r, source: "spc" })),
    status: { id: "spc", name: "NOAA storm reports", ok: failed < days.length, detail: failed ? `${failed} of ${days.length} days failed` : `${out.length} reports` },
  };
}

export async function fetchLSR(from, to) {
  try {
    const q = new URLSearchParams({ states: "CO,WY", sts: `${from}T00:00Z`, ets: `${to}T23:59Z` });
    const data = await getJSON(`${IEM}/geojson/lsr.geojson?${q}`);
    const reports = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      const label = String(p.typetext || p.type || "").toUpperCase();
      if (!label.includes("HAIL") && p.type !== "H") continue;
      const size = parseFloat(p.magnitude);
      if (!(size > 0)) continue;
      const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      if (typeof lat !== "number") continue;
      reports.push({
        date: String(p.valid || "").slice(0, 10),
        sizeInches: size,
        lat, lon,
        location: p.city || p.county || "",
        county: p.county || "",
        state: p.state || "",
        source: "lsr",
      });
    }
    return { reports, status: { id: "lsr", name: "NWS local storm reports", ok: true, detail: `${reports.length} reports` } };
  } catch (e) {
    return { reports: [], status: { id: "lsr", name: "NWS local storm reports", ok: false, detail: e.message } };
  }
}

// Live radar-derived hail cells (what radar thinks is falling right now).
export async function fetchRadarCells() {
  try {
    const data = await getJSON(`${IEM}/geojson/nexrad_attr.py`);
    const cells = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      const size = parseFloat(p.max_size);
      const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      if (!(size >= 1) || typeof lat !== "number") continue;
      if (lat < 36.5 || lat > 45.5 || lon < -112 || lon > -101) continue; // CO/WY box
      cells.push({ date: ymd(new Date()), sizeInches: size, lat, lon, location: "radar-detected cell", county: "", state: "", source: "radar", posh: p.posh });
    }
    return { reports: cells, status: { id: "radar", name: "Live radar hail cells", ok: true, detail: `${cells.length} cells ≥1"` } };
  } catch (e) {
    return { reports: [], status: { id: "radar", name: "Live radar hail cells", ok: false, detail: e.message } };
  }
}

// Same hail often appears in both SPC and LSR. Merge near-duplicates and
// remember which venues agreed.
export function mergeReports(lists) {
  const merged = [];
  for (const r of lists.flat()) {
    const hit = merged.find(
      (m) => m.date === r.date && Math.abs(m.lat - r.lat) < 0.06 && Math.abs(m.lon - r.lon) < 0.06 && Math.abs(m.sizeInches - r.sizeInches) < 0.26
    );
    if (hit) {
      if (!hit.sources.includes(r.source)) hit.sources.push(r.source);
      hit.sizeInches = Math.max(hit.sizeInches, r.sizeInches);
    } else {
      merged.push({ ...r, sources: [r.source] });
    }
  }
  return merged;
}
