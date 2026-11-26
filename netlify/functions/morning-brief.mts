// Scheduled 7:00 AM Mountain (14:00 UTC, standard time; 8 AM during daylight time).
// Emails the daily plan: pace vs goal, best spots, and today's question.
import type { Config } from "@netlify/functions";
import { sendEmail } from "./lib/mailer.js";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export default async () => {
  const site = Netlify.env.get("URL") || "https://melodious-crisp-b97d83.netlify.app";
  let brief: any = null, plan: any = null;
  try { brief = await (await fetch(`${site}/api/brief`)).json(); } catch {}
  try { plan = await (await fetch(`${site}/api/plan?days=14`)).json(); } catch {}
  if (!brief && !plan) return new Response("nothing to send", { status: 200 });

  const p = brief?.pace;
  const paceLine = !p
    ? ""
    : p.pre
      ? `Season opens in <b>${p.daysToStart} days</b>. Must-hit goal ${money(p.goal)}, stretch ${money(p.stretch)}.`
      : `Sold to date <b>${money(p.soldDollars)}</b> vs about ${money(p.expected)} expected by now: <b style="color:${p.onPace ? "#22c55e" : "#ef4444"}">${p.onPace ? "ahead" : "behind"} by ${money(Math.abs(p.gap))}</b>. Goal ${money(p.goal)}, stretch ${money(p.stretch)}.`;

  const spots = (plan?.spots || []).slice(0, 3).map((s: any) =>
    `<div style="padding:10px 0;border-top:1px solid #2a3a52;"><b>${s.score}/10 ${s.verdict.toUpperCase()}</b> · ${s.address}<br><span style="color:#9fb3cc;font-size:12px;">${s.maxHail}" hail · ${s.count} reports · ${s.venues.join(" + ")}</span></div>`).join("");
  const q = brief?.question
    ? `<p style="margin-top:18px;"><b>Today's question:</b> ${brief.question.text}<br><a href="${site}/" style="color:#60a5fa;">Answer it on the home screen →</a></p>`
    : "";

  const html = `<div style="font-family:Arial,sans-serif;background:#0b1220;color:#eaf2ff;padding:24px;">
    <h2 style="margin:0 0 8px;">Good morning, Terel</h2>
    <p>${paceLine}</p>
    <h3 style="margin:18px 0 4px;">Best spots right now</h3>
    ${spots || '<p style="color:#9fb3cc;">No spots worth chasing in the last 14 days.</p>'}
    ${q}
    <p style="margin-top:18px;"><a href="${site}/" style="color:#60a5fa;">Open Good Knight Command →</a></p>
  </div>`;
  const r = await sendEmail("Good Knight morning brief", html);
  return new Response(JSON.stringify(r), { status: 200 });
};

export const config: Config = { schedule: "0 14 * * *" };
