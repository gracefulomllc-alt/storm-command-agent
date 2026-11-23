// Storm Prediction Center ground-truth hail spotter reports.
// Format: https://www.spc.noaa.gov/climo/reports/{YYMMDD}_rpts_hail.csv

function yymmdd(d) {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

export function parseSPCCsv(text) {
  const lines = text.trim().split("\n");
  const reports = [];
  // SPC hail CSV header: Time,Size,Location,County,State,Lat,Lon,Comments
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 7) continue;
    const [time, size, location, county, state, lat, lon] = cols;
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    if (Number.isNaN(latN) || Number.isNaN(lonN)) continue;
    reports.push({
      time,
      sizeHundredths: parseInt(size, 10) || 0,
      sizeInches: (parseInt(size, 10) || 0) / 100,
      location,
      county,
      state,
      lat: latN,
      lon: lonN,
    });
  }
  return reports;
}

export async function fetchSPCReportsForDate(dateObj) {
  const url = `https://www.spc.noaa.gov/climo/reports/${yymmdd(dateObj)}_rpts_hail.csv`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const text = await res.text();
  return parseSPCCsv(text);
}

export async function fetchTodaysSPCReports() {
  return fetchSPCReportsForDate(new Date());
}

// Does an SPC report fall within an NWS alert's polygon bounding area?
// Cheap containment check by proximity to centroid (good enough — SPC points
// are ground truth within a warned area, not required to be geometrically
// exact inside the polygon).
export function bestMatchingReport(centroid, reports, maxMiles = 15) {
  if (!centroid || !reports.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const r of reports) {
    const d = haversine(centroid.lat, centroid.lon, r.lat, r.lon);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  if (bestDist <= maxMiles) return { report: best, distanceMi: bestDist };
  return null;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const RAD = Math.PI / 180;
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
