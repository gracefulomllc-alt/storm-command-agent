// Sends the dispatch-alert email via Gmail SMTP using an App Password.
// The scheduled function runs with nobody watching, so this has to be able
// to send on its own — it can't ride on a connected Gmail account the way
// Claude's own Gmail tools do in a chat session.
//
// Required env vars (set in Netlify site settings, scope: Functions):
//   GMAIL_USER       - the Gmail address to send from (and usually to)
//   GMAIL_APP_PASSWORD - a 16-character Gmail App Password (requires 2FA
//                         enabled on the account; generate at
//                         https://myaccount.google.com/apppasswords)
//   ALERT_TO_EMAIL   - optional, defaults to GMAIL_USER - where alerts go

import nodemailer from "nodemailer";

function buildTransport() {
  const user = Netlify.env.get("GMAIL_USER");
  const pass = Netlify.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function directionsUrl(point) {
  if (!point) return "#";
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lon}`;
}

function stormRowHtml(s) {
  const sourceLabel = {
    "confirmed-spotter": "✅ Confirmed hail report",
    "tracked-cell": "📍 NWS-tracked storm position",
    "polygon-estimate": "🔵 Estimated storm center",
  }[s.targetSource] || "Unknown";

  return `
  <tr>
    <td style="padding:14px 16px;border-bottom:1px solid #2a3a52;">
      <div style="font-size:18px;font-weight:700;color:#fff;">${s.claim.score}/100 — ${s.claim.tierLabel}</div>
      <div style="font-size:15px;margin:6px 0;color:#eaf2ff;"><b>Go to:</b> ${s.startAddress}</div>
      <div style="font-size:12px;color:#9fb3cc;">${sourceLabel} · Top factor: ${s.claim.topFactor}</div>
      <div style="font-size:12px;color:#9fb3cc;">${s.counties}${s.size ? ` · ${s.size}" hail` : ""}${s.windMph ? ` · ${s.windMph} mph wind` : ""}</div>
      <div style="margin-top:8px;">
        <a href="${directionsUrl(s.targetPoint)}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">Open Directions</a>
      </div>
    </td>
  </tr>`;
}

export async function sendDispatchAlert(newStorms, dashboardUrl) {
  const transport = buildTransport();
  if (!transport) {
    return { sent: false, reason: "GMAIL_USER / GMAIL_APP_PASSWORD not configured" };
  }
  const to = Netlify.env.get("ALERT_TO_EMAIL") || Netlify.env.get("GMAIL_USER");

  const html = `
  <div style="font-family:Arial,sans-serif;background:#0b1220;padding:24px;">
    <h2 style="color:#fff;margin:0 0 4px;">⚡ Storm Command — ${newStorms.length} new high-priority storm${newStorms.length === 1 ? "" : "s"}</h2>
    <p style="color:#9fb3cc;margin:0 0 16px;">Good Knight Roofing — go to the highest-scored address first.</p>
    <table style="width:100%;border-collapse:collapse;background:#111a2b;border-radius:8px;overflow:hidden;">
      ${newStorms.map(stormRowHtml).join("")}
    </table>
    ${dashboardUrl ? `<p style="margin-top:18px;"><a href="${dashboardUrl}" style="color:#60a5fa;">Open full Storm Command dashboard →</a></p>` : ""}
  </div>`;

  await transport.sendMail({
    from: `Storm Command <${Netlify.env.get("GMAIL_USER")}>`,
    to,
    subject: `⚡ ${newStorms.length} new storm${newStorms.length === 1 ? "" : "s"} — ${newStorms[0].claim.tierLabel} at ${newStorms[0].startAddress}`,
    html,
  });
  return { sent: true };
}

// Generic email used by the morning brief.
export async function sendEmail(subject, html) {
  const transport = buildTransport();
  if (!transport) return { sent: false, reason: "GMAIL_USER / GMAIL_APP_PASSWORD not configured" };
  const to = Netlify.env.get("ALERT_TO_EMAIL") || Netlify.env.get("GMAIL_USER");
  await transport.sendMail({ from: `Storm Command <${Netlify.env.get("GMAIL_USER")}>`, to, subject, html });
  return { sent: true };
}
