"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slotEndIso } from "@/lib/time";

export async function createBooking(input: {
  resourceId: string;
  startsAt: string;
  /** Admin only: book on behalf of this coach profile id */
  coachUserId?: string;
  /** Team for the unified event card (required for smooth multi-team coaches) */
  teamId?: string;
  title?: string;
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
  let coachUserId = user.id;

  if (input.coachUserId && input.coachUserId !== user.id) {
    if (!isAdmin) {
      return { error: "Only admins can book for another coach." };
    }
    const { data: coach } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", input.coachUserId)
      .maybeSingle();
    if (!coach) {
      return {
        error:
          "That coach has no account yet. They must magic-link in once first.",
      };
    }
    coachUserId = coach.id;
  }

  const endsAt = slotEndIso(input.startsAt);

  const { data: resource } = await supabase
    .from("resources")
    .select("slug, name")
    .eq("id", input.resourceId)
    .maybeSingle();

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      resource_id: input.resourceId,
      coach_user_id: coachUserId,
      starts_at: input.startsAt,
      ends_at: endsAt,
      status: "confirmed",
      team_id: input.teamId || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23P01" || /overlap|exclude|blocked/i.test(error.message)) {
      return { error: "That slot is no longer available." };
    }
    return { error: error.message };
  }

  // Mirror into unified schedule_events when the table exists
  const title =
    input.title ||
    (resource?.slug === "cages"
      ? "Batting cages"
      : resource?.slug === "court"
        ? "Gym"
        : resource?.name || "Practice");

  const { data: ev, error: evErr } = await supabase
    .from("schedule_events")
    .insert({
      resource_id: input.resourceId,
      title,
      starts_at: input.startsAt,
      ends_at: endsAt,
      status: "confirmed",
      attendance_policy: "bookable",
      booking_id: booking.id,
      created_by: coachUserId,
    })
    .select("id")
    .maybeSingle();

  if (!evErr && ev?.id && input.teamId) {
    await supabase.from("schedule_event_teams").insert({
      event_id: ev.id,
      team_id: input.teamId,
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function cancelBooking(bookingId: string) {
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

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, coach_user_id, status")
    .eq("id", bookingId)
    .maybeSingle();

  if (!booking) return { error: "Booking not found." };
  if (booking.status !== "confirmed") {
    return { error: "Booking is already cancelled." };
  }

  const isOwner = booking.coach_user_id === user.id;
  const isAdmin = profile?.role === "admin";
  if (!isOwner && !isAdmin) {
    return { error: "You can only cancel your own bookings." };
  }

  const { error } = await supabase
    .from("bookings")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", bookingId);

  if (error) return { error: error.message };

  await supabase
    .from("schedule_events")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("booking_id", bookingId)
    .eq("status", "confirmed");

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}
