// Revenue progress toward the $3M total / $1M canvasser goal.
//   GET  /api/revenue          -> latest cached snapshot + goals
//   POST /api/revenue?refresh=1 -> pull fresh numbers from SalesRabbit/AccuLynx, cache, return
//   POST /api/revenue          -> manual entry {totalDollars, canvasserDollars}
import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { fetchSalesRabbitSold, fetchAccuLynxSold } from "./lib/crm.js";

const db = getDatabase();

// Good Knight's stated goals (see storm-command-agent README / Terel's business targets).
const GOAL_TOTAL_CENTS = 300_000_000; // $3,000,000
const GOAL_CANVASSER_CENTS = 100_000_000; // $1,000,000

async function latestSnapshot() {
  const [row] = await db.sql`SELECT * FROM revenue_snapshot ORDER BY fetched_at DESC LIMIT 1`;
  return row || null;
}

async function refresh() {
  const [sr, al] = await Promise.allSettled([fetchSalesRabbitSold(), fetchAccuLynxSold()]);

  const srData = sr.status === "fulfilled" ? sr.value : null;
  const alData = al.status === "fulfilled" ? al.value : null;
  const errors = [sr, al].filter((r) => r.status === "rejected").map((r: any) => r.reason?.message);

  if (!srData && !alData) {
    return { ok: false, reason: "No CRM API keys configured, or both calls failed", errors };
  }

  const totalCents = (srData?.totalCents ?? 0) + (alData?.totalCents ?? 0);
  const canvasserCents = srData?.canvasserCents ?? 0;

  const [snapshot] = await db.sql`
    INSERT INTO revenue_snapshot (source, total_sold_cents, canvasser_sold_cents, raw_meta)
    VALUES ('salesrabbit+acculynx', ${totalCents}, ${canvasserCents}, ${JSON.stringify({ srData, alData, errors })})
    RETURNING *
  `;
  return { ok: true, snapshot };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const snap = await latestSnapshot();
      return Response.json({
        snapshot: snap,
        goals: { totalCents: GOAL_TOTAL_CENTS, canvasserCents: GOAL_CANVASSER_CENTS },
      });
    }

    if (req.method === "POST" && url.searchParams.get("refresh") === "1") {
      const result = await refresh();
      if (!result.ok) return Response.json(result, { status: 424 });
      return Response.json({
        snapshot: result.snapshot,
        goals: { totalCents: GOAL_TOTAL_CENTS, canvasserCents: GOAL_CANVASSER_CENTS },
      });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const totalCents = Math.round(Number(body.totalDollars || 0) * 100);
      const canvasserCents = Math.round(Number(body.canvasserDollars || 0) * 100);
      const [snapshot] = await db.sql`
        INSERT INTO revenue_snapshot (source, total_sold_cents, canvasser_sold_cents)
        VALUES ('manual', ${totalCents}, ${canvasserCents})
        RETURNING *
      `;
      return Response.json({
        snapshot,
        goals: { totalCents: GOAL_TOTAL_CENTS, canvasserCents: GOAL_CANVASSER_CENTS },
      });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("revenue function error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/revenue",
};
