import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { EmailMyScheduleButton } from "@/components/EmailMyScheduleButton";
import { UnifiedSchedule } from "@/components/UnifiedSchedule";
import { WeekNav } from "@/components/WeekNav";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addDaysIsoRange,
  parseWeekParam,
  weekQueryParam,
} from "@/lib/schedule-query";
import type {
  AvailabilityWindow,
  Resource,
  ResourceBlock,
  ScheduleEvent,
  Team,
  TeamCoachInfo,
} from "@/lib/types";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { rangeStart, rangeEnd } = addDaysIsoRange(weekStart, 7);
  const supabase = await createClient();

  const [
    { data: resources, error: resourcesError },
    { data: windows, error: windowsError },
    { data: blocks, error: blocksError },
    { data: events, error: eventsError },
    { data: teams, error: teamsError },
    { data: myLinks, error: linksError },
    { data: coachRows, error: coachesError },
  ] = await Promise.all([
    supabase
      .from("resources")
      .select("id, slug, name, description, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("availability_windows")
      .select("id, resource_id, day_of_week, start_time, end_time"),
    supabase
      .from("resource_blocks")
      .select("id, resource_id, starts_at, ends_at, reason, created_by")
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart),
    supabase
      .from("schedule_events")
      .select(
        "id, resource_id, title, starts_at, ends_at, status, attendance_policy, notes, booking_id, created_by, resources(id, slug, name), schedule_event_teams(team_id, teams(id, name, age_group, sport, color))"
      )
      .eq("status", "confirmed")
      .gte("starts_at", rangeStart)
      .lt("starts_at", rangeEnd)
      .order("starts_at"),
    supabase
      .from("teams")
      .select("id, name, age_group, sport, color, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("team_coaches")
      .select("team_id")
      .eq("coach_user_id", session.profile.id),
    supabase
      .from("team_coaches")
      .select("team_id, profiles(full_name, email)"),
  ]);

  const errors = [
    resourcesError?.message,
    windowsError?.message,
    blocksError?.message,
    eventsError?.message,
    teamsError?.message,
    linksError?.message,
    coachesError?.message,
  ].filter(Boolean);

  const myTeamIds = (myLinks || []).map((l) => l.team_id);

  const coaches: TeamCoachInfo[] = [];
  for (const row of coachRows || []) {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!p) continue;
    coaches.push({
      team_id: row.team_id,
      full_name: p.full_name ?? null,
      email: p.email,
    });
  }

  return (
    <div>
      <AppHeader profile={session.profile} active="schedule" />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-1 text-xl font-semibold text-[var(--maroon)]">
          Weekly schedule
        </h1>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-2xl text-sm text-stone-600">
            One calendar for cages, gym, T3, and Train with the Shoremen /
            ShoreGals. Use <strong>Full calendar</strong> to see everyone (and
            trade). Use <strong>My team list</strong> for your team’s
            commitment, then{" "}
            <strong className="font-semibold text-stone-700">
              Email my schedule
            </strong>{" "}
            for that team.
          </p>
          <EmailMyScheduleButton />
        </div>
        <WeekNav weekStart={weekStart} basePath="/schedule" />
        {errors.length > 0 && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Could not load some schedule data. If you just pulled this branch,
            apply migration{" "}
            <code className="font-mono text-xs">004_teams_and_events.sql</code>{" "}
            and run{" "}
            <code className="font-mono text-xs">
              node scripts/seed-teams-and-events.mjs
            </code>
            . {errors.join(" · ")}
          </p>
        )}
        <div className="mt-4">
          <UnifiedSchedule
            weekStartIso={weekQueryParam(weekStart)}
            resources={(resources || []) as Resource[]}
            windows={(windows || []) as AvailabilityWindow[]}
            blocks={(blocks || []) as ResourceBlock[]}
            events={(events || []) as unknown as ScheduleEvent[]}
            teams={(teams || []) as Team[]}
            coaches={coaches}
            myTeamIds={myTeamIds}
            profile={session.profile}
          />
        </div>
      </main>
    </div>
  );
}
