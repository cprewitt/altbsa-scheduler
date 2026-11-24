/**
 * Upsert teams + backfill schedule_events from confirmed bookings.
 * Safe to re-run: cancels prior auto-backfilled events in season range first
 * (notes marker), then recreates from current bookings.
 *
 * Usage: node scripts/seed-teams-and-events.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const MARK = "auto-backfill";
const SEASON_START = "2027-01-01T00:00:00.000Z";
const SEASON_END = "2027-05-01T00:00:00.000Z";

const DEFAULT_TITLE = {
  cages: "Batting cages",
  court: "Gym",
  t3: "T3",
  shoremen: "Train with the Shoremen",
  shoregals: "Train with the ShoreGals",
};

const DEFAULT_POLICY = {
  cages: "bookable",
  court: "bookable",
  t3: "team_optional",
  shoremen: "fixed",
  shoregals: "fixed",
};

function parseTeamName(raw) {
  const cleaned = String(raw || "")
    .replace(/^(?:Jan weekly|Gym weekly|T3)\s*·\s*/i, "")
    .replace(/\s+vs\s+.+$/i, "")
    .trim();
  const m = cleaned.match(
    /^(\d{1,2}U)\s+(Maroon|Gold|White)\s+(Baseball|Softball)$/i
  );
  if (!m) return null;
  const age_group = m[1].toUpperCase();
  const color = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
  const sport = m[3].toLowerCase() === "softball" ? "softball" : "baseball";
  return {
    name: `${age_group} ${color} ${sport === "softball" ? "Softball" : "Baseball"}`,
    age_group,
    color,
    sport,
  };
}

function teamNamesFromNotes(notes) {
  if (!notes) return [];
  const body = notes
    .replace(/^(?:Jan weekly|Gym weekly|T3|Shoremen|ShoreGals)\s*·\s*/i, "")
    .trim();
  if (/\dU\s*\+|HS Aux/i.test(body)) return [];
  if (/vs/i.test(body)) {
    return body
      .split(/\s+vs\s+/i)
      .map((s) => s.trim())
      .map((s) => parseTeamName(s)?.name)
      .filter(Boolean);
  }
  const one = parseTeamName(notes);
  return one ? [one.name] : [];
}

function ageGroupsFromShoremen(notes) {
  if (!notes) return [];
  const plus = notes.match(/(\d{1,2}U)\s*\+\s*(\d{1,2}U)/i);
  if (plus) return [plus[1].toUpperCase(), plus[2].toUpperCase()];
  const range = notes.match(/(\d{1,2}U)\s*[–-]\s*(\d{1,2}U)/i);
  if (!range) return [];
  // parseInt("9U", 10) → 9; Number("9U") → NaN (left 9U–10U / 11U–12U unlinked)
  const a = parseInt(range[1], 10);
  const b = parseInt(range[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
  const out = [];
  for (let i = a; i <= b; i++) out.push(`${i}U`);
  return out;
}

async function main() {
  const sb = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: resources, error: rErr } = await sb
    .from("resources")
    .select("id, slug");
  if (rErr) throw rErr;
  const resourceBySlug = Object.fromEntries(resources.map((r) => [r.slug, r]));

  const { data: bookings, error: bErr } = await sb
    .from("bookings")
    .select(
      "id, resource_id, coach_user_id, starts_at, ends_at, status, notes"
    )
    .eq("status", "confirmed")
    .gte("starts_at", SEASON_START)
    .lt("starts_at", SEASON_END);
  if (bErr) throw bErr;

  // Discover teams from notes + coach links
  const teamMap = new Map(); // name -> {name,age,color,sport}
  const coachByTeam = new Map(); // name -> coach_user_id

  for (const b of bookings || []) {
    const slug = resources.find((r) => r.id === b.resource_id)?.slug;
    if (slug === "shoremen" || slug === "shoregals") continue;
    for (const name of teamNamesFromNotes(b.notes)) {
      const parsed = parseTeamName(name);
      if (!parsed) continue;
      teamMap.set(parsed.name, parsed);
      if (b.coach_user_id && slug !== "t3") {
        // cage/court bookings are owned by the team coach
        coachByTeam.set(parsed.name, b.coach_user_id);
      }
    }
    // T3 pairings still register both teams
    if (slug === "t3") {
      for (const name of teamNamesFromNotes(b.notes)) {
        const parsed = parseTeamName(name);
        if (parsed) teamMap.set(parsed.name, parsed);
      }
    }
  }

  // Ensure common baseball/softball ages exist for Shoremen bands
  for (const age of ["7U", "8U", "9U", "10U", "11U", "12U"]) {
    for (const color of ["Maroon", "Gold", "White"]) {
      for (const sport of ["Baseball", "Softball"]) {
        // only add if we already saw that age somewhere, or always add Maroon/Gold for baseball 7-12
        if (sport === "Baseball" && (color === "Maroon" || color === "Gold")) {
          const name = `${age} ${color} Baseball`;
          if (!teamMap.has(name)) {
            teamMap.set(name, {
              name,
              age_group: age,
              color,
              sport: "baseball",
            });
          }
        }
      }
    }
  }

  console.log(`upserting ${teamMap.size} teams…`);
  const teamIdByName = new Map();
  for (const t of teamMap.values()) {
    const { data, error } = await sb
      .from("teams")
      .upsert(
        {
          name: t.name,
          age_group: t.age_group,
          sport: t.sport,
          color: t.color,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "name" }
      )
      .select("id, name")
      .single();
    if (error) throw error;
    teamIdByName.set(data.name, data.id);
  }

  // Coach links from cage/court ownership
  let coachLinks = 0;
  for (const [name, coachId] of coachByTeam.entries()) {
    const teamId = teamIdByName.get(name);
    if (!teamId) continue;
    const { error } = await sb.from("team_coaches").upsert(
      { team_id: teamId, coach_user_id: coachId, is_primary: true },
      { onConflict: "team_id,coach_user_id" }
    );
    if (error) throw error;
    coachLinks++;
  }
  console.log(`team_coaches upserts: ${coachLinks}`);

  // Cancel prior auto-backfill events
  const { data: prior } = await sb
    .from("schedule_events")
    .select("id")
    .eq("status", "confirmed")
    .gte("starts_at", SEASON_START)
    .lt("starts_at", SEASON_END)
    .ilike("notes", `%${MARK}%`);
  if (prior?.length) {
    const { error } = await sb
      .from("schedule_events")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in(
        "id",
        prior.map((p) => p.id)
      );
    if (error) throw error;
    console.log(`cancelled prior backfill events: ${prior.length}`);
  }

  let created = 0;
  for (const b of bookings || []) {
    const slug = resources.find((r) => r.id === b.resource_id)?.slug;
    if (!slug || !DEFAULT_TITLE[slug]) continue;

    let teamIds = [];
    if (slug === "shoremen" || slug === "shoregals") {
      const ages = ageGroupsFromShoremen(b.notes);
      const sport = slug === "shoregals" ? "softball" : "baseball";
      for (const [name, id] of teamIdByName.entries()) {
        const t = teamMap.get(name);
        if (t && t.sport === sport && ages.includes(t.age_group)) {
          teamIds.push(id);
        }
      }
      // dedupe
      teamIds = [...new Set(teamIds)];
    } else {
      teamIds = teamNamesFromNotes(b.notes)
        .map((n) => teamIdByName.get(n))
        .filter(Boolean);
    }

    const { data: ev, error: eErr } = await sb
      .from("schedule_events")
      .insert({
        resource_id: b.resource_id,
        title: DEFAULT_TITLE[slug],
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        status: "confirmed",
        attendance_policy: DEFAULT_POLICY[slug],
        notes: `${MARK} · ${b.notes || slug}`,
        booking_id: ["cages", "court"].includes(slug) ? b.id : null,
        created_by: b.coach_user_id,
      })
      .select("id")
      .single();
    if (eErr) throw eErr;

    if (teamIds.length) {
      const { error: tErr } = await sb.from("schedule_event_teams").insert(
        teamIds.map((team_id) => ({ event_id: ev.id, team_id }))
      );
      if (tErr) throw tErr;
    }
    created++;
  }

  console.log(`created ${created} schedule_events`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
