// SalesRabbit + AccuLynx revenue pulls.
//
// CONFIDENCE NOTE: SalesRabbit's API is publicly documented and this follows
// it closely. AccuLynx does not have public API docs — the shape below is a
// best-effort guess (Bearer token, /api/v1/jobs, a "soldAmount"-style field)
// and may need adjusting once real responses are seen. If AccuLynx pulls
// come back empty or wrong, that's the likely reason — check the real
// response shape in Netlify function logs and adjust parseAccuLynxJobs().

const SALESRABBIT_BASE = "https://api.salesrabbit.com";
const ACCULYNX_BASE = "https://api.acculynx.com/api/v1";

export async function fetchSalesRabbitSold() {
  const key = Netlify.env.get("SALESRABBIT_API_KEY");
  if (!key) return null;

  const res = await fetch(`${SALESRABBIT_BASE}/leads?status=Sold`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`SalesRabbit API error ${res.status}`);
  const data = await res.json();
  const leads = Array.isArray(data) ? data : data.leads || data.data || [];

  let totalCents = 0;
  let canvasserCents = 0;
  for (const lead of leads) {
    // SalesRabbit custom fields vary by account; try the common value fields.
    const dollars = Number(lead.value ?? lead.dealValue ?? lead.customFields?.contractAmount ?? 0);
    const cents = Math.round(dollars * 100);
    totalCents += cents;
    // Treat a lead sourced by a canvasser (vs. a closer/inbound) as canvasser revenue
    // when SalesRabbit tags the owner's role — best-effort, adjust to your account's fields.
    if (lead.ownerRole === "canvasser" || lead.source === "canvassing" || lead.leadSource === "Door to Door") {
      canvasserCents += cents;
    }
  }
  return { totalCents, canvasserCents, count: leads.length };
}

export async function fetchAccuLynxSold() {
  const key = Netlify.env.get("ACCULYNX_API_KEY");
  if (!key) return null;

  const res = await fetch(`${ACCULYNX_BASE}/jobs?status=sold`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`AccuLynx API error ${res.status}`);
  const data = await res.json();
  return parseAccuLynxJobs(data);
}

function parseAccuLynxJobs(data) {
  const jobs = Array.isArray(data) ? data : data.jobs || data.data || data.results || [];
  let totalCents = 0;
  for (const job of jobs) {
    const dollars = Number(job.soldAmount ?? job.contractTotal ?? job.totalPrice ?? 0);
    totalCents += Math.round(dollars * 100);
  }
  return { totalCents, canvasserCents: 0, count: jobs.length }; // AccuLynx doesn't expose a canvasser flag in this guess
}
