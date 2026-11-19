/**
 * Seed baseball T3 (Building Two) Friday sessions into the `t3` resource.
 * Fridays 7:00–8:30 PM America/New_York; two teams share each date (one booking).
 *
 * Priority: 13U / 14U first (Feb 5 + Feb 12), then older→younger; leftover slots
 * filled with softball. Feb 12 is 13U Maroon + 14U Maroon (HS Aux conflict rule).
 *
 * Safe to re-run: cancels prior "T3 ·" bookings on t3 in range first.
 *
 * Usage: node scripts/seed-t3-sessions.mjs
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
const NOTE_PREFIX = "T3 · ";
/** Admin holder for shared vs sessions (schema forbids two overlapping confirmed bookings). */
const HOLDER_EMAIL = "tryouts@altbsa.org";

/**
 * Locked pairings (2026-11-19): 13U/14U first; Feb 12 = 13U+14U.
 * Keep in sync with T3_BY_FRIDAY in seed-february-gym.mjs.
 */
export const T3_SESSIONS = [
  {
    date: "2027-02-05",
    teams: ["13U Gold Baseball", "12U Gold Baseball"],
  },
  {
    date: "2027-02-12",
    teams: ["13U Maroon Baseball", "14U Maroon Baseball"],
  },
  {
    date: "2027-02-19",
    teams: ["12U Maroon Baseball", "11U Maroon Baseball"],
  },
  {
    date: "2027-02-26",
    teams: ["11U Gold Baseball", "10U White Baseball"],
  },
  {
    date: "2027-03-05",
    teams: ["10U Maroon Baseball", "10U Gold Baseball"],
  },
  {
    date: "2027-03-12",
    teams: ["9U Maroon Baseball", "9U Gold Baseball"],
  },
  {
    date: "2027-03-19",
    teams: ["9U White Baseball", "8U Maroon Baseball"],
  },
  {
    date: "2027-04-02",
    teams: ["8U Gold Baseball", "12U Maroon Softball"],
  },
  {
    date: "2027-04-09",
    teams: ["10U Maroon Softball", "10U Gold Softball"],
  },
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
  // 7:00–8:30 PM facility-local
  const starts_at = fromZonedTime(`${dateYmd} 19:00:00`, TZ).toISOString();
  const ends_at = fromZonedTime(`${dateYmd} 20:30:00`, TZ).toISOString();
  return { starts_at, ends_at };
}

async function main() {
  const sb = loadEnvClient();

  const { data: t3, error: rErr } = await sb
    .from("resources")
    .select("id, slug")
    .eq("slug", "t3")
    .single();
  if (rErr || !t3) throw new Error(`t3 resource: ${rErr?.message}`);

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

  const dates = T3_SESSIONS.map((s) => s.date).sort();
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
    .eq("resource_id", t3.id)
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
    console.log(`cancelled prior T3 bookings: ${prior.length}`);
  }

  const rows = T3_SESSIONS.map((s) => {
    const { starts_at, ends_at } = sessionRange(s.date);
    return {
      resource_id: t3.id,
      coach_user_id: holder.id,
      starts_at,
      ends_at,
      status: "confirmed",
      notes: `${NOTE_PREFIX}${s.teams[0]} vs ${s.teams[1]}`,
    };
  });

  const { error: insErr } = await sb.from("bookings").insert(rows);
  if (insErr) throw new Error(`insert T3: ${insErr.message}`);

  console.log(`inserted ${rows.length} T3 sessions (7:00–8:30 PM ${TZ}):`);
  for (const s of T3_SESSIONS) {
    console.log(`  ${s.date}  ${s.teams[0]} vs ${s.teams[1]}`);
  }
  console.log("Done. Open /schedule → Other → T3.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
