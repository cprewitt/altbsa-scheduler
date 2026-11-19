/**
 * Seed Train with the Shoremen (HS Aux) nights into the `shoremen` resource.
 * Six locked dates from Chuck Nov 2 scheduling notes: 6:00–9:00 PM America/New_York,
 * 7U–12U. Per-hour team assignments still TBD (asked Chuck 2026-11-18; no reply).
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
/** Admin holder until per-team hour slots are assigned. */
const HOLDER_EMAIL = "tryouts@altbsa.org";

/**
 * Locked nights (Chuck Nov 2 Scheduling Call Notes):
 * Six Dates at HS Aux 6:00–9:00 PM, 7U–12U.
 * Also: DRAFT-email-Chuck-Shoremen-T3-slots.txt / Drive Forms copy.
 */
export const SHOREMEN_SESSIONS = [
  { date: "2027-01-08", label: "HS Aux · 7U–12U" },
  { date: "2027-01-15", label: "HS Aux · 7U–12U" },
  { date: "2027-01-19", label: "HS Aux · 7U–12U" },
  { date: "2027-01-29", label: "HS Aux · 7U–12U" },
  { date: "2027-02-02", label: "HS Aux · 7U–12U" },
  { date: "2027-02-12", label: "HS Aux · 7U–12U" },
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

function sessionRange(dateYmd) {
  // 6:00–9:00 PM facility-local
  const starts_at = fromZonedTime(`${dateYmd} 18:00:00`, TZ).toISOString();
  const ends_at = fromZonedTime(`${dateYmd} 21:00:00`, TZ).toISOString();
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

  const dates = SHOREMEN_SESSIONS.map((s) => s.date).sort();
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

  const rows = SHOREMEN_SESSIONS.map((s) => {
    const { starts_at, ends_at } = sessionRange(s.date);
    return {
      resource_id: shoremen.id,
      coach_user_id: holder.id,
      starts_at,
      ends_at,
      status: "confirmed",
      notes: `${NOTE_PREFIX}${s.label}`,
    };
  });

  const { error: insErr } = await sb.from("bookings").insert(rows);
  if (insErr) throw new Error(`insert Shoremen: ${insErr.message}`);

  console.log(`inserted ${rows.length} Shoremen sessions (6:00–9:00 PM ${TZ}):`);
  for (const s of SHOREMEN_SESSIONS) {
    console.log(`  ${s.date}  ${s.label}`);
  }
  console.log("Done. Open /schedule → Other → Train with the Shoremen.");
  console.log("Note: per-hour team slots (6–7 / 7–8 / 8–9) still TBD with Chuck.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
