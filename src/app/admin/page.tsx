import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
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
  Profile,
  Resource,
  ResourceBlock,
  ScheduleEvent,
  Team,
  TeamCoachInfo,
} from "@/lib/types";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");
  if (session.profile.role !== "admin") redirect("/schedule");

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
    { data: adminCoaches, error: adminCoachesError },
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
    supabase
      .from("profiles")
      .select("id, email, full_name")
      .order("full_name", { ascending: true, nullsFirst: false }),
  ]);

  const errors = [
    resourcesError?.message,
    windowsError?.message,
    blocksError?.message,
    eventsError?.message,
    teamsError?.message,
    linksError?.message,
    coachesError?.message,
    adminCoachesError?.message,
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
      <AppHeader profile={session.profile} active="admin" />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-1 text-xl font-semibold text-[var(--maroon)]">
          Admin schedule
        </h1>
        <p className="mb-4 max-w-2xl text-sm text-stone-600">
          Same calendar as coaches. Use <strong>Book or block</strong> to add a
          cages/court booking or hold. Click an event for details; remove blocks
          from the calendar chips.
        </p>
        <WeekNav weekStart={weekStart} basePath="/admin" />
        {errors.length > 0 && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {errors.join(" · ")}
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
            mode="admin"
            adminCoaches={(adminCoaches || []) as Pick<
              Profile,
              "id" | "email" | "full_name"
            >[]}
          />
        </div>
      </main>
    </div>
  );
}
