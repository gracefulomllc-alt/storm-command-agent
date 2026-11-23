// Storage for the Manager Desk (/desk.html).
//   GET /api/desk?path=gk/cfg        -> {data}
//   GET /api/desk?prefix=pulse/      -> {docs:[{path,data}]}  (newest first, max 120)
//   PUT /api/desk  {path, data}      -> upsert one document
import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const db = getDatabase();

const PATH_RE = /^(gk\/(cfg|checks|tasks|bonus)|(pulse|weekly)\/\d{4}-\d{2}-\d{2})$/;
const PREFIX_RE = /^(pulse|weekly)\/$/;
const MAX_BYTES = 200_000;

export default async (req: Request) => {
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      const path = url.searchParams.get("path");
      const prefix = url.searchParams.get("prefix");
      if (path) {
        if (!PATH_RE.test(path)) return Response.json({ error: "bad path" }, { status: 400 });
        const [row] = await db.sql`SELECT data FROM desk_docs WHERE path = ${path}`;
        return Response.json({ data: row ? row.data : null });
      }
      if (prefix) {
        if (!PREFIX_RE.test(prefix)) return Response.json({ error: "bad prefix" }, { status: 400 });
        const rows = await db.sql`
          SELECT path, data FROM desk_docs WHERE path LIKE ${prefix + "%"} ORDER BY path DESC LIMIT 120
        `;
        return Response.json({ docs: rows });
      }
      return Response.json({ error: "path or prefix required" }, { status: 400 });
    }

    if (req.method === "PUT") {
      const raw = await req.text();
      if (raw.length > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
      const { path, data } = JSON.parse(raw);
      if (!PATH_RE.test(path || "") || data === undefined) {
        return Response.json({ error: "bad path or data" }, { status: 400 });
      }
      await db.sql`
        INSERT INTO desk_docs (path, data, updated_at)
        VALUES (${path}, ${JSON.stringify(data)}::jsonb, NOW())
        ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
      return Response.json({ ok: true });
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err: any) {
    console.error("desk function error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = { path: "/api/desk" };
