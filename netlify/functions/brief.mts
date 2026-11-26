// The agent's check-in: goal pace + today's question.
//   GET  /api/brief                       -> {pace, question|null}
//   POST /api/brief {key, question, answer} -> saves an answer
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { computePace } from "./lib/pace.js";

const db = getDatabase();

const QUESTIONS: Record<string, { text: string; options: string[] }> = {
  crew: { text: "How many canvassers will you have in the field this week?", options: ["None yet", "1 to 3", "4 to 6", "7 to 10", "More than 10"] },
  spot: { text: "How did the last spot we sent the team to turn out?", options: ["Great, lots of appointments", "Some appointments", "Nothing", "We didn't go"] },
  blocker: { text: "What is the biggest thing standing between you and the goal right now?", options: ["Not enough reps", "No good storms", "Rep performance", "Production backlog", "Claims getting denied"] },
};

function pickQuestion(d: Date) {
  const dow = d.getDay(); // 0 Sun
  if (dow === 1) return "crew";
  if (dow === 5) return "blocker";
  if (dow >= 2 && dow <= 4) return "spot";
  return null;
}

async function getDoc(path: string) {
  const [row] = await db.sql`SELECT data FROM desk_docs WHERE path = ${path}`;
  return row ? row.data : null;
}

async function buildBrief() {
  const cfg = (await getDoc("gk/cfg")) || {};
  const [snap] = await db.sql`SELECT total_sold_cents FROM revenue_snapshot ORDER BY fetched_at DESC LIMIT 1`;
  let sold = snap ? Number(snap.total_sold_cents) / 100 : 0;
  if (!sold) {
    const rows = await db.sql`SELECT data FROM desk_docs WHERE path LIKE 'weekly/%'`;
    sold = rows.reduce((a: number, r: any) => a + (Number(r.data.sold) || 0) - (Number(r.data.cancAmt) || 0), 0);
  }
  const pace = computePace(cfg, sold);

  let question = null;
  const key = pickQuestion(new Date());
  if (key) {
    const [done] = await db.sql`SELECT id FROM agent_answers WHERE question_key = ${key} AND answered_on = CURRENT_DATE LIMIT 1`;
    if (!done) question = { key, ...QUESTIONS[key] };
  }
  const recent = await db.sql`SELECT question_key, answer, answered_on FROM agent_answers ORDER BY created_at DESC LIMIT 5`;
  return { pace, question, recent };
}

export default async (req: Request) => {
  try {
    if (req.method === "POST") {
      const b = await req.json();
      const q = QUESTIONS[b.key];
      if (!q || !q.options.includes(b.answer)) return Response.json({ error: "Unknown question or answer." }, { status: 400 });
      await db.sql`INSERT INTO agent_answers (question_key, question, answer) VALUES (${b.key}, ${q.text}, ${b.answer})`;
      return Response.json({ ok: true });
    }
    return Response.json(await buildBrief());
  } catch (err: any) {
    console.error("brief error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = { path: "/api/brief" };
