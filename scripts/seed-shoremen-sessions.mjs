/**
 * Seed Train with the Shoremen (HS Aux) nights into the `shoremen` resource.
 *
 * Six locked dates (Chuck Nov 2). Hourly age bands (Chris 2026-11-19):
 *   5:00–6:00 PM  7U + 8U
 *   6:00–7:00 PM  9U–10U
 *   7:00–8:00 PM  11U–12U
 *
 * Safe to re-run: cancels prior "Shoremen ·" bookings on shoremen in range first.
 *
 * Usage: node scripts/seed-shoremen-sessions.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const NOTE_PREFIX = "Shoremen · ";
/** Admin holder until per-team coach ownership is assigned. */
const HOLDER_EMAIL = "tryouts@altbsa.org";

/**
 * Locked nights (Chuck Nov 2 Scheduling Call Notes).
 * 2026-11-20: Kevin Collins — Fri Jan 29 → Tue Jan 26 (ALHS wrestling conflict).
 */
export const SHOREMEN_DATES = [
  "2027-01-08",
  "2027-01-15",
  "2027-01-19",
  "2027-01-26",
  "2027-02-02",
  "2027-02-12",
];

/**
 * Hourly age bands (facility-local).
 * startHour / endHour are 24h clock in America/New_York.
 */
export const SHOREMEN_SLOTS = [
  { startHour: 17, endHour: 18, label: "HS Aux · 7U + 8U" },
  { startHour: 18, endHour: 19, label: "HS Aux · 9U–10U" },
  { startHour: 19, endHour: 20, label: "HS Aux · 11U–12U" },
];

function loadEnvClient() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

function ymdFromUtcDate(dt) {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function sessionRange(dateYmd, startHour, endHour) {
  const starts_at = fromZonedTime(`${dateYmd} ${pad(startHour)}:00:00`, TZ).toISOString();
  const ends_at = fromZonedTime(`${dateYmd} ${pad(endHour)}:00:00`, TZ).toISOString();
  return { starts_at, ends_at };
}

async function main() {
  const sb = loadEnvClient();

  const { data: shoremen, error: rErr } = await sb
    .from("resources")
    .select("id, slug")
    .eq("slug", "shoremen")
    .single();
  if (rErr || !shoremen) throw new Error(`shoremen resource: ${rErr?.message}`);

  const { data: holder, error: hErr } = await sb
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", HOLDER_EMAIL)
    .maybeSingle();
  if (hErr) throw new Error(hErr.message);
  if (!holder) {
    throw new Error(
      `Holder profile ${HOLDER_EMAIL} missing — sign in once or seed allowlist first`
    );
  }

  const dates = [...SHOREMEN_DATES].sort();
  const rangeStart = dates[0];
  const rangeEnd = dates[dates.length - 1];
  const rangeStartIso = fromZonedTime(`${rangeStart} 00:00:00`, TZ).toISOString();
  const rangeEndExclusive = (() => {
    const { y, m, d } = parseYmd(rangeEnd);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return fromZonedTime(`${ymdFromUtcDate(next)} 00:00:00`, TZ).toISOString();
  })();

  const { data: prior, error: priorErr } = await sb
    .from("bookings")
    .select("id")
    .eq("resource_id", shoremen.id)
    .gte("starts_at", rangeStartIso)
    .lt("starts_at", rangeEndExclusive)
    .eq("status", "confirmed")
    .like("notes", `${NOTE_PREFIX}%`);
  if (priorErr) throw new Error(priorErr.message);

  if (prior?.length) {
    const { error: cancelErr } = await sb
      .from("bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in(
        "id",
        prior.map((b) => b.id)
      );
    if (cancelErr) throw new Error(cancelErr.message);
    console.log(`cancelled prior Shoremen bookings: ${prior.length}`);
  }

  const rows = [];
  for (const date of SHOREMEN_DATES) {
    for (const slot of SHOREMEN_SLOTS) {
      const { starts_at, ends_at } = sessionRange(date, slot.startHour, slot.endHour);
      rows.push({
        resource_id: shoremen.id,
        coach_user_id: holder.id,
        starts_at,
        ends_at,
        status: "confirmed",
        notes: `${NOTE_PREFIX}${slot.label}`,
      });
    }
  }

  const { error: insErr } = await sb.from("bookings").insert(rows);
  if (insErr) throw new Error(`insert Shoremen: ${insErr.message}`);

  console.log(
    `inserted ${rows.length} Shoremen slots (${SHOREMEN_DATES.length} nights × ${SHOREMEN_SLOTS.length} hours, ${TZ}):`
  );
  for (const date of SHOREMEN_DATES) {
    for (const slot of SHOREMEN_SLOTS) {
      console.log(
        `  ${date}  ${pad(slot.startHour)}:00–${pad(slot.endHour)}:00  ${slot.label}`
      );
    }
  }
  console.log("Done. Open /schedule → Other → Train with the Shoremen.");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
