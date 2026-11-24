/**
 * Family/coach one-pager: Train with the Shoremen (dates + age-band hours).
 * Reads SHOREMEN_DATES / SHOREMEN_SLOTS from seed-shoremen-sessions.mjs.
 *
 * Usage: node scripts/export-shoremen-onepager.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { SHOREMEN_DATES, SHOREMEN_SLOTS } from "./seed-shoremen-sessions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/Users/cprewitt/Downloads/ALTBSA-Anchor-Gym";
const FORMS =
  "/Users/cprewitt/Library/CloudStorage/GoogleDrive-tryouts@altbsa.org/Shared drives/ALTBSA/Forms";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LOGO = "/Users/cprewitt/Documents/github/assets/logo-wide.jpg";

const TZ = "America/New_York";
const ALHS_ADDRESS = "175 Avon Belden Road, Avon Lake, OH 44012";

function formatNight(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 17));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

function hourLabel(h) {
  const ampm = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${hr}:00 ${ampm}`;
}

function slotBand(label) {
  return label.replace(/^HS Aux ·\s*/, "");
}

const nights = SHOREMEN_DATES.map((ymd) => formatNight(ymd));
const slots = SHOREMEN_SLOTS.map((s) => ({
  time: `${hourLabel(s.startHour)} – ${hourLabel(s.endHour)}`,
  ages: slotBand(s.label),
}));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Train with the Shoremen · ALTBSA</title>
<style>
  @page { size: letter; margin: 0.55in; }
  :root {
    --maroon: #862633;
    --ink: #1a1514;
    --muted: #5c504a;
    --line: #d9cec4;
    --wash: #faf6f1;
    --band: #f3e4e6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: var(--ink);
    font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif;
    background: #fff;
  }
  .sheet {
    min-height: 9.4in;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line);
    padding: 28px 32px 24px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    border-bottom: 3px solid var(--maroon);
    padding-bottom: 14px;
    margin-bottom: 18px;
  }
  .top img { height: 52px; width: auto; }
  .eyebrow {
    color: var(--maroon);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 0.72rem;
    margin: 0 0 4px;
  }
  h1 {
    margin: 0;
    font-size: 1.85rem;
    line-height: 1.15;
    color: var(--maroon);
    font-weight: 800;
  }
  .lede {
    margin: 14px 0 0;
    font-size: 1.02rem;
    line-height: 1.45;
    color: var(--ink);
    max-width: 38rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1.15fr 0.85fr;
    gap: 18px;
    margin-top: 22px;
    flex: 1;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 0.78rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--maroon);
  }
  .panel {
    background: var(--wash);
    border: 1px solid var(--line);
    padding: 14px 16px;
  }
  .nights { list-style: none; margin: 0; padding: 0; }
  .nights li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
    font-size: 0.98rem;
  }
  .nights li:last-child { border-bottom: 0; }
  .nights .day { font-weight: 700; }
  .nights .note {
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 500;
  }
  .slots { display: grid; gap: 10px; }
  .slot {
    background: #fff;
    border: 1px solid var(--line);
    border-left: 5px solid var(--maroon);
    padding: 12px 14px;
  }
  .slot .time {
    font-weight: 800;
    color: var(--maroon);
    font-size: 1.05rem;
  }
  .slot .ages {
    margin-top: 2px;
    font-size: 0.95rem;
  }
  .meta {
    margin-top: 18px;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
  }
  .meta .panel { background: #fff; }
  .meta dt {
    margin: 0;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--maroon);
    font-weight: 700;
  }
  .meta dd {
    margin: 4px 0 0;
    font-size: 0.92rem;
    line-height: 1.35;
  }
  .foot {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    gap: 16px;
    color: var(--muted);
    font-size: 0.78rem;
  }
  .callout {
    margin-top: 14px;
    background: var(--band);
    border: 1px solid #e0c8cc;
    padding: 10px 14px;
    font-size: 0.88rem;
    line-height: 1.4;
  }
  @media print {
    .sheet { border: 0; min-height: 0; }
    body, .panel, .slot, .callout { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="top">
      <div>
        <p class="eyebrow">ALTBSA Baseball · Winter 2027</p>
        <h1>Train with the Shoremen</h1>
      </div>
      <img src="file://${LOGO}" alt="ALTBSA"/>
    </div>

    <p class="lede">
      Six nights at Avon Lake High School with Shoremen varsity coaches and players —
      age-banded hours so every group gets focused gym time.
    </p>

    <div class="grid">
      <div class="panel">
        <h2>Session nights</h2>
        <ul class="nights">
          ${nights
            .map(
              (label) =>
                `<li><span class="day">${label}</span><span class="note">HS Aux</span></li>`
            )
            .join("\n")}
        </ul>
        <div class="callout">
          Required for returning Shoremen players. ALTBSA 7U–12U baseball attend your age-band hour.
        </div>
      </div>

      <div>
        <h2>Time slots</h2>
        <div class="slots">
          ${slots
            .map(
              (s) =>
                `<div class="slot"><div class="time">${s.time}</div><div class="ages">${s.ages}</div></div>`
            )
            .join("\n")}
        </div>
      </div>
    </div>

    <div class="meta">
      <div class="panel">
        <dl>
          <dt>Location</dt>
          <dd>ALHS Auxiliary Gym<br/>${ALHS_ADDRESS}</dd>
        </dl>
      </div>
      <div class="panel">
        <dl>
          <dt>Who</dt>
          <dd>ALTBSA baseball 7U–12U<br/>+ Shoremen HS players/coaches</dd>
        </dl>
      </div>
      <div class="panel">
        <dl>
          <dt>Schedule</dt>
          <dd>schedule.altbsa.org<br/>Other → Train with the Shoremen</dd>
        </dl>
      </div>
    </div>

    <div class="foot">
      <span>Questions: tryouts@altbsa.org</span>
      <span>Updated Nov 20, 2026 · America/New_York</span>
    </div>
  </div>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
const base = "ALTBSA-Train-with-the-Shoremen-2027-OnePager";
const htmlPath = path.join(OUT, `${base}.html`);
const pdfPath = path.join(OUT, `${base}.pdf`);
fs.writeFileSync(htmlPath, html);

const r = spawnSync(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    htmlPath,
  ],
  { encoding: "utf8" }
);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status || 1);
}

fs.copyFileSync(htmlPath, path.join(FORMS, path.basename(htmlPath)));
fs.copyFileSync(pdfPath, path.join(FORMS, path.basename(pdfPath)));
console.log("wrote", pdfPath);
console.log("copied to Forms");
