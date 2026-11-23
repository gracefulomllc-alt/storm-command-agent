// Core orchestrator: turns raw NWS features into ranked, address-resolved
// dispatch targets. Used by both the scheduled scan and the on-demand API.

import {
  fetchActiveAlerts,
  extractHailSize,
  extractWindMph,
  extractStormCellRef,
  extractStormMotion,
  bearingToDeg,
} from "./nws.js";
import { fetchTodaysSPCReports, bestMatchingReport } from "./spc.js";
import {
  centroidOf,
  polygonAreaSqMi,
  regionOf,
  reverseGeocode,
  forwardGeocode,
  formatAddressFromNominatim,
  destinationPoint,
  haversineMiles,
} from "./geo.js";
import { computeClaimScore } from "./scoring.js";

const MIN_HAIL_INCHES = 1.0;

function parseAlert(feature) {
  const p = feature.properties;
  const text = `${p.headline || ""} ${p.description || ""}`;
  const geometry = feature.geometry;
  const centroid = centroidOf(geometry);
  const counties = p.areaDesc || "";

  return {
    id: feature.id,
    event: p.event,
    headline: p.headline,
    description: p.description,
    counties,
    severity: p.severity,
    expires: p.expires,
    effective: p.effective,
    sender: p.senderName,
    size: extractHailSize(text),
    windMph: extractWindMph(text),
    cellRef: extractStormCellRef(text),
    motion: extractStormMotion(text),
    geometry,
    centroid,
    swathSqMi: polygonAreaSqMi(geometry),
    region: regionOf(counties, centroid),
  };
}

// Three-tier address resolution, highest trust first:
//   1. Confirmed SPC spotter report near the storm's centroid
//   2. NWS-tracked storm-cell position text ("60 MILES SW OF CHEYENNE")
//   3. Area-weighted polygon centroid (least precise, always available)
async function resolveTarget(alert, spcReports) {
  // Tier 1: SPC ground truth
  if (alert.centroid) {
    const match = bestMatchingReport(alert.centroid, spcReports);
    if (match) {
      const { report } = match;
      return {
        targetPoint: { lat: report.lat, lon: report.lon },
        targetSource: "confirmed-spotter",
        startAddress: `Near ${report.location}, ${report.county} County, ${report.state} (confirmed ${report.sizeInches}" hail report)`,
      };
    }
  }

  // Tier 2: tracked storm-cell position text
  if (alert.cellRef && alert.centroid) {
    const deg = bearingToDeg(alert.cellRef.bearing);
    if (deg !== null) {
      // NWS gives distance FROM the place TO the storm; invert to project
      // from a known city toward the storm using geocoded place + bearing.
      try {
        const place = await forwardGeocode(`${alert.cellRef.place}, CO`);
        if (place) {
          const projected = destinationPoint(place.lat, place.lon, deg, alert.cellRef.distanceMi);
          const geo = await reverseGeocode(projected.lat, projected.lon);
          const addr = formatAddressFromNominatim(geo);
          return {
            targetPoint: projected,
            targetSource: "tracked-cell",
            startAddress: addr || `${alert.cellRef.distanceMi}mi ${alert.cellRef.bearing} of ${alert.cellRef.place}`,
          };
        }
      } catch {
        // fall through to tier 3
      }
    }
  }

  // Tier 3: polygon centroid (always available if geometry exists)
  if (alert.centroid) {
    try {
      const geo = await reverseGeocode(alert.centroid.lat, alert.centroid.lon);
      const addr = formatAddressFromNominatim(geo);
      return {
        targetPoint: alert.centroid,
        targetSource: "polygon-estimate",
        startAddress: addr || `${alert.centroid.lat.toFixed(4)}, ${alert.centroid.lon.toFixed(4)} (estimated storm center)`,
      };
    } catch {
      return {
        targetPoint: alert.centroid,
        targetSource: "polygon-estimate",
        startAddress: `${alert.centroid.lat.toFixed(4)}, ${alert.centroid.lon.toFixed(4)} (estimated storm center — address lookup failed)`,
      };
    }
  }

  return { targetPoint: null, targetSource: "none", startAddress: "No location data available" };
}

function computeIntercept(alert) {
  if (!alert.motion || !alert.targetPoint) return null;
  const deg = bearingToDeg(alert.motion.bearing);
  if (deg === null) return null;
  // Project 20 minutes ahead at the reported speed — "where it's headed next".
  const distanceMi = (alert.motion.speedMph * 20) / 60;
  const projected = destinationPoint(alert.targetPoint.lat, alert.targetPoint.lon, deg, distanceMi);
  return { point: projected, minutesAhead: 20, bearing: alert.motion.bearing, speedMph: alert.motion.speedMph };
}

// The main entry point. Returns ranked, address-resolved storm targets.
export async function scanStorms({ minHailInches = MIN_HAIL_INCHES } = {}) {
  const [{ features, counts }, spcReports] = await Promise.all([
    fetchActiveAlerts(),
    fetchTodaysSPCReports().catch(() => []),
  ]);

  const relevant = features
    .map(parseAlert)
    .filter((a) => a.event === "Severe Thunderstorm Warning" || a.event === "Severe Thunderstorm Watch")
    .filter((a) => a.region !== "other")
    .filter((a) => (a.event === "Severe Thunderstorm Watch" ? true : (a.size ?? 0) >= minHailInches || bestMatchingReport(a.centroid, spcReports)));

  const resolved = [];
  for (const alert of relevant) {
    const target = await resolveTarget(alert, spcReports);
    const claim = computeClaimScore({
      sizeInches: alert.size,
      windMph: alert.windMph,
      swathSqMi: alert.swathSqMi,
      medianYearBuilt: null, // Census lookup is a nice-to-have, skipped here to keep scan fast/cheap
    });
    const full = { ...alert, ...target, claim };
    full.intercept = computeIntercept(full);
    resolved.push(full);
  }

  resolved.sort((a, b) => {
    const regionRank = { primary: 0, secondary: 1, other: 2 };
    if (regionRank[a.region] !== regionRank[b.region]) return regionRank[a.region] - regionRank[b.region];
    return b.claim.score - a.claim.score;
  });

  return { storms: resolved, counts, scannedAt: new Date().toISOString() };
}
