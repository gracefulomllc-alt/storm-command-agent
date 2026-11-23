// Scheduled function — the "Claude agent" that tracks and runs the storms.
// Fires every 15 minutes, all day, every day (see config.schedule below).
//
// Each run:
//   1. Scans active NWS alerts for CO + WY, cross-referenced against SPC
//      ground-truth hail reports, scored, and address-resolved.
//   2. Stores the full ranked list in Blobs for the dashboard to read.
//   3. Diffs against the last run's "seen" alert IDs. Any NEW storm that
//      crosses the high-priority threshold (score >= 70, or any confirmed
//      SPC spotter report) triggers a Gmail dispatch-alert email.
import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { scanStorms } from "./lib/scan.js";
import { sendDispatchAlert } from "./lib/mailer.js";

const HIGH_PRIORITY_THRESHOLD = 70;

export default async (req: Request) => {
  const store = getStore("storm-command-state");

  let result;
  try {
    result = await scanStorms();
  } catch (err: any) {
    console.error("Storm scan failed:", err.message);
    await store.setJSON("last-error", { message: err.message, at: new Date().toISOString() });
    return new Response("scan failed, logged", { status: 200 });
  }

  const { storms, counts, scannedAt } = result;

  // Persist the full current list for the dashboard (get-storms.mts reads this).
  await store.setJSON("latest-scan", { storms, counts, scannedAt });

  // Diff against previously-seen alert IDs to find genuinely NEW storms.
  const seenRaw = await store.get("seen-alert-ids", { type: "json" });
  const seen = new Set(seenRaw || []);
  const newHighPriority = storms.filter(
    (s) => !seen.has(s.id) && (s.claim.score >= HIGH_PRIORITY_THRESHOLD || s.targetSource === "confirmed-spotter")
  );

  // Update the seen set (cap growth — keep the most recent 500 IDs).
  const updatedSeen = Array.from(new Set([...storms.map((s) => s.id), ...seen])).slice(0, 500);
  await store.setJSON("seen-alert-ids", updatedSeen);

  let mailResult = { sent: false, reason: "no new high-priority storms" };
  if (newHighPriority.length > 0) {
    const dashboardUrl = Netlify.env.get("URL") || Netlify.env.get("DEPLOY_PRIME_URL") || "";
    mailResult = await sendDispatchAlert(newHighPriority, dashboardUrl);
  }

  console.log(
    `Storm Command scan: ${storms.length} active (CO:${counts.CO ?? "?"} WY:${counts.WY ?? "?"}), ${newHighPriority.length} new high-priority, email: ${JSON.stringify(mailResult)}`
  );

  return new Response("ok", { status: 200 });
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
