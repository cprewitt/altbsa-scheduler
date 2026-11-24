"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Drop one team from a team_optional (T3) event. Other teams stay. */
export async function leaveEventTeam(input: {
  eventId: string;
  teamId: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";

  const { data: event, error: eErr } = await supabase
    .from("schedule_events")
    .select("id, attendance_policy, status")
    .eq("id", input.eventId)
    .maybeSingle();
  if (eErr) return { error: eErr.message };
  if (!event || event.status !== "confirmed") {
    return { error: "Event not found." };
  }
  if (event.attendance_policy === "fixed") {
    return { error: "This session can’t be removed by coaches." };
  }
  if (event.attendance_policy !== "team_optional" && !isAdmin) {
    return { error: "Use cancel on bookable cage/gym slots." };
  }

  if (!isAdmin) {
    const { data: link } = await supabase
      .from("team_coaches")
      .select("team_id")
      .eq("team_id", input.teamId)
      .eq("coach_user_id", user.id)
      .maybeSingle();
    if (!link) return { error: "You can only leave teams you coach." };
  }

  const { error: dErr } = await supabase
    .from("schedule_event_teams")
    .delete()
    .eq("event_id", input.eventId)
    .eq("team_id", input.teamId);
  if (dErr) return { error: dErr.message };

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}

/** Cancel a bookable event (+ linked booking when present). */
export async function cancelScheduleEvent(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = profile?.role === "admin";

  const { data: event, error: eErr } = await supabase
    .from("schedule_events")
    .select("id, attendance_policy, created_by, booking_id, status")
    .eq("id", eventId)
    .maybeSingle();
  if (eErr) return { error: eErr.message };
  if (!event || event.status !== "confirmed") {
    return { error: "Event not found." };
  }
  if (event.attendance_policy === "fixed" && !isAdmin) {
    return { error: "This session can’t be cancelled by coaches." };
  }
  if (
    event.attendance_policy === "bookable" &&
    !isAdmin &&
    event.created_by !== user.id
  ) {
    return { error: "You can only cancel your own bookings." };
  }

  if (event.booking_id) {
    const { error: bErr } = await supabase
      .from("bookings")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", event.booking_id);
    if (bErr) return { error: bErr.message };
  }

  const { error: uErr } = await supabase
    .from("schedule_events")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", eventId);
  if (uErr) return { error: uErr.message };

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}
