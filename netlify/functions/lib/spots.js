// Group hail reports into neighborhood-sized "spots", score and rank them.
import { haversineMiles } from "./geo.js";
import { scoreArea } from "./history.js";

const BIN = 0.12; // ~8 miles

export function clusterSpots(reports, { today = new Date() } = {}) {
  const bins = new Map();
  for (const r of reports) {
    const key = `${Math.round(r.lat / BIN)}:${Math.round(r.lon / BIN)}`;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(r);
  }
  const spots = [];
  for (const [key, rs] of bins) {
    // Center on the biggest hail in the bin, not the average.
    const top = rs.reduce((a, b) => (b.sizeInches > a.sizeInches ? b : a));
    const base = scoreArea(rs, { today });
    const venues = new Set(rs.flatMap((r) => r.sources || [r.source]));
    let score = base.score;
    const reasons = base.reasons.slice();
    if (venues.size >= 2 && base.maxHail >= 1) {
      score = Math.min(10, score + 1);
      reasons.splice(1, 0, `Confirmed by ${venues.size} independent sources (${[...venues].join(", ")}).`);
    }
    spots.push({
      key,
      lat: top.lat,
      lon: top.lon,
      place: [top.location, top.county ? `${top.county} Co.` : "", top.state].filter(Boolean).join(", "),
      score,
      verdict: score >= 7 ? "go" : score >= 5 ? "maybe" : "skip",
      maxHail: base.maxHail,
      count: rs.length,
      newest: base.newest,
      venues: [...venues],
      reasons,
    });
  }
  spots.sort((a, b) => b.score - a.score || b.maxHail - a.maxHail || b.count - a.count);
  return spots;
}

export function nearestSpot(spots, lat, lon) {
  return spots.map((s) => ({ s, d: haversineMiles(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
}
