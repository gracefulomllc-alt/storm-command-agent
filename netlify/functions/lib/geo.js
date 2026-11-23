// Geometry + geocoding helpers for Storm Command.

const RAD = Math.PI / 180;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Project a point forward along a bearing — used for storm-motion intercept.
export function destinationPoint(lat, lon, bearingDeg, distanceMi) {
  const R = 3958.8;
  const d = distanceMi / R;
  const brng = bearingDeg * RAD;
  const lat1 = lat * RAD;
  const lon1 = lon * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: lat2 / RAD, lon: lon2 / RAD };
}

// Area-weighted polygon centroid (shoelace formula). A plain vertex average
// is wrong on stretched/elongated NWS warning polygons — verified ~4-5mi off
// on a synthetic stretched quad during the original build. This is correct.
export function centroidOf(geometry) {
  if (!geometry) return null;
  let rings;
  if (geometry.type === "Polygon") rings = [geometry.coordinates[0]];
  else if (geometry.type === "MultiPolygon")
    rings = geometry.coordinates.map((p) => p[0]);
  else return null;

  let totalArea = 0;
  let cx = 0;
  let cy = 0;
  for (const ring of rings) {
    let area = 0;
    let rx = 0;
    let ry = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      rx += (x0 + x1) * cross;
      ry += (y0 + y1) * cross;
    }
    area /= 2;
    if (area === 0) continue;
    rx /= 6 * area;
    ry /= 6 * area;
    totalArea += Math.abs(area);
    cx += rx * Math.abs(area);
    cy += ry * Math.abs(area);
  }
  if (totalArea === 0) {
    // Degenerate polygon (zero area) — fall back to a plain vertex average.
    const ring = rings[0];
    let sx = 0,
      sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return { lat: sy / ring.length, lon: sx / ring.length };
  }
  return { lat: cy / totalArea, lon: cx / totalArea };
}

// Rough spherical-polygon area in square miles (good enough for swath scoring,
// not for geodesy-grade work).
export function polygonAreaSqMi(geometry) {
  if (!geometry) return 0;
  let rings;
  if (geometry.type === "Polygon") rings = [geometry.coordinates[0]];
  else if (geometry.type === "MultiPolygon")
    rings = geometry.coordinates.map((p) => p[0]);
  else return 0;

  let totalSqMi = 0;
  for (const ring of rings) {
    // Convert degrees to approx miles using local latitude for longitude scale.
    const avgLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const milesPerDegLat = 69.0;
    const milesPerDegLon = 69.0 * Math.cos(avgLat * RAD);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const X0 = x0 * milesPerDegLon,
        Y0 = y0 * milesPerDegLat;
      const X1 = x1 * milesPerDegLon,
        Y1 = y1 * milesPerDegLat;
      area += X0 * Y1 - X1 * Y0;
    }
    totalSqMi += Math.abs(area / 2);
  }
  return totalSqMi;
}

// Good Knight's home turf and working corridor.
const PRIMARY_COUNTIES = ["larimer", "weld"];
const PRIMARY_CITIES = ["fort collins", "loveland", "greeley"];
const SECONDARY_NAMED_COUNTIES = [
  "denver",
  "adams",
  "arapahoe",
  "jefferson",
  "douglas",
  "broomfield",
  "el paso", // Pueblo-area rural jobs
  "pueblo",
];

const I25_WAYPOINTS = [
  { lat: 41.139, lon: -104.82 }, // Cheyenne, WY
  { lat: 40.585, lon: -105.084 }, // Fort Collins
  { lat: 40.398, lon: -104.998 }, // Loveland
  { lat: 39.739, lon: -104.99 }, // Denver
  { lat: 39.087, lon: -104.821 }, // Colorado Springs
  { lat: 38.255, lon: -104.609 }, // Pueblo
];

function interpolateLine(waypoints, steps = 60) {
  const pts = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      pts.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
  }
  return pts;
}
const I25_LINE = interpolateLine(I25_WAYPOINTS);

export function distanceToI25Miles(lat, lon) {
  let min = Infinity;
  for (const p of I25_LINE) {
    const d = haversineMiles(lat, lon, p.lat, p.lon);
    if (d < min) min = d;
  }
  return min;
}

export function regionOf(countiesText, centroid) {
  const text = (countiesText || "").toLowerCase();
  if (PRIMARY_COUNTIES.some((c) => text.includes(c))) return "primary";
  if (PRIMARY_CITIES.some((c) => text.includes(c))) return "primary";
  if (centroid) {
    if (distanceToI25Miles(centroid.lat, centroid.lon) <= 120) return "secondary";
  }
  if (SECONDARY_NAMED_COUNTIES.some((c) => text.includes(c))) return "secondary";
  return "other";
}

// --- Nominatim geocoding, rate-limited + cached by caller ---
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const UA = "StormCommand-GoodKnightRoofing/1.0 (agent@goodknightroofing internal tool)";

export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim reverse failed: ${res.status}`);
  const data = await res.json();
  return data;
}

export async function forwardGeocode(address) {
  const url = `${NOMINATIM_BASE}/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Nominatim forward failed: ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display: data[0].display_name };
}

export function formatAddressFromNominatim(data) {
  if (!data || !data.address) return data?.display_name || null;
  const a = data.address;
  const streetPart = [a.house_number, a.road].filter(Boolean).join(" ");
  const place = a.city || a.town || a.village || a.hamlet || a.county || "";
  if (streetPart && place) return `${streetPart}, ${place}, ${a.state || "CO"}`;
  return data.display_name || null;
}
