/**
 * Seed Feb–Apr 2027 weekly Court (gym) bookings from the locked draft.
 * Starts after HS Aux ends (first sessions Sat Feb 13, 2027).
 * Safe to re-run: cancels prior "Gym weekly ·" court bookings in range first.
 *
 * Assumptions baked in (Matt pending treated as blocked via resource_blocks):
 * - NEO soccer Sat 3–5 PM
 * - Drop-in Fri/Sat from 6 PM
 * - Soccer Shots Sat 1–3 PM
 * - BOSS volleyball Mon/Wed 4–8, Tue/Thu 6–10
 * - Easter Sun Mar 28 blackout
 * - T3 week: skip that team's gym (pairings synced with seed-t3-sessions.mjs)
 *
 * Usage: node scripts/seed-february-gym.mjs
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
const NOTE_PREFIX = "Gym weekly · ";
const BLOCK_NOTE_PREFIX = "Facility hold · ";
const RANGE_START = "2027-02-13"; // first day after Fri Feb 12 HS Aux
const RANGE_END = "2027-04-11"; // inclusive last calendar day

/** day 0=Sun … 6=Sat, hour = local start hour */
const WEEKLY = [
  // Saturday — Sunday-cage teams
  { day: 6, hour: 9, email: "smoennich5@yahoo.com", team: "7U Maroon Baseball" },
  { day: 6, hour: 10, email: "wbmckinley@gmail.com", team: "9U Maroon Baseball" },
  { day: 6, hour: 11, email: "andrew.prescott87@gmail.com", team: "13U Gold Baseball" },
  { day: 6, hour: 12, email: "robert.lomax21@gmail.com", team: "12U Gold Baseball" },
  { day: 6, hour: 17, email: "michael@textbookpainting.com", team: "14U Maroon Softball" },
  // Sunday
  { day: 0, hour: 9, email: "j.gigliotti@icloud.com", team: "12U Gold Softball" },
  { day: 0, hour: 10, email: "awruda@gmail.com", team: "10U White Baseball" },
  { day: 0, hour: 11, email: "k.dunn3@yahoo.com", team: "13U Maroon Baseball" },
  { day: 0, hour: 12, email: "mselbylaw@gmail.com", team: "14U Maroon Baseball" },
  { day: 0, hour: 13, email: "kennethremymd@gmail.com", team: "9U White Baseball" },
  { day: 0, hour: 14, email: "mbrackmanjr@gmail.com", team: "12U Maroon Baseball" },
  { day: 0, hour: 15, email: "woodalljt3@yahoo.com", team: "10U Gold Softball" },
  { day: 0, hour: 16, email: "bjschuler12@gmail.com", team: "11U Gold Baseball" },
  { day: 0, hour: 17, email: "smoennich5@yahoo.com", team: "10U Maroon Baseball" },
  // Sunday 6pm — moved from Fri 4pm (open; Easter blackout still applies)
  { day: 0, hour: 18, email: "chuck.zubek@gmail.com", team: "11U Maroon Baseball" },
  // Monday late — Svihlik (Sat-cage rule N/A; Wed cages → Mon gym)
  { day: 1, hour: 20, email: "csvihlik99@gmail.com", team: "12U Maroon Softball" },
  // Tuesday — includes Sat-cage 10U Gold BB
  { day: 2, hour: 16, email: "dannyw43@gmail.com", team: "10U Gold Baseball" },
  { day: 2, hour: 17, email: "hurley0603@gmail.com", team: "8U Gold Baseball" },
  // Thursday — Sat-cage 9U Gold + 10U Maroon SB
  { day: 4, hour: 16, email: "jjavers09@jcu.edu", team: "9U Gold Baseball" },
  { day: 4, hour: 17, email: "stags22@hotmail.com", team: "10U Maroon Softball" },
  // Friday — Sat-cage 8U Maroon (before drop-in 6pm)
  { day: 5, hour: 17, email: "greg.rustad@yahoo.com", team: "8U Maroon Baseball" },
];

/**
 * T3 Fridays → teams that skip gym that ISO week.
 * Keep in sync with scripts/seed-t3-sessions.mjs (same age band only; Feb 12 = 13Us).
 */
const T3_BY_FRIDAY = {
  "2027-02-05": ["14U Maroon Baseball", "14U Maroon Softball"],
  "2027-02-12": ["13U Maroon Baseball", "13U Gold Baseball"],
  "2027-02-19": ["12U Maroon Baseball", "12U Gold Baseball"],
  "2027-02-26": ["11U Maroon Baseball", "11U Gold Baseball"],
  "2027-03-05": ["10U Maroon Baseball", "10U Gold Baseball"],
  "2027-03-12": ["9U Maroon Baseball", "9U Gold Baseball"],
  "2027-03-19": ["8U Maroon Baseball", "8U Gold Baseball"],
  "2027-04-02": ["12U Maroon Softball", "12U Gold Softball"],
  "2027-04-09": ["10U Maroon Softball", "10U Gold Softball"],
};

const EASTER = "2027-03-28";

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
  let cur = new Date(Date.UTC(...Object.values(parseYmd(startYmd)).map((v, i) => (i === 1 ? v - 1 : v))));
  const end = new Date(Date.UTC(...Object.values(parseYmd(endYmd)).map((v, i) => (i === 1 ? v - 1 : v))));
  while (cur <= end) {
    dates.push(ymdFromUtcDate(cur));
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

function isoWeekKey(ymd) {
  // Use Date in UTC noon to get stable ISO week
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  // ISO week: Thursday-based
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${pad(week)}`;
}

function slotRange(dateYmd, hour) {
  const startLocal = `${dateYmd} ${pad(hour)}:00:00`;
  const endLocal = `${dateYmd} ${pad(hour + 1)}:00:00`;
  return {
    starts_at: fromZonedTime(startLocal, TZ).toISOString(),
    ends_at: fromZonedTime(endLocal, TZ).toISOString(),
  };
}

function blockRange(dateYmd, startHour, endHour) {
  const startLocal = `${dateYmd} ${pad(startHour)}:00:00`;
  const endLocal = `${dateYmd} ${pad(endHour)}:00:00`;
  return {
    starts_at: fromZonedTime(startLocal, TZ).toISOString(),
    ends_at: fromZonedTime(endLocal, TZ).toISOString(),
  };
}

async function ensureCoachUser(sb, email, fullName) {
  const normalized = email.toLowerCase();
  const { data: existing } = await sb
    .from("profiles")
    .select("id, email, full_name")
    .eq("email", normalized)
    .maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await sb.auth.admin.createUser({
    email: normalized,
    email_confirm: true,
    user_metadata: { full_name: fullName || "" },
  });
  if (error) {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
    const hit = list?.users?.find((u) => (u.email || "").toLowerCase() === normalized);
    if (!hit) throw new Error(`createUser ${normalized}: ${error.message}`);
    const { data: profile } = await sb
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", hit.id)
      .maybeSingle();
    if (profile) return profile;
    throw new Error(`User ${normalized} exists in auth but has no profile`);
  }

  const { data: profile, error: pErr } = await sb
    .from("profiles")
    .select("id, email, full_name")
    .eq("id", created.user.id)
    .maybeSingle();
  if (pErr || !profile) {
    throw new Error(`Profile missing after create for ${normalized}: ${pErr?.message}`);
  }
  return profile;
}

async function main() {
  const sb = loadEnvClient();

  const { data: court, error: rErr } = await sb
    .from("resources")
    .select("id, slug")
    .eq("slug", "court")
    .single();
  if (rErr || !court) throw new Error(`court resource: ${rErr?.message}`);

  const { data: allowlist, error: aErr } = await sb
    .from("allowed_emails")
    .select("email, full_name");
  if (aErr) throw new Error(aErr.message);
  const nameByEmail = new Map(
    (allowlist || []).map((a) => [a.email.toLowerCase(), a.full_name || a.email])
  );

  const emails = [...new Set(WEEKLY.map((w) => w.email.toLowerCase()))];
  const profileByEmail = new Map();
  for (const email of emails) {
    const profile = await ensureCoachUser(sb, email, nameByEmail.get(email));
    profileByEmail.set(email, profile);
    console.log("coach ready:", profile.full_name || profile.email);
  }

  const rangeStartIso = fromZonedTime(`${RANGE_START} 00:00:00`, TZ).toISOString();
  const rangeEndExclusive = (() => {
    const { y, m, d } = parseYmd(RANGE_END);
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    return fromZonedTime(`${ymdFromUtcDate(next)} 00:00:00`, TZ).toISOString();
  })();

  // Cancel prior seeded gym weekly bookings in range
  const { data: prior, error: priorErr } = await sb
    .from("bookings")
    .select("id")
    .eq("resource_id", court.id)
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
    console.log(`cancelled prior gym weekly bookings: ${prior.length}`);
  }

  // Replace facility holds we own in range
  const { data: priorBlocks, error: pbErr } = await sb
    .from("resource_blocks")
    .select("id")
    .eq("resource_id", court.id)
    .gte("starts_at", rangeStartIso)
    .lt("starts_at", rangeEndExclusive)
    .like("reason", `${BLOCK_NOTE_PREFIX}%`);
  if (pbErr) throw new Error(pbErr.message);
  if (priorBlocks?.length) {
    const { error: delErr } = await sb
      .from("resource_blocks")
      .delete()
      .in(
        "id",
        priorBlocks.map((b) => b.id)
      );
    if (delErr) throw new Error(delErr.message);
    console.log(`removed prior facility holds: ${priorBlocks.length}`);
  }

  const t3WeekTeams = new Map();
  for (const [fri, teams] of Object.entries(T3_BY_FRIDAY)) {
    t3WeekTeams.set(isoWeekKey(fri), new Set(teams));
  }

  const allDates = eachDateInRange(RANGE_START, RANGE_END);
  const rows = [];
  let skippedT3 = 0;
  let skippedEaster = 0;

  for (const slot of WEEKLY) {
    const profile = profileByEmail.get(slot.email.toLowerCase());
    if (!profile) throw new Error(`No profile for ${slot.email}`);
    for (const dateYmd of allDates) {
      const dt = new Date(Date.UTC(...Object.values(parseYmd(dateYmd)).map((v, i) => (i === 1 ? v - 1 : v))));
      if (dt.getUTCDay() !== slot.day) continue;
      if (dateYmd === EASTER && slot.day === 0) {
        skippedEaster += 1;
        continue;
      }
      const skipTeams = t3WeekTeams.get(isoWeekKey(dateYmd));
      if (skipTeams?.has(slot.team)) {
        skippedT3 += 1;
        continue;
      }
      const { starts_at, ends_at } = slotRange(dateYmd, slot.hour);
      rows.push({
        resource_id: court.id,
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
    `inserted ${inserted} gym bookings (${WEEKLY.length} weekly slots); skipped T3=${skippedT3} Easter=${skippedEaster}`
  );

  // Facility holds (Matt calendar + pending)
  const blocks = [];
  for (const dateYmd of allDates) {
    const dow = new Date(
      Date.UTC(...Object.values(parseYmd(dateYmd)).map((v, i) => (i === 1 ? v - 1 : v)))
    ).getUTCDay();

    if (dateYmd === EASTER) {
      blocks.push({
        resource_id: court.id,
        starts_at: fromZonedTime(`${dateYmd} 08:00:00`, TZ).toISOString(),
        ends_at: fromZonedTime(`${dateYmd} 22:00:00`, TZ).toISOString(),
        reason: `${BLOCK_NOTE_PREFIX}Easter blackout`,
      });
      continue;
    }

    // BOSS volleyball
    if (dow === 1 || dow === 3) {
      // Mon/Wed 4–8
      const r = blockRange(dateYmd, 16, 20);
      blocks.push({
        resource_id: court.id,
        ...r,
        reason: `${BLOCK_NOTE_PREFIX}BOSS CLE Volleyball`,
      });
    }
    if (dow === 2 || dow === 4) {
      // Tue/Thu 6–10
      const r = blockRange(dateYmd, 18, 22);
      blocks.push({
        resource_id: court.id,
        ...r,
        reason: `${BLOCK_NOTE_PREFIX}BOSS CLE Volleyball`,
      });
    }

    if (dow === 5) {
      // Fri drop-in from 6pm (pending — treated as blocked)
      const r = blockRange(dateYmd, 18, 22);
      blocks.push({
        resource_id: court.id,
        ...r,
        reason: `${BLOCK_NOTE_PREFIX}Drop-in (pending hold)`,
      });
    }

    if (dow === 6) {
      blocks.push({
        resource_id: court.id,
        ...blockRange(dateYmd, 13, 15),
        reason: `${BLOCK_NOTE_PREFIX}Soccer Shots half court`,
      });
      blocks.push({
        resource_id: court.id,
        ...blockRange(dateYmd, 15, 17),
        reason: `${BLOCK_NOTE_PREFIX}NEO soccer (pending hold)`,
      });
      blocks.push({
        resource_id: court.id,
        ...blockRange(dateYmd, 18, 22),
        reason: `${BLOCK_NOTE_PREFIX}Drop-in (pending hold)`,
      });
    }
  }

  let blocksInserted = 0;
  for (let i = 0; i < blocks.length; i += 50) {
    const chunk = blocks.slice(i, i + 50);
    const { error } = await sb.from("resource_blocks").insert(chunk);
    if (error) throw new Error(`block chunk ${i}: ${error.message}`);
    blocksInserted += chunk.length;
  }
  console.log(`inserted ${blocksInserted} facility holds on court`);
  console.log(`Done. Open /schedule → Court, weeks from ${RANGE_START}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
