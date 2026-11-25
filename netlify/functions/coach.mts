// Manager coaching API.
//   GET  /api/coach                 -> roster with weekly performance flags, meetings, role-play stats
//   GET  /api/coach?repId=N         -> meeting history for one rep (latest 20)
//   POST /api/coach {action:"meeting",  repId, note, skill, followupOn, confidence, metOn}
//   POST /api/coach {action:"roleplay", heldOn, skill, scores:[{repId, attended, score}]}
//   POST /api/coach {action:"settings", apptsPerWeek, doorsPerWeek}
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { addDays, classifyRep, mondayStr, RULES } from "./lib/coach.js";

const db = getDatabase();
const WEEKS_BACK = 6;

async function getDoc(path: string) {
  const [row] = await db.sql`SELECT data FROM desk_docs WHERE path = ${path}`;
  return row ? row.data : null;
}

// Targets: saved override, else derived from the Manager Desk Setup numbers.
async function getTargets() {
  const saved = await getDoc("gk/coachTargets");
  const cfg = (await getDoc("gk/cfg")) || {};
  const g = (k: string, d: number) => (Number(cfg[k]) > 0 ? Number(cfg[k]) : d);
  const avg = g("avgJob", 15000), weeks = g("weeks", 40), reps = g("reps", 10);
  const conv = (g("sit", 60) / 100) * (g("close", 40) / 100);
  const canvAppts = g("canvassGoal", 1000000) / avg / conv;
  const derivedAppts = canvAppts / weeks / reps;
  const derivedDoors = derivedAppts * g("doors", 35);
  const apptsPerWeek = saved?.apptsPerWeek > 0 ? Number(saved.apptsPerWeek) : Math.round(derivedAppts * 10) / 10;
  const doorsPerWeek = saved?.doorsPerWeek > 0 ? Number(saved.doorsPerWeek) : Math.round(derivedDoors);
  return { apptsPerWeek, doorsPerWeek, custom: !!saved, derivedAppts: Math.round(derivedAppts * 10) / 10, derivedDoors: Math.round(derivedDoors) };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const repId = url.searchParams.get("repId");
      if (repId) {
        const rows = await db.sql`
          SELECT id, met_on, note, skill, followup_on, confidence
          FROM coach_meetings WHERE rep_id = ${Number(repId)} ORDER BY met_on DESC, id DESC LIMIT 20`;
        return Response.json({ meetings: rows });
      }

      const targets = await getTargets();
      const thisMonday = mondayStr(new Date());
      const since = addDays(thisMonday, -7 * WEEKS_BACK);

      const reps = await db.sql`SELECT id, name, status, created_at FROM reps WHERE active = TRUE ORDER BY name ASC`;
      const counts = await db.sql`
        SELECT rep_id,
               to_char(date_trunc('week', created_at AT TIME ZONE 'America/Denver'), 'YYYY-MM-DD') AS wk,
               event_type, COUNT(*)::int AS n
        FROM rep_activity_log
        WHERE event_type IN ('door_knocked','appointment_set')
          AND (created_at AT TIME ZONE 'America/Denver') >= ${since}::date
        GROUP BY 1,2,3`;
      const meetings = await db.sql`
        SELECT DISTINCT ON (rep_id) rep_id, met_on, note, skill, followup_on, confidence
        FROM coach_meetings ORDER BY rep_id, met_on DESC, id DESC`;
      const openFollow = await db.sql`
        SELECT rep_id, MIN(followup_on) AS due FROM coach_meetings
        WHERE followup_on IS NOT NULL AND followup_on >= CURRENT_DATE - 30
        GROUP BY rep_id`;
      const rpStats = await db.sql`
        SELECT s.rep_id, AVG(s.score)::float AS avg_score, COUNT(*)::int AS total, SUM(CASE WHEN s.attended THEN 1 ELSE 0 END)::int AS attended
        FROM (SELECT rs.* FROM roleplay_scores rs JOIN roleplay_sessions se ON se.id = rs.session_id ORDER BY se.held_on DESC, se.id DESC) s
        GROUP BY s.rep_id`;
      const rpRecent = await db.sql`
        SELECT rs.rep_id, rs.score, se.held_on FROM roleplay_scores rs JOIN roleplay_sessions se ON se.id = rs.session_id
        WHERE rs.score IS NOT NULL ORDER BY se.held_on DESC, se.id DESC LIMIT 200`;
      const sessions = await db.sql`
        SELECT se.id, se.held_on, se.skill, COUNT(rs.id)::int AS n, SUM(CASE WHEN rs.attended THEN 1 ELSE 0 END)::int AS attended
        FROM roleplay_sessions se LEFT JOIN roleplay_scores rs ON rs.session_id = se.id
        GROUP BY se.id ORDER BY se.held_on DESC, se.id DESC LIMIT 5`;

      const out = reps.map((r: any) => {
        const mine = counts.filter((c: any) => c.rep_id === r.id);
        const weeks: any[] = [];
        for (let i = 0; i <= WEEKS_BACK; i++) {
          const wk = addDays(thisMonday, -7 * i);
          const appts = mine.find((c: any) => c.wk === wk && c.event_type === "appointment_set")?.n || 0;
          const doors = mine.find((c: any) => c.wk === wk && c.event_type === "door_knocked")?.n || 0;
          weeks.push({ wk, appts, doors, pct: targets.apptsPerWeek > 0 ? appts / targets.apptsPerWeek : 0, current: i === 0 });
        }
        const completed = weeks.filter((w) => !w.current);
        const daysOnRoster = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000);
        // Only count full weeks that began after the rep's first (partial) week.
        const eligible = completed.filter((w) => w.wk > mondayStr(new Date(r.created_at)));
        const verdict = classifyRep(eligible.map((w) => w.pct), daysOnRoster);
        const m = meetings.find((x: any) => x.rep_id === r.id) || null;
        const f = openFollow.find((x: any) => x.rep_id === r.id) || null;
        const rp = rpStats.find((x: any) => x.rep_id === r.id) || null;
        const scores = rpRecent.filter((x: any) => x.rep_id === r.id).map((x: any) => x.score);
        const lastThree = scores.slice(0, 3), prevThree = scores.slice(3, 6);
        const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
        let trend: string | null = null;
        if (lastThree.length >= 2 && prevThree.length >= 2) {
          const d = avg(lastThree)! - avg(prevThree)!;
          trend = d > 0.3 ? "up" : d < -0.3 ? "down" : "flat";
        }
        return {
          id: r.id, name: r.name, status: r.status, daysOnRoster, ...verdict,
          weeks: weeks.reverse(),
          lastMeeting: m,
          followupDue: f ? f.due : null,
          roleplay: rp ? { avgScore: rp.avg_score, attended: rp.attended, total: rp.total, trend } : null,
        };
      });

      const order: any = { decision: 0, warning: 1, coach: 2, ok: 3, great: 4, nodata: 5, ramping: 6 };
      out.sort((a: any, b: any) => (order[a.level] ?? 9) - (order[b.level] ?? 9) || a.name.localeCompare(b.name));
      return Response.json({ targets, rules: RULES, reps: out, sessions, weekOf: thisMonday });
    }

    if (req.method === "POST") {
      const b = await req.json();
      const dateOk = (s: any) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

      if (b.action === "meeting") {
        const repId = Number(b.repId);
        if (!repId) return Response.json({ error: "Pick a rep." }, { status: 400 });
        const conf = b.confidence ? Math.min(5, Math.max(1, Number(b.confidence))) : null;
        await db.sql`
          INSERT INTO coach_meetings (rep_id, met_on, note, skill, followup_on, confidence)
          VALUES (${repId}, ${dateOk(b.metOn) ? b.metOn : new Date().toISOString().slice(0, 10)}::date,
                  ${String(b.note || "").slice(0, 2000) || null}, ${String(b.skill || "").slice(0, 60) || null},
                  ${dateOk(b.followupOn) ? b.followupOn : null}::date, ${conf})`;
        return Response.json({ ok: true });
      }

      if (b.action === "roleplay") {
        const scores = Array.isArray(b.scores) ? b.scores : [];
        if (!scores.length) return Response.json({ error: "Add at least one rep." }, { status: 400 });
        const [s] = await db.sql`
          INSERT INTO roleplay_sessions (held_on, skill)
          VALUES (${dateOk(b.heldOn) ? b.heldOn : new Date().toISOString().slice(0, 10)}::date, ${String(b.skill || "").slice(0, 60) || null})
          RETURNING id`;
        for (const x of scores) {
          const sc = x.attended && x.score ? Math.min(5, Math.max(1, Number(x.score))) : null;
          await db.sql`INSERT INTO roleplay_scores (session_id, rep_id, attended, score) VALUES (${s.id}, ${Number(x.repId)}, ${!!x.attended}, ${sc})`;
        }
        return Response.json({ ok: true });
      }

      if (b.action === "settings") {
        const data = { apptsPerWeek: Number(b.apptsPerWeek) || 0, doorsPerWeek: Number(b.doorsPerWeek) || 0 };
        await db.sql`
          INSERT INTO desk_docs (path, data, updated_at) VALUES ('gk/coachTargets', ${JSON.stringify(data)}::jsonb, NOW())
          ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`;
        return Response.json({ ok: true });
      }
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("coach error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = { path: "/api/coach" };
