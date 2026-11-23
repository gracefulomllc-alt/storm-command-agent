// Canvasser roster + live status/location + production stats.
//
// Manager-facing (no PIN required):
//   GET    /api/reps              -> list all active reps (no pin field)
//   POST   /api/reps              -> add a rep {name, phone?, email?, pin}
//   PATCH  /api/reps/:id          -> manager edits (assigned_address, assigned_storm_id, active)
//   DELETE /api/reps/:id          -> deactivate a rep (soft delete)
//
// Rep-facing (PIN required in body, verified against that rep's row — this
// is a lightweight shared-device deterrent, not real auth; don't put
// anything sensitive behind it):
//   POST   /api/reps/:id/event    -> {pin, type, value?} one of:
//       status_change  value: "dispatched" | "on_site" | "done" | "idle"
//       door_knocked   value: optional note
//       appointment_set value: optional note
//       location_ping  value: {lat, lon}
import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

const db = getDatabase();

function publicRep(r: any) {
  const { pin, ...rest } = r;
  return rest;
}

async function listReps() {
  const reps = await db.sql`
    SELECT * FROM reps WHERE active = TRUE ORDER BY name ASC
  `;
  return Response.json(reps.map(publicRep));
}

async function createRep(req: Request) {
  const body = await req.json();
  if (!body.name || !body.pin) {
    return Response.json({ error: "name and pin are required" }, { status: 400 });
  }
  const [rep] = await db.sql`
    INSERT INTO reps (name, phone, email, pin)
    VALUES (${body.name}, ${body.phone ?? null}, ${body.email ?? null}, ${String(body.pin)})
    RETURNING *
  `;
  return Response.json(publicRep(rep), { status: 201 });
}

async function updateRep(id: string, req: Request) {
  const body = await req.json();
  const fields: string[] = [];
  const values: any[] = [];
  for (const key of ["assigned_address", "assigned_storm_id", "active", "name", "phone", "email"]) {
    if (key in body) {
      fields.push(key);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) return Response.json({ error: "no updatable fields provided" }, { status: 400 });

  // Build with sql.identifier for safety per field, one at a time (small N, simplicity over cleverness).
  for (let i = 0; i < fields.length; i++) {
    await db.sql`UPDATE reps SET ${db.sql.identifier(fields[i])} = ${values[i]}, updated_at = NOW() WHERE id = ${Number(id)}`;
  }
  const [rep] = await db.sql`SELECT * FROM reps WHERE id = ${Number(id)}`;
  if (!rep) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(publicRep(rep));
}

async function deactivateRep(id: string) {
  await db.sql`UPDATE reps SET active = FALSE, updated_at = NOW() WHERE id = ${Number(id)}`;
  return Response.json({ ok: true });
}

async function verifyPin(id: string, pin: string) {
  const [rep] = await db.sql`SELECT id, pin FROM reps WHERE id = ${Number(id)} AND active = TRUE`;
  if (!rep) return false;
  return String(rep.pin) === String(pin);
}

async function repEvent(id: string, req: Request) {
  const body = await req.json();
  if (!body.pin || !(await verifyPin(id, body.pin))) {
    return Response.json({ error: "invalid rep id or pin" }, { status: 401 });
  }
  const repId = Number(id);

  switch (body.type) {
    case "status_change": {
      const allowed = ["idle", "dispatched", "on_site", "done"];
      if (!allowed.includes(body.value)) {
        return Response.json({ error: `status must be one of ${allowed.join(", ")}` }, { status: 400 });
      }
      await db.sql`UPDATE reps SET status = ${body.value}, updated_at = NOW() WHERE id = ${repId}`;
      await db.sql`INSERT INTO rep_activity_log (rep_id, event_type, event_value) VALUES (${repId}, 'status_change', ${body.value})`;
      break;
    }
    case "door_knocked": {
      await db.sql`UPDATE reps SET doors_knocked = doors_knocked + 1, updated_at = NOW() WHERE id = ${repId}`;
      await db.sql`INSERT INTO rep_activity_log (rep_id, event_type, event_value) VALUES (${repId}, 'door_knocked', ${body.value ?? null})`;
      break;
    }
    case "appointment_set": {
      await db.sql`UPDATE reps SET appointments_set = appointments_set + 1, updated_at = NOW() WHERE id = ${repId}`;
      await db.sql`INSERT INTO rep_activity_log (rep_id, event_type, event_value) VALUES (${repId}, 'appointment_set', ${body.value ?? null})`;
      break;
    }
    case "location_ping": {
      const { lat, lon } = body.value || {};
      if (typeof lat !== "number" || typeof lon !== "number") {
        return Response.json({ error: "value must be {lat, lon} numbers" }, { status: 400 });
      }
      await db.sql`UPDATE reps SET lat = ${lat}, lon = ${lon}, location_updated_at = NOW(), updated_at = NOW() WHERE id = ${repId}`;
      break;
    }
    default:
      return Response.json({ error: "unknown event type" }, { status: 400 });
  }

  const [rep] = await db.sql`SELECT * FROM reps WHERE id = ${repId}`;
  return Response.json(publicRep(rep));
}

async function listActivity(id: string) {
  const rows = await db.sql`
    SELECT event_type, event_value, created_at FROM rep_activity_log
    WHERE rep_id = ${Number(id)} ORDER BY created_at DESC LIMIT 100
  `;
  return Response.json(rows);
}

export default async (req: Request, context: Context) => {
  const parts = context.params;
  const id = parts.id as string | undefined;
  const action = parts.action as string | undefined;

  try {
    if (!id && req.method === "GET") return await listReps();
    if (!id && req.method === "POST") return await createRep(req);
    if (id && !action && req.method === "PATCH") return await updateRep(id, req);
    if (id && !action && req.method === "DELETE") return await deactivateRep(id);
    if (id && action === "event" && req.method === "POST") return await repEvent(id, req);
    if (id && action === "activity" && req.method === "GET") return await listActivity(id);
    return new Response("Not found", { status: 404 });
  } catch (err: any) {
    console.error("reps function error:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/reps", "/api/reps/:id", "/api/reps/:id/:action"],
};
