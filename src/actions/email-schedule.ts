"use server";

import { createClient } from "@/lib/supabase/server";
import { FACILITY_TZ } from "@/lib/time";
import { sendWithGmailWorkspace } from "@/lib/gmail-send";
import {
  buildScheduleEmailHtml,
  buildScheduleEmailText,
  buildScheduleIcs,
  type ScheduleBookingRow,
} from "@/lib/my-schedule";
import { teamNamesLabel, teamsOf } from "@/lib/schedule-events";
import type { ScheduleEvent } from "@/lib/types";

const SEASON_START = "2027-01-01T00:00:00.000Z";
const SEASON_END = "2027-05-01T00:00:00.000Z";

export type EmailMyScheduleResult =
  | {
      ok: true;
      mode: "sent";
      to: string;
      count: number;
      via: "gmail" | "resend";
    }
  | {
      ok: true;
      mode: "compose";
      to: string;
      count: number;
      mailto: string;
      icsBase64: string;
      icsFileName: string;
      message: string;
    }
  | { ok: false; error: string };

function eventsToRows(events: ScheduleEvent[]): ScheduleBookingRow[] {
  return events.map((ev) => {
    const resources = Array.isArray(ev.resources)
      ? ev.resources[0]
      : ev.resources;
    const teams = teamsOf(ev);
    return {
      id: ev.id,
      starts_at: ev.starts_at,
      ends_at: ev.ends_at,
      notes: `${ev.title} · ${teamNamesLabel(teams)}`,
      resources: resources
        ? { name: resources.name, slug: resources.slug }
        : { name: ev.title, slug: "event" },
    };
  });
}

async function loadMyTeamEvents(
  userId: string,
  teamId?: string
): Promise<ScheduleBookingRow[]> {
  const supabase = await createClient();

  let teamIds: string[] = [];
  if (teamId) {
    teamIds = [teamId];
  } else {
    const { data: links, error } = await supabase
      .from("team_coaches")
      .select("team_id")
      .eq("coach_user_id", userId);
    if (error) throw new Error(error.message);
    teamIds = (links || []).map((l) => l.team_id);
  }

  if (!teamIds.length) {
    // Fallback: legacy bookings owned by coach
    const { data, error } = await supabase
      .from("bookings")
      .select("id, starts_at, ends_at, notes, resources(name, slug)")
      .eq("coach_user_id", userId)
      .eq("status", "confirmed")
      .gte("starts_at", SEASON_START)
      .lt("starts_at", SEASON_END)
      .order("starts_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []) as unknown as ScheduleBookingRow[];
  }

  const { data: links, error: lErr } = await supabase
    .from("schedule_event_teams")
    .select("event_id")
    .in("team_id", teamIds);
  if (lErr) throw new Error(lErr.message);
  const eventIds = [...new Set((links || []).map((l) => l.event_id))];
  if (!eventIds.length) return [];

  const { data: events, error: eErr } = await supabase
    .from("schedule_events")
    .select(
      "id, resource_id, title, starts_at, ends_at, status, attendance_policy, notes, booking_id, created_by, resources(id, slug, name), schedule_event_teams(team_id, teams(id, name, age_group, sport, color))"
    )
    .in("id", eventIds)
    .eq("status", "confirmed")
    .gte("starts_at", SEASON_START)
    .lt("starts_at", SEASON_END)
    .order("starts_at", { ascending: true });
  if (eErr) throw new Error(eErr.message);

  return eventsToRows((events || []) as unknown as ScheduleEvent[]);
}

async function sendWithResend(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  ics: string;
  icsFileName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "not_configured" };

  const from =
    process.env.EMAIL_FROM || "ALTBSA Scheduler <tryouts@altbsa.org>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      attachments: [
        {
          filename: input.icsFileName,
          content: Buffer.from(input.ics, "utf8").toString("base64"),
          content_type: "text/calendar; charset=utf-8; method=PUBLISH",
        },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return {
      ok: false,
      error: `Email provider error (${res.status}): ${detail.slice(0, 240)}`,
    };
  }
  return { ok: true };
}

export async function emailMySchedule(teamId?: string): Promise<EmailMyScheduleResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  const to = (profile?.email || user.email).toLowerCase();
  const coachName = profile?.full_name || to;

  let bookings: ScheduleBookingRow[];
  try {
    bookings = await loadMyTeamEvents(user.id, teamId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not load your schedule.",
    };
  }

  if (!bookings.length) {
    return {
      ok: false,
      error:
        "No confirmed team events found for your account in the 2027 indoor season.",
    };
  }

  const subject = `Your ALTBSA schedule (${bookings.length} sessions)`;
  const text = buildScheduleEmailText(bookings, coachName, FACILITY_TZ);
  const html = buildScheduleEmailHtml(bookings, coachName, FACILITY_TZ);
  const ics = buildScheduleIcs(bookings, coachName);
  const icsFileName = `altbsa-schedule-${to
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")}.ics`;

  const payload = { to, subject, text, html, ics, icsFileName };

  const gmail = await sendWithGmailWorkspace(payload);
  if (gmail.ok) {
    return { ok: true, mode: "sent", to, count: bookings.length, via: "gmail" };
  }
  if (gmail.error !== "not_configured") {
    return { ok: false, error: gmail.error };
  }

  const resend = await sendWithResend(payload);
  if (resend.ok) {
    return { ok: true, mode: "sent", to, count: bookings.length, via: "resend" };
  }
  if (resend.error !== "not_configured") {
    return { ok: false, error: resend.error };
  }

  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(text)}`;

  return {
    ok: true,
    mode: "compose",
    to,
    count: bookings.length,
    mailto,
    icsBase64: Buffer.from(ics, "utf8").toString("base64"),
    icsFileName,
    message:
      "Opened a message to your login email and downloaded an .ics file. Configure Gmail Workspace OAuth (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN) to send automatically from tryouts@altbsa.org.",
  };
}
