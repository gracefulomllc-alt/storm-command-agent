// Historical hail scoring for a chosen area + date range.
// Inputs are SPC ground-truth hail reports (already filtered to the area).
// The 1-10 score and approval % are HEURISTIC estimates built from hail size,
// corroboration and storm age — not actuarial data and not a promise of approval.

import { parseSPCCsv } from "./spc.js";

export function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function spcUrlFor(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `https://www.spc.noaa.gov/climo/reports/${y.slice(2)}${m}${d}_rpts_hail.csv`;
}

export function daysBetween(fromStr, toStr) {
  const out = [];
  const start = new Date(fromStr + "T00:00:00Z");
  const end = new Date(toStr + "T00:00:00Z");
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(ymd(d));
  return out;
}

export function parseDay(csvText, dateStr) {
  return parseSPCCsv(csvText).map((r) => ({ ...r, date: dateStr }));
}

const SIZE_POINTS = [
  [2.5, 9],
  [2.0, 8],
  [1.75, 7],
  [1.5, 6],
  [1.25, 5],
  [1.0, 4],
  [0.75, 2],
  [0, 1],
];
const APPROVAL_PCT = { 1: 3, 2: 8, 3: 15, 4: 25, 5: 38, 6: 52, 7: 65, 8: 76, 9: 85, 10: 90 };

export function scoreArea(reports, { today = new Date() } = {}) {
  if (!reports.length) {
    return {
      score: 1,
      approvalPct: 0,
      verdict: "skip",
      verdictLabel: "Skip",
      maxHail: 0,
      count: 0,
      bigCount: 0,
      reasons: ["No hail reports in this area for the dates you picked."],
    };
  }

  const maxHail = Math.max(...reports.map((r) => r.sizeInches));
  const big = reports.filter((r) => r.sizeInches >= 1.0);
  const bigCount = big.length;
  const newest = reports.map((r) => r.date).sort().slice(-1)[0];
  const oldest = reports.map((r) => r.date).sort()[0];
  const ageDays = Math.floor((today - new Date(newest + "T00:00:00Z")) / 86400000);

  let score = SIZE_POINTS.find(([min]) => maxHail >= min)[1];
  const reasons = [`Largest hail reported: ${maxHail.toFixed(2)}" (${bigCount} report${bigCount === 1 ? "" : "s"} at 1" or bigger out of ${reports.length}).`];

  if (bigCount >= 3) {
    score += 1;
    reasons.push("Three or more 1\"+ reports in the area back each other up.");
  } else if (bigCount <= 1 && maxHail >= 1.0) {
    score -= 1;
    reasons.push("Only a single 1\"+ report, so it could be a small pocket rather than the whole area.");
  }

  if (ageDays > 540) {
    score -= 2;
    reasons.push(`Newest storm is about ${Math.round(ageDays / 30)} months old. Claim filing windows and roof repairs make older storms much weaker leads.`);
  } else if (ageDays > 365) {
    score -= 1;
    reasons.push(`Newest storm is over a year old. Check policy filing windows (many are 1 to 2 years) before knocking.`);
  } else if (ageDays <= 30) {
    reasons.push("Recent storm, so homeowners are still inside normal filing windows.");
  }

  score = Math.max(1, Math.min(10, score));
  if (maxHail < 1.0) reasons.push('Hail under 1" rarely damages roofs enough for a claim to be approved.');
  reasons.push("Not factored in: roof age and material, each homeowner's deductible, and adjuster decisions.");

  const verdict = score >= 7 ? "go" : score >= 5 ? "maybe" : "skip";
  const verdictLabel = { go: "Go", maybe: "Maybe", skip: "Skip" }[verdict];
  return {
    score,
    approvalPct: APPROVAL_PCT[score],
    verdict,
    verdictLabel,
    maxHail,
    count: reports.length,
    bigCount,
    newest,
    oldest,
    reasons,
  };
}
