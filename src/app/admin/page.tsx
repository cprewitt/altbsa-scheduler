import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { WeekGrid } from "@/components/WeekGrid";
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
  Booking,
  Resource,
  ResourceBlock,
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
    { data: bookings, error: bookingsError },
    { data: blocks, error: blocksError },
    { data: coaches, error: coachesError },
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
      .from("bookings")
      .select(
        "id, resource_id, coach_user_id, starts_at, ends_at, status, notes, profiles(full_name, email)"
      )
      .eq("status", "confirmed")
      .gte("starts_at", rangeStart)
      .lt("starts_at", rangeEnd),
    supabase
      .from("resource_blocks")
      .select("id, resource_id, starts_at, ends_at, reason, created_by")
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart),
    supabase
      .from("profiles")
      .select("id, email, full_name")
      .order("full_name", { ascending: true, nullsFirst: false }),
  ]);

  const errors = [
    resourcesError?.message,
    windowsError?.message,
    bookingsError?.message,
    blocksError?.message,
    coachesError?.message,
  ].filter(Boolean);

  return (
    <div>
      <AppHeader profile={session.profile} active="admin" />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-1 text-xl font-semibold text-[var(--maroon)]">
          Admin override
        </h1>
        <p className="mb-4 text-sm text-stone-600">
          Book for a coach, cancel any booking, or block open slots.
        </p>
        <WeekNav weekStart={weekStart} basePath="/admin" />
        {errors.length > 0 && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {errors.join(" · ")}
          </p>
        )}
        <div className="mt-4">
          <WeekGrid
            weekStartIso={weekQueryParam(weekStart)}
            resources={(resources || []) as Resource[]}
            windows={(windows || []) as AvailabilityWindow[]}
            bookings={(bookings || []) as unknown as Booking[]}
            blocks={(blocks || []) as ResourceBlock[]}
            profile={session.profile}
            mode="admin"
            coaches={coaches || []}
          />
        </div>
      </main>
    </div>
  );
}
