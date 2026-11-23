// National Weather Service alert fetching.
//
// CONFIRMED BUG (found twice during the original build): requesting
// area=CO,WY as one combined query silently drops one state's results with
// no error. The only reliable fix is a fully separate HTTP request PER
// STATE, merged client-side. Never combine states into one request again.

const NWS_HEADERS = {
  "User-Agent": "StormCommand-GoodKnightRoofing/1.0 (agent@goodknightroofing internal tool)",
  Accept: "application/geo+json",
};

const STATES = ["CO", "WY"];
const HAIL_EVENTS = ["Severe Thunderstorm Warning", "Severe Thunderstorm Watch"];

async function fetchJson(url) {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) throw new Error(`NWS request failed (${res.status}): ${url}`);
  return res.json();
}

export async function fetchActiveAlertsForState(state) {
  const params = new URLSearchParams();
  params.append("area", state);
  const url = `https://api.weather.gov/alerts/active?${params.toString()}`;
  const data = await fetchJson(url);
  return data.features || [];
}

// Live fetch across both states, independent requests merged client-side.
export async function fetchActiveAlerts() {
  const results = await Promise.all(STATES.map((s) => fetchActiveAlertsForState(s)));
  const counts = {};
  STATES.forEach((s, i) => (counts[s] = results[i].length));
  const features = results.flat();
  return { features, counts };
}

async function fetchNwsAlertsForState(state, start, end, useEventFilter) {
  const params = new URLSearchParams();
  params.append("area", state);
  params.append("start", start);
  params.append("end", end);
  if (useEventFilter) HAIL_EVENTS.forEach((e) => params.append("event", e));
  const url = `https://api.weather.gov/alerts?${params.toString()}`;
  const data = await fetchJson(url);
  return data.features || [];
}

// Independently retries EACH state if that state's own count is zero — a
// combined-count check masks the CO/WY bug (WY's nonzero count hides CO's
// zero). Every caller gets per-state counts back for self-diagnosis.
async function fetchStateWithFallback(state, start, end) {
  let features = await fetchNwsAlertsForState(state, start, end, true);
  let usedFallback = false;
  if (features.length === 0) {
    features = await fetchNwsAlertsForState(state, start, end, false);
    usedFallback = true;
  }
  return { state, features, usedFallback };
}

export async function fetchHistoricalAlerts(start, end) {
  const results = await Promise.all(STATES.map((s) => fetchStateWithFallback(s, start, end)));
  const counts = {};
  results.forEach((r) => (counts[r.state] = r.features.length));
  const features = results.flatMap((r) => r.features);
  const usedFallback = results.some((r) => r.usedFallback);
  return { features, counts, usedFallback };
}

// --- Text parsing against standardized NWS warning language ---

export function extractHailSize(text) {
  const m = /([\d.]+)\s*inch(?:es)?\s*(?:in\s*)?(?:diameter\s*)?hail/i.exec(text || "");
  return m ? parseFloat(m[1]) : null;
}

export function extractWindMph(text) {
  const m = /(\d+)\s*mph/i.exec(text || "");
  return m ? parseInt(m[1], 10) : null;
}

// "60 MILES SOUTHWEST OF CHEYENNE" style tracked-cell reference.
export function extractStormCellRef(text) {
  const m = /(\d+)\s*MILES?\s+(N|NE|E|SE|S|SW|W|NW|NORTH|NORTHEAST|EAST|SOUTHEAST|SOUTH|SOUTHWEST|WEST|NORTHWEST)\s+OF\s+([A-Z][A-Z .'-]+)/i.exec(
    text || ""
  );
  if (!m) return null;
  return { distanceMi: parseFloat(m[1]), bearing: m[2].toUpperCase(), place: m[3].trim() };
}

const BEARING_DEG = {
  N: 0, NORTH: 0,
  NE: 45, NORTHEAST: 45,
  E: 90, EAST: 90,
  SE: 135, SOUTHEAST: 135,
  S: 180, SOUTH: 180,
  SW: 225, SOUTHWEST: 225,
  W: 270, WEST: 270,
  NW: 315, NORTHWEST: 315,
};
export function bearingToDeg(bearing) {
  return BEARING_DEG[bearing?.toUpperCase()] ?? null;
}

// "MOVING NE AT 35 MPH" style motion text.
export function extractStormMotion(text) {
  const m = /MOVING\s+(N|NE|E|SE|S|SW|W|NW)\s+AT\s+(\d+)\s*MPH/i.exec(text || "");
  if (!m) return null;
  return { bearing: m[1].toUpperCase(), speedMph: parseInt(m[2], 10) };
}
