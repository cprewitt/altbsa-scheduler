/**
 * Export baseball review HTML (+ Chrome PDFs) for Chuck: cages, court, T3, Shoremen.
 * Softbal hours omitted from cages/court. Reads live Supabase.
 *
 * Usage: node scripts/export-baseball-review-pdfs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { fromZonedTime } from "date-fns-tz";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const TZ = env.NEXT_PUBLIC_TIMEZONE || "America/New_York";
const OUT = "/Users/cprewitt/Downloads/ALTBSA-Anchor-Gym";
const FORMS =
  "/Users/cprewitt/Library/CloudStorage/GoogleDrive-tryouts@altbsa.org/Shared drives/ALTBSA/Forms";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CSS = `
:root{--maroon:#862633;--ink:#1c1412;--muted:#6a5c55;--line:#ddd2c8;--alt-bg:#f3e4e6;--hold-bg:#ece7e1}
*{box-sizing:border-box}body{margin:0;font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;color:var(--ink);background:#f7f2ec}
.wrap{max-width:1200px;margin:0 auto;padding:20px 14px 48px}
header{background:var(--maroon);color:#fff;padding:22px 20px;border-radius:10px;margin-bottom:16px}
header h1{margin:0 0 4px;font-size:1.45rem}header p{margin:0;opacity:.95;font-size:.95rem}
.badge{display:inline-block;margin-top:10px;background:#ffbf3f;color:#1c1412;font-weight:700;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:999px}
h2{color:var(--maroon);font-size:1.1rem;margin:22px 0 8px}h3{margin:0 0 8px;font-size:1rem}
.card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:10px 0 16px;font-size:.92rem}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 14px}
.lg{font-size:.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--line)}
.lg.alt{background:var(--alt-bg);color:var(--maroon);font-weight:600}.lg.hold{background:var(--hold-bg);color:#7a6f66}
.week{margin:0 0 22px;page-break-inside:avoid}
.cal-wrap{overflow-x:auto;background:#fff;border:1px solid var(--line);border-radius:10px}
table.cal{width:100%;border-collapse:collapse;table-layout:fixed;min-width:860px;font-size:.72rem}
table.cal th,table.cal td{border:1px solid var(--line);vertical-align:top;padding:0}
table.cal thead th,table.cal th{background:#f3ebe3;color:var(--maroon);text-align:center;padding:6px 2px}
table.cal th.time{width:54px;background:#faf6f1;color:var(--muted);font-weight:600;text-align:right;padding:4px 6px;font-size:.68rem}
.dname{font-weight:700;font-size:.78rem}.ddate{color:var(--muted);font-weight:500;font-size:.68rem}
td.cell{height:34px;background:#fff;padding:2px}td.cell.out{background:#f4f1ed}td.cell.alt{background:var(--alt-bg)}td.cell.hold{background:var(--hold-bg)}
.ev-alt,.ev-hold{padding:3px 4px;line-height:1.2;font-weight:600}.ev-alt{color:var(--maroon)}.ev-hold{color:#7a6f66;font-weight:500;font-size:.68rem}
ul{margin:6px 0;padding-left:18px}li{margin:4px 0}footer{margin-top:20px;color:var(--muted);font-size:.8rem}
@media print{body{background:#fff}.wrap{max-width:none;padding:0}table.cal{min-width:0;font-size:.65rem}td.cell{height:28px}
header,.cal-wrap,td.cell.alt,td.cell.hold,.ev-alt,.lg{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;

function sb() {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function fmtStamp() {
  return new Date().toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toLocalParts(iso) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hour,
    weekday: get("weekday"),
    date: new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00`),
  };
}

function ymd(p) {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function sundayOf(p) {
  // JS: getDay Sun=0
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - day);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

function addDays(p, n) {
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function hourLabel(h) {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function monthDay(p) {
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function teamLabel(notes) {
  if (!notes) return "";
  return notes.split("—")[0].trim();
}

function isHold(notes) {
  const n = (notes || "").toLowerCase();
  return (
    n.startsWith("hold") ||
    n.includes("facility hold") ||
    n.includes("soccer") ||
    n.includes("neo") ||
    n.includes("drop-in") ||
    n.startsWith("[")
  );
}

function buildWeekGrid({ title, subtitle, badge, intro, caveats, events, rangeStart, rangeEnd, hours }) {
  // events: {ymd, hour, label, kind}
  const weeks = new Map();
  let cur = sundayOf(rangeStart);
  const end = rangeEnd;
  while (
    cur.y < end.y ||
    (cur.y === end.y && cur.m < end.m) ||
    (cur.y === end.y && cur.m === end.m && cur.d <= end.d)
  ) {
    weeks.set(ymd(cur), { start: { ...cur }, cells: new Map() });
    cur = addDays(cur, 7);
    if (weeks.size > 20) break;
  }
  for (const ev of events) {
    const ws = sundayOf({
      y: Number(ev.ymd.slice(0, 4)),
      m: Number(ev.ymd.slice(5, 7)),
      d: Number(ev.ymd.slice(8, 10)),
    });
    const key = ymd(ws);
    const week = weeks.get(key);
    if (!week) continue;
    const day = (new Date(ev.ymd + "T12:00:00Z").getUTCDay() + 7) % 7;
    // getUTCDay on ymd noon UTC is correct for calendar date
    const dt = new Date(Date.UTC(Number(ev.ymd.slice(0, 4)), Number(ev.ymd.slice(5, 7)) - 1, Number(ev.ymd.slice(8, 10))));
    const dow = dt.getUTCDay();
    const ck = `${dow}-${ev.hour}`;
    if (!week.cells.has(ck)) week.cells.set(ck, []);
    week.cells.get(ck).push(ev);
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title><style>${CSS}</style></head><body><div class="wrap">`;
  html += `<header><h1>${title}</h1><p>${subtitle}</p><span class="badge">${badge}</span></header>`;
  html += `<div class="card">${intro}</div>`;
  html += `<div class="legend"><span class="lg alt">ALTBSA team</span><span class="lg hold">Facility hold</span><span class="lg">Open</span></div>`;

  for (const [, week] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const we = addDays(week.start, 6);
    html += `<section class="week"><h3>Week of ${monthDay(week.start)} – ${monthDay(we)}, ${we.y}</h3><div class="cal-wrap"><table class="cal"><thead><tr><th class="time">Time</th>`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(week.start, i);
      html += `<th><div class="dname">${dayNames[i]}</div><div class="ddate">${monthDay(d)}</div></th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const h of hours) {
      html += `<tr><th class="time">${hourLabel(h)}</th>`;
      for (let dow = 0; dow < 7; dow++) {
        const d = addDays(week.start, dow);
        const dy = ymd(d);
        const out =
          dy < ymd(rangeStart) || dy >= ymd(rangeEnd);
        const cell = week.cells.get(`${dow}-${h}`) || [];
        let cls = "cell";
        if (out) cls += " out";
        else if (cell.some((e) => e.kind === "hold")) cls += " hold";
        else if (cell.length) cls += " alt";
        html += `<td class="${cls}">`;
        for (const e of cell) {
          html += `<div class="${e.kind === "hold" ? "ev-hold" : "ev-alt"}">${escapeHtml(e.label)}</div>`;
        }
        html += `</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table></div></section>`;
  }
  html += `<h2>Caveats</h2><div class="card"><ul>${caveats.map((c) => `<li>${c}</li>`).join("")}</ul></div>`;
  html += `<footer>ALTBSA · tryouts@altbsa.org · Generated ${fmtStamp()} · ${TZ}</footer></div></body></html>`;
  return html;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function simpleListHtml({ title, subtitle, badge, intro, caveats, rows, headers }) {
  let html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title><style>${CSS}</style></head><body><div class="wrap">`;
  html += `<header><h1>${title}</h1><p>${subtitle}</p><span class="badge">${badge}</span></header>`;
  html += `<div class="card">${intro}</div>`;
  html += `<table class="cal" style="min-width:0"><thead><tr>${headers.map((h) => `<th style="padding:8px">${h}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of rows) {
    html += `<tr>${r.map((c, i) => `<td class="cell${i === r.length - 1 ? " alt" : ""}" style="padding:8px">${i === r.length - 1 ? `<div class="ev-alt">${escapeHtml(c)}</div>` : escapeHtml(c)}</td>`).join("")}</tr>`;
  }
  html += `</tbody></table>`;
  html += `<h2>Caveats</h2><div class="card"><ul>${caveats.map((c) => `<li>${c}</li>`).join("")}</ul></div>`;
  html += `<footer>ALTBSA · tryouts@altbsa.org · Generated ${fmtStamp()} · ${TZ}</footer></div></body></html>`;
  return html;
}

async function loadBookings(client, slug, startIso, endIso) {
  const { data: res, error: rErr } = await client.from("resources").select("id").eq("slug", slug).single();
  if (rErr) throw rErr;
  const { data, error } = await client
    .from("bookings")
    .select("starts_at,ends_at,notes,status")
    .eq("resource_id", res.id)
    .eq("status", "confirmed")
    .gte("starts_at", startIso)
    .lt("starts_at", endIso)
    .order("starts_at");
  if (error) throw error;
  return data || [];
}

function printPdf(htmlPath, pdfPath) {
  const r = spawnSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`Chrome PDF failed for ${pdfPath}`);
  }
  console.log("pdf", pdfPath, fs.statSync(pdfPath).size);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(FORMS, { recursive: true });
  const client = sb();
  const stamp = fmtStamp();

  // Cages: Dec 27 2026 – Feb 1 2027
  const cageStart = fromZonedTime("2026-12-27 00:00:00", TZ).toISOString();
  const cageEnd = fromZonedTime("2027-02-01 00:00:00", TZ).toISOString();
  const cages = await loadBookings(client, "cages", cageStart, cageEnd);
  const cageEvents = [];
  for (const b of cages) {
    const label = teamLabel(b.notes);
    if (label.includes("Softball")) continue;
    const p = toLocalParts(b.starts_at);
    cageEvents.push({ ymd: ymd(p), hour: p.hour, label, kind: "alt" });
  }
  const cagesHtml = buildWeekGrid({
    title: "ALTBSA · Anchor Cages Schedule (Baseball)",
    subtitle: "January 2027 · America/New_York · pooled cages · 1 hour/team/week · baseball only",
    badge: "Review draft — cages · baseball",
    intro: `<strong>For Chuck Zubek (baseball review).</strong> Softbal cage hours omitted pending Jamie feedback. Live scheduler (${cageEvents.length} baseball sessions).`,
    caveats: [
      "Softbal sessions intentionally omitted from this baseball review packet.",
      "February+ cages continue the same weekly days/times unless changed.",
      "12U Gold (Lomax): Sunday 7–8 PM (moved off Friday for Shoremen ALHS).",
    ],
    events: cageEvents,
    rangeStart: { y: 2026, m: 12, d: 27 },
    rangeEnd: { y: 2027, m: 2, d: 1 },
    hours: [...Array(12).keys()].map((i) => i + 9),
  });
  const cagesHtmlPath = path.join(OUT, "ALTBSA-Baseball-Cages-January-2027-REVIEW.html");
  fs.writeFileSync(cagesHtmlPath, cagesHtml);

  // Court
  const courtStart = fromZonedTime("2027-02-13 00:00:00", TZ).toISOString();
  const courtEnd = fromZonedTime("2027-04-12 00:00:00", TZ).toISOString();
  const court = await loadBookings(client, "court", courtStart, courtEnd);
  const courtEvents = [];
  for (const b of court) {
    const notes = b.notes || "";
    const p = toLocalParts(b.starts_at);
    if (isHold(notes)) {
      courtEvents.push({ ymd: ymd(p), hour: p.hour, label: notes.slice(0, 80), kind: "hold" });
      continue;
    }
    const label = teamLabel(notes);
    if (label.includes("Softball")) continue;
    courtEvents.push({ ymd: ymd(p), hour: p.hour, label, kind: "alt" });
  }
  const courtHtml = buildWeekGrid({
    title: "ALTBSA · Anchor Court (Gym) Schedule (Baseball)",
    subtitle: "February 13 – April 11, 2027 · America/New_York · 1 hour/team/week · baseball only",
    badge: "Review draft — court · baseball",
    intro: `<strong>For Chuck Zubek (baseball review).</strong> Softbal gym hours omitted pending Jamie. ${courtEvents.filter((e) => e.kind === "alt").length} baseball sessions + facility holds. 11U Maroon is Sunday 6:00 PM. Teams skip gym the week of their T3 Friday.`,
    caveats: [
      "Softbal sessions omitted from this baseball review packet.",
      "Gym starts after last HS Aux Shoremen night (Feb 12).",
      "11U Maroon Court: Sunday 6:00 PM (moved from Friday 4:00 PM).",
      "On a team’s T3 week, that team’s gym hour is skipped.",
      "Easter Sunday Mar 28 blackout still applies.",
    ],
    events: courtEvents,
    rangeStart: { y: 2027, m: 2, d: 13 },
    rangeEnd: { y: 2027, m: 4, d: 12 },
    hours: [...Array(12).keys()].map((i) => i + 9),
  });
  const courtHtmlPath = path.join(OUT, "ALTBSA-Baseball-Court-Feb-Apr-2027-REVIEW.html");
  fs.writeFileSync(courtHtmlPath, courtHtml);

  // T3
  const t3Start = fromZonedTime("2027-02-01 00:00:00", TZ).toISOString();
  const t3End = fromZonedTime("2027-04-15 00:00:00", TZ).toISOString();
  const t3 = await loadBookings(client, "t3", t3Start, t3End);
  const t3Rows = t3.map((b) => {
    const s = toLocalParts(b.starts_at);
    const e = toLocalParts(b.ends_at);
    const dateStr = new Date(Date.UTC(s.y, s.m - 1, s.d)).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const timeStr = `${hourLabel(s.hour).replace(" ", "")}–${hourLabel(e.hour)}`.replace("AM", " AM").replace("PM", " PM");
    // better time
    const startLabel = new Date(b.starts_at).toLocaleTimeString("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = new Date(b.ends_at).toLocaleTimeString("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    });
    return [dateStr, `${startLabel}–${endLabel}`, (b.notes || "").replace(/^T3 · /, "")];
  });
  const t3Html = simpleListHtml({
    title: "ALTBSA · T3 Building Two (Baseball)",
    subtitle: "Fridays 7:00–8:30 PM · America/New_York · same-age pairings · no softbal / no 7U",
    badge: "Review draft — T3 · baseball",
    intro: `<strong>For Chuck Zubek.</strong> Softbal removed from T3 (academy path separate). 14U Maroon is solo (only one baseball 14U). Please confirm pairings.`,
    caveats: [
      "Feb 12 is 13Us (Shoremen HS Aux same night for 7U–12U).",
      "Apr 2 / Apr 9 give 10U White and 9U White a second same-age night.",
      "Pairings are draft until you confirm.",
    ],
    headers: ["Date", "Time", "Teams"],
    rows: t3Rows,
  });
  const t3HtmlPath = path.join(OUT, "ALTBSA-Baseball-T3-Fridays-2027-REVIEW.html");
  fs.writeFileSync(t3HtmlPath, t3Html);

  // Shoremen
  const shStart = fromZonedTime("2027-01-01 00:00:00", TZ).toISOString();
  const shEnd = fromZonedTime("2027-02-15 00:00:00", TZ).toISOString();
  const shoremen = await loadBookings(client, "shoremen", shStart, shEnd);
  const shRows = shoremen.map((b) => {
    const s = toLocalParts(b.starts_at);
    const dateStr = new Date(Date.UTC(s.y, s.m - 1, s.d)).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const startLabel = new Date(b.starts_at).toLocaleTimeString("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    });
    const endLabel = new Date(b.ends_at).toLocaleTimeString("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
    });
    return [dateStr, `${startLabel}–${endLabel}`, b.notes || "Shoremen · HS Aux"];
  });
  const shHtml = simpleListHtml({
    title: "ALTBSA · Train with the Shoremen",
    subtitle: "HS Aux · 5–6 / 6–7 / 7–8 PM · America/New_York",
    badge: "Review draft — Shoremen",
    intro: `<strong>For Chuck Zubek.</strong> Hourly age bands: <strong>5–6 PM 7U+8U</strong>, <strong>6–7 PM 9U–10U</strong>, <strong>7–8 PM 11U–12U</strong>.`,
    caveats: [
      "Feb 12 overlaps T3 older night (13Us on Building Two).",
    ],
    headers: ["Date", "Window", "Notes"],
    rows: shRows,
  });
  const shHtmlPath = path.join(OUT, "ALTBSA-Baseball-Shoremen-2027-REVIEW.html");
  fs.writeFileSync(shHtmlPath, shHtml);

  const files = [
    ["ALTBSA-Baseball-Cages-January-2027-REVIEW", cagesHtmlPath],
    ["ALTBSA-Baseball-Court-Feb-Apr-2027-REVIEW", courtHtmlPath],
    ["ALTBSA-Baseball-T3-Fridays-2027-REVIEW", t3HtmlPath],
    ["ALTBSA-Baseball-Shoremen-2027-REVIEW", shHtmlPath],
  ];

  for (const [base, htmlPath] of files) {
    const pdfPath = path.join(OUT, `${base}.pdf`);
    printPdf(htmlPath, pdfPath);
    fs.copyFileSync(htmlPath, path.join(FORMS, path.basename(htmlPath)));
    fs.copyFileSync(pdfPath, path.join(FORMS, path.basename(pdfPath)));
  }

  console.log("Done.", stamp);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
