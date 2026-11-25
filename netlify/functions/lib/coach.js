// Performance flags for canvassers, based on completed weeks only.
// "Balanced" rules (Terel's choice):
//   coach     : most recent completed week under 70% of target
//   warning   : last 2 completed weeks both under 70%
//   decision  : last 4 completed weeks all under 50%
// New reps (under 14 days on the roster) are "ramping" and never flagged.

export const RULES = { coachBelow: 0.7, warnWeeks: 2, decisionBelow: 0.5, decisionWeeks: 4, rampDays: 14 };

export function classifyRep(weeksPct, daysOnRoster) {
  // weeksPct: array of completed-week attainment (0..n), most recent first.
  if (daysOnRoster < RULES.rampDays) {
    return { level: "ramping", label: "New, ramping up", action: "Give them time. Focus on training and ride-alongs." };
  }
  if (weeksPct.length === 0) {
    return { level: "nodata", label: "No full week yet", action: "Waiting on a full week of numbers." };
  }
  const last = weeksPct.slice(0, RULES.decisionWeeks);
  if (last.length >= RULES.decisionWeeks && last.every((p) => p < RULES.decisionBelow)) {
    return {
      level: "decision",
      label: "Decision time",
      action: `${RULES.decisionWeeks} weeks in a row under 50% of target. Review with the owner, check the coaching notes, and decide whether to keep coaching or part ways.`,
    };
  }
  if (weeksPct.length >= RULES.warnWeeks && weeksPct.slice(0, RULES.warnWeeks).every((p) => p < RULES.coachBelow)) {
    return { level: "warning", label: "Struggling", action: "2 weeks in a row under 70%. Sit down 1-on-1 this week, set one clear goal, and ride along." };
  }
  if (weeksPct[0] < RULES.coachBelow) {
    return { level: "coach", label: "Coach this week", action: "Last week was under 70% of target. Do a short check-in and find out why." };
  }
  if (weeksPct[0] >= 1) return { level: "great", label: "Hitting target", action: "Recognize it. Ask what is working so others can copy it." };
  return { level: "ok", label: "On track", action: "No action needed." };
}

export function mondayStr(d, tz = "America/Denver") {
  // Monday (YYYY-MM-DD) of the week containing d, in the given timezone.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get("weekday")];
  const base = new Date(Date.UTC(+get("year"), +get("month") - 1, +get("day")));
  base.setUTCDate(base.getUTCDate() - wd);
  return base.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
