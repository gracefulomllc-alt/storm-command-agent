// Claim Probability Score (0-100) — weighted on real adjuster-relevant
// criteria, not just "biggest hail wins".

export function sizeScore(sizeInches) {
  if (!sizeInches) return 0;
  if (sizeInches >= 2.5) return 40;
  if (sizeInches >= 1.75) return 32;
  if (sizeInches >= 1.25) return 24;
  if (sizeInches >= 1.0) return 15;
  return 5;
}

export function windScore(windMph) {
  if (!windMph) return 0;
  if (windMph >= 70) return 20;
  if (windMph >= 58) return 14;
  if (windMph >= 40) return 8;
  return 2;
}

export function swathScore(sqMi) {
  if (!sqMi) return 0;
  if (sqMi >= 300) return 20;
  if (sqMi >= 150) return 14;
  if (sqMi >= 50) return 8;
  return 3;
}

export function ageScore(medianYearBuilt) {
  if (!medianYearBuilt) return 5; // unknown — neutral
  const age = new Date().getFullYear() - medianYearBuilt;
  if (age >= 25) return 20;
  if (age >= 15) return 14;
  if (age >= 8) return 8;
  return 2;
}

export function computeClaimScore({ sizeInches, windMph, swathSqMi, medianYearBuilt }) {
  const parts = {
    size: sizeScore(sizeInches),
    wind: windScore(windMph),
    swath: swathScore(swathSqMi),
    age: ageScore(medianYearBuilt),
  };
  const score = Math.min(100, parts.size + parts.wind + parts.swath + parts.age);
  let tier, tierLabel;
  if (score >= 70) {
    tier = "high";
    tierLabel = "High probability";
  } else if (score >= 45) {
    tier = "medium";
    tierLabel = "Worth a look";
  } else {
    tier = "low";
    tierLabel = "Low priority";
  }
  const topFactor = Object.entries(parts).sort((a, b) => b[1] - a[1])[0][0];
  const topFactorLabel = {
    size: "Hail size",
    wind: "Wind-driven hail",
    swath: "Storm swath size",
    age: "Neighborhood age",
  }[topFactor];
  return { score, tier, tierLabel, topFactor: topFactorLabel, parts };
}
