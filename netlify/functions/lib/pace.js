// Goal pace math, shared by the brief and morning email. Mirrors the Manager Desk.
export const DEFAULT_SEASON = [4, 4, 6, 8, 13, 15, 15, 12, 8, 6, 5, 4];

function parseYmd(s) { const p = String(s).split("-"); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }

function rawShare(d, y, w) {
  if (d.getFullYear() > y) return 1;
  if (d.getFullYear() < y) return 0;
  const m = d.getMonth();
  let c = 0;
  for (let i = 0; i < m; i++) c += w[i];
  return c + (w[m] * d.getDate()) / new Date(y, m + 1, 0).getDate();
}

export function computePace(cfg, soldDollars, now = new Date()) {
  const goal = Number(cfg.goal) > 0 ? Number(cfg.goal) : 3000000;
  const stretch = Number(cfg.stretchGoal) > 0 ? Number(cfg.stretchGoal) : 5000000;
  const start = parseYmd(cfg.start || "2027-01-04");
  const days = Math.ceil((start - now) / 86400000);
  const base = { goal, stretch, soldDollars };
  if (days > 0) return { ...base, pre: true, daysToStart: days };
  const season = (cfg.season && cfg.season.length === 12 ? cfg.season : DEFAULT_SEASON).map(Number);
  const tot = season.reduce((a, b) => a + b, 0) || 1;
  const w = season.map((x) => x / tot);
  const y = start.getFullYear();
  const a = rawShare(start, y, w);
  const share = Math.min(Math.max((rawShare(now, y, w) - a) / (1 - a || 1), 0), 1);
  const expected = goal * share;
  return { ...base, pre: false, expectedShare: share, expected, gap: soldDollars - expected, onPace: soldDollars >= expected };
}
