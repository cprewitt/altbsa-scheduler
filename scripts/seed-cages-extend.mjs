/**
 * Extend weekly cage bookings using the locked January pattern through mid-April.
 * Covers 2027-02-01 … 2027-04-15 (inclusive). Safe to re-run: cancels prior
 * "Jan weekly ·" cage bookings in that window first (January itself untouched).
 *
 * Usage: node scripts/seed-cages-extend.mjs
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
const NOTE_PREFIX = "Jan weekly · ";
const RANGE_START = "2027-02-01";
const RANGE_END = "2027-04-15"; // mid-April inclusive

/** Same locked draft as seed-january-cages.mjs */
const WEEKLY = [
  { day: 1, hour: 17, email: "kennethremymd@gmail.com", team: "9U White Baseball" },
  { day: 1, hour: 18, email: "mbrackmanjr@gmail.com", team: "12U Maroon Baseball" },
  { day: 1, hour: 19, email: "k.dunn3@yahoo.com", team: "13U Maroon Baseball" },
  { day: 2, hour: 17, email: "smoennich5@yahoo.com", team: "10U Maroon Baseball" },
  { day: 2, hour: 18, email: "awruda@gmail.com", team: "10U White Baseball" },
  { day: 3, hour: 17, email: "j.gigliotti@icloud.com", team: "12U Gold Softball" },
  { day: 3, hour: 18, email: "mselbylaw@gmail.com", team: "14U Maroon Baseball" },
  { day: 3, hour: 19, email: "csvihlik99@gmail.com", team: "12U Maroon Softball" },
  { day: 4, hour: 18, email: "hurley0603@gmail.com", team: "8U Gold Baseball" },
  { day: 4, hour: 19, email: "bjschuler12@gmail.com", team: "11U Gold Baseball" },
  { day: 5, hour: 19, email: "woodalljt3@yahoo.com", team: "10U Gold Softball" },
  { day: 6, hour: 9, email: "jjavers09@jcu.edu", team: "9U Gold Baseball" },
  { day: 6, hour: 10, email: "greg.rustad@yahoo.com", team: "8U Maroon Baseball" },
  { day: 6, hour: 11, email: "chuck.zubek@gmail.com", team: "11U Maroon Baseball" },
  { day: 6, hour: 12, email: "dannyw43@gmail.com", team: "10U Gold Baseball" },
  { day: 6, hour: 13, email: "stags22@hotmail.com", team: "10U Maroon Softball" },
  { day: 0, hour: 13, email: "smoennich5@yahoo.com", team: "7U Maroon Baseball" },
  { day: 0, hour: 14, email: "andrew.prescott87@gmail.com", team: "13U Gold Baseball" },
  { day: 0, hour: 16, email: "wbmckinley@gmail.com", team: "9U Maroon Baseball" },
  { day: 0, hour: 18, email: "michael@textbookpainting.com", team: "14U Maroon Softball" },
  { day: 0, hour: 19, email: "robert.lomax21@gmail.com", team: "12U Gold Baseball" },
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

function eachDateInRange(startYmd, endYmd) {
  const dates = [];
  let cur = new Date(
    Date.UTC(
      ...Object.values(parseYmd(startYmd)).map((v, i) => (i === 1 ? v - 1 : v))
    )
  );
  const end = new Date(
    Date.UTC(
      ...Object.values(parseYmd(endYmd)).map((v, i) => (i === 1 ? v - 1 : v))
    )
  );
  while (cur <= end) {
    dates.push(ymdFromUtcDate(cur));
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

function slotRange(dateYmd, hour) {
  const startLocal = `${dateYmd} ${pad(hour)}:00:00`;
  const endLocal = `${dateYmd} ${pad(hour + 1)}:00:00`;
  return {
    starts_at: fromZonedTime(startLocal, TZ).toISOString(),
    ends_at: fromZonedTime(endLocal, TZ).toISOString(),
  };
}

async function main() {
  const sb = loadEnvClient();

  const { data: cages, error: rErr } = await sb
    .from("resources")
    .select("id, slug")
    .eq("slug", "cages")
    .single();
  if (rErr || !cages) throw new Error(`cages resource: ${rErr?.message}`);

  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("id, email");
  if (pErr) throw pErr;
  const profileByEmail = new Map(
    (profiles || []).map((p) => [p.email.toLowerCase(), p])
  );

  const rangeStartIso = fromZonedTime(`${RANGE_START} 00:00:00`, TZ).toISOString();
  const rangeEndExclusive = (() => {
    const { y, m, d } = parseYmd(RANGE_END);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return fromZonedTime(`${ymdFromUtcDate(next)} 00:00:00`, TZ).toISOString();
  })();

  const { data: prior, error: priorErr } = await sb
    .from("bookings")
    .select("id")
    .eq("resource_id", cages.id)
    .eq("status", "confirmed")
    .gte("starts_at", rangeStartIso)
    .lt("starts_at", rangeEndExclusive)
    .like("notes", `${NOTE_PREFIX}%`);
  if (priorErr) throw priorErr;

  if (prior?.length) {
    const { error } = await sb
      .from("bookings")
      .update({ status: "cancelled" })
      .in(
        "id",
        prior.map((p) => p.id)
      );
    if (error) throw error;
    console.log(`cancelled prior extend-range cage bookings: ${prior.length}`);
  }

  const dates = eachDateInRange(RANGE_START, RANGE_END);
  const rows = [];
  for (const slot of WEEKLY) {
    const profile = profileByEmail.get(slot.email.toLowerCase());
    if (!profile) {
      console.warn(`skip ${slot.team}: no profile for ${slot.email}`);
      continue;
    }
    for (const dateYmd of dates) {
      const dt = new Date(`${dateYmd}T12:00:00Z`);
      if (dt.getUTCDay() !== slot.day) continue;
      const { starts_at, ends_at } = slotRange(dateYmd, slot.hour);
      rows.push({
        resource_id: cages.id,
        coach_user_id: profile.id,
        starts_at,
        ends_at,
        status: "confirmed",
        notes: `${NOTE_PREFIX}${slot.team}`,
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await sb.from("bookings").insert(chunk);
    if (error) throw new Error(`insert chunk ${i}: ${error.message}`);
    inserted += chunk.length;
  }

  console.log(
    `inserted ${inserted} cage bookings ${RANGE_START} → ${RANGE_END} (${WEEKLY.length} weekly slots)`
  );
  console.log("Done. Re-run seed-teams-and-events.mjs to refresh calendar cards.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
