/**
 * Seed January 2027 weekly cage bookings from the locked Anchor draft.
 * Safe to re-run: cancels prior "Jan weekly" cage bookings first.
 *
 * Usage: node scripts/seed-january-cages.mjs
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
const YEAR = 2027;
const MONTH = 0; // January

/** Locked draft: day 0=Sun … 6=Sat, hour = local start hour */
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
  // Sunday 7–8 PM (moved off Friday 6–7 to avoid Shoremen Fri nights at ALHS)
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

function januaryDatesForDow(dayOfWeek) {
  const dates = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(YEAR, MONTH, d));
    if (dt.getUTCMonth() !== MONTH) break;
    if (dt.getUTCDay() === dayOfWeek) {
      dates.push(`${YEAR}-${pad(MONTH + 1)}-${pad(d)}`);
    }
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
    // Race / already exists in auth but no profile yet
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

  const { data: cages, error: rErr } = await sb
    .from("resources")
    .select("id, slug")
    .eq("slug", "cages")
    .single();
  if (rErr || !cages) throw new Error(`cages resource: ${rErr?.message}`);

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

  // Cancel prior seeded January weekly cage bookings (re-run safe)
  const janStart = fromZonedTime(`${YEAR}-01-01 00:00:00`, TZ).toISOString();
  const febStart = fromZonedTime(`${YEAR}-02-01 00:00:00`, TZ).toISOString();
  const { data: prior, error: priorErr } = await sb
    .from("bookings")
    .select("id, notes, status")
    .eq("resource_id", cages.id)
    .gte("starts_at", janStart)
    .lt("starts_at", febStart)
    .eq("status", "confirmed")
    .like("notes", `${NOTE_PREFIX}%`);
  if (priorErr) throw new Error(priorErr.message);

  if (prior?.length) {
    const ids = prior.map((b) => b.id);
    const { error: cancelErr } = await sb
      .from("bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", ids);
    if (cancelErr) throw new Error(cancelErr.message);
    console.log(`cancelled prior Jan weekly bookings: ${ids.length}`);
  }

  const rows = [];
  for (const slot of WEEKLY) {
    const profile = profileByEmail.get(slot.email.toLowerCase());
    if (!profile) throw new Error(`No profile for ${slot.email}`);
    for (const dateYmd of januaryDatesForDow(slot.day)) {
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

  // Insert in chunks
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { error } = await sb.from("bookings").insert(chunk);
    if (error) throw new Error(`insert chunk ${i}: ${error.message}`);
    inserted += chunk.length;
  }

  console.log(`inserted ${inserted} January ${YEAR} cage bookings (${WEEKLY.length} weekly slots)`);
  console.log("Done. Open /schedule and jump to a January 2027 week to review.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
