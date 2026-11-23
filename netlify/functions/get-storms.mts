// Dashboard-facing API. Reads whatever the scheduled scan last computed —
// fast, and doesn't hammer NWS/SPC/Nominatim on every page load. Add
// ?refresh=1 to force a brand-new live scan (useful right after deploy,
// before the first scheduled run has fired).
import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { scanStorms } from "./lib/scan.js";

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const store = getStore("storm-command-state");

  if (url.searchParams.get("refresh") === "1") {
    const result = await scanStorms();
    await store.setJSON("latest-scan", result);
    return Response.json(result);
  }

  const cached = await store.get("latest-scan", { type: "json" });
  if (!cached) {
    // Nothing scanned yet (fresh deploy, scheduled function hasn't fired).
    const result = await scanStorms();
    await store.setJSON("latest-scan", result);
    return Response.json(result);
  }
  return Response.json(cached);
};

export const config: Config = {
  path: "/api/storms",
};
