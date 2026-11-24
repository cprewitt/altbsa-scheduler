import type {
  EventAttendancePolicy,
  Resource,
  ScheduleEvent,
  ScheduleEventTeam,
  SportKind,
  Team,
} from "@/lib/types";

export const LOCATION_SLUGS = [
  "cages",
  "court",
  "t3",
  "shoremen",
  "shoregals",
] as const;

export type LocationSlug = (typeof LOCATION_SLUGS)[number];

export const DEFAULT_EVENT_TITLE: Record<LocationSlug, string> = {
  cages: "Batting cages",
  court: "Gym",
  t3: "T3",
  shoremen: "Train with the Shoremen",
  shoregals: "Train with the ShoreGals",
};

export const DEFAULT_ATTENDANCE: Record<LocationSlug, EventAttendancePolicy> = {
  cages: "bookable",
  court: "bookable",
  t3: "team_optional",
  shoremen: "fixed",
  shoregals: "fixed",
};

export const LOCATION_CHIP_CLASS: Record<LocationSlug, string> = {
  cages: "bg-amber-100 text-amber-950 border-amber-300",
  court: "bg-sky-100 text-sky-950 border-sky-300",
  t3: "bg-violet-100 text-violet-950 border-violet-300",
  shoremen: "bg-[var(--maroon)]/10 text-[var(--maroon)] border-[var(--maroon)]/30",
  shoregals: "bg-rose-100 text-rose-950 border-rose-300",
};

export function resourceOf(
  event: ScheduleEvent
): Pick<Resource, "id" | "slug" | "name"> | null {
  const r = event.resources;
  if (!r) return null;
  return Array.isArray(r) ? r[0] || null : r;
}

export function teamsOf(event: ScheduleEvent): ScheduleEventTeam[] {
  const rows = event.schedule_event_teams || [];
  const out: ScheduleEventTeam[] = [];
  for (const row of rows) {
    const t = row.teams;
    if (!t) continue;
    if (Array.isArray(t)) out.push(...t);
    else out.push(t);
  }
  return out;
}

export function teamNamesLabel(teams: ScheduleEventTeam[]): string {
  if (!teams.length) return "Unassigned";
  if (teams.length === 1) return teams[0].name;
  // T3-style: "8U Maroon vs 8U Gold" when same age
  const ages = new Set(teams.map((t) => t.age_group));
  if (ages.size === 1 && teams.length === 2) {
    return `${teams[0].name.replace(/\s+Baseball|\s+Softball/g, "")} vs ${teams[1].name.replace(/\s+Baseball|\s+Softball/g, "")}`;
  }
  return teams.map((t) => t.name).join(", ");
}

export function eventIncludesTeam(event: ScheduleEvent, teamId: string): boolean {
  return teamsOf(event).some((t) => t.id === teamId);
}

export function parseTeamName(raw: string): {
  name: string;
  age_group: string;
  color: string | null;
  sport: SportKind;
} | null {
  const cleaned = raw
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

/** Extract one or two team names from booking notes (supports "A vs B"). */
export function teamNamesFromNotes(notes: string | null): string[] {
  if (!notes) return [];
  const body = notes
    .replace(/^(?:Jan weekly|Gym weekly|T3|Shoremen|ShoreGals)\s*·\s*/i, "")
    .trim();
  if (/vs/i.test(body)) {
    return body
      .split(/\s+vs\s+/i)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Age-band Shoremen: "HS Aux · 7U + 8U" — no single team
  if (/\dU\s*\+|HS Aux/i.test(body)) return [];
  const parsed = parseTeamName(notes);
  return parsed ? [parsed.name] : [];
}

export function ageGroupsFromShoremenLabel(notes: string | null): string[] {
  if (!notes) return [];
  const m = notes.match(/(\d{1,2}U)\s*\+\s*(\d{1,2}U)/i);
  if (m) return [m[1].toUpperCase(), m[2].toUpperCase()];
  const range = notes.match(/(\d{1,2}U)\s*[–-]\s*(\d{1,2}U)/i);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) {
      const out: string[] = [];
      for (let i = a; i <= b; i++) out.push(`${i}U`);
      return out;
    }
  }
  return [];
}

export function coachTeamsSmoothDefault(myTeams: Team[]): string | null {
  // One team → auto-focus (no picker friction). Multiple → caller shows picker.
  if (myTeams.length === 1) return myTeams[0].id;
  return null;
}
