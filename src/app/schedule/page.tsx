import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { EmailMyScheduleButton } from "@/components/EmailMyScheduleButton";
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
    { data: bookings, error: bookingsError },
    { data: blocks, error: blocksError },
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
  ]);

  const errors = [
    resourcesError?.message,
    windowsError?.message,
    bookingsError?.message,
    blocksError?.message,
  ].filter(Boolean);

  return (
    <div>
      <AppHeader profile={session.profile} active="schedule" />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <h1 className="mb-1 text-xl font-semibold text-[var(--maroon)]">
          Weekly schedule
        </h1>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-sm text-stone-600">
            Book an open slot for yourself — confirmed immediately when free.
            Cancel your own bookings anytime. Use{" "}
            <strong className="font-semibold text-stone-700">
              Email my schedule
            </strong>{" "}
            to send your confirmed cages/court/other sessions to your login
            email.
          </p>
          <EmailMyScheduleButton />
        </div>
        <WeekNav weekStart={weekStart} basePath="/schedule" />
        {errors.length > 0 && (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Could not load some schedule data. Confirm the SQL migration was
            applied and your Supabase keys are set. {errors.join(" · ")}
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
            mode="schedule"
          />
        </div>
      </main>
    </div>
  );
}
