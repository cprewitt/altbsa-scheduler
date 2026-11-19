import { formatInTimeZone } from "date-fns-tz";
import { FACILITY_TZ } from "@/lib/time";

export type ScheduleBookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  resources: { name: string; slug: string } | { name: string; slug: string }[] | null;
};

export function resourceLabel(
  resources: ScheduleBookingRow["resources"]
): string {
  const r = Array.isArray(resources) ? resources[0] : resources;
  return r?.name || "Facility";
}

export function teamFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/^(?:Jan weekly|Gym weekly|T3)\s*·\s*(.+)$/i);
  if (m) return m[1].trim();
  return notes.trim() || null;
}

export function formatBookingLine(
  b: ScheduleBookingRow,
  tz: string = FACILITY_TZ
): string {
  const when = formatInTimeZone(
    new Date(b.starts_at),
    tz,
    "EEE MMM d, yyyy · h:mm a"
  );
  const end = formatInTimeZone(new Date(b.ends_at), tz, "h:mm a");
  const team = teamFromNotes(b.notes);
  const place = resourceLabel(b.resources);
  return `${when}–${end} · ${place}${team ? ` · ${team}` : ""}`;
}

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${day}T${hh}${mm}${ss}Z`;
}

export function buildScheduleIcs(
  bookings: ScheduleBookingRow[],
  coachName: string
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ALTBSA//Anchor Scheduler//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(`ALTBSA — ${coachName}`)}`,
  ];

  for (const b of bookings) {
    const team = teamFromNotes(b.notes);
    const place = resourceLabel(b.resources);
    const summary = team ? `${team} · ${place}` : `ALTBSA · ${place}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@schedule.altbsa.org`,
      `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
      `DTSTART:${toIcsUtc(b.starts_at)}`,
      `DTEND:${toIcsUtc(b.ends_at)}`,
      `SUMMARY:${icsEscape(summary)}`,
      `DESCRIPTION:${icsEscape(`ALTBSA Anchor · ${place}`)}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function buildScheduleEmailHtml(
  bookings: ScheduleBookingRow[],
  coachName: string,
  tz: string = FACILITY_TZ
): string {
  const rows = bookings
    .map((b) => {
      const day = formatInTimeZone(new Date(b.starts_at), tz, "EEE MMM d, yyyy");
      const start = formatInTimeZone(new Date(b.starts_at), tz, "h:mm a");
      const end = formatInTimeZone(new Date(b.ends_at), tz, "h:mm a");
      const team = teamFromNotes(b.notes) || "—";
      const place = resourceLabel(b.resources);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ddd4;">${day}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ddd4;">${start} – ${end}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ddd4;">${place}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e6ddd4;">${team}</td>
      </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1c1412;background:#f7f4f0;padding:20px;">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e6ddd4;border-radius:10px;overflow:hidden;">
    <div style="background:#862633;color:#fff;padding:18px 20px;">
      <div style="font-weight:800;font-size:18px;">ALTBSA Anchor Scheduler</div>
      <div style="opacity:.95;margin-top:4px;">Your team schedule · ${coachName}</div>
    </div>
    <div style="padding:16px 20px;">
      <p style="margin:0 0 12px;color:#5c514c;font-size:14px;">Times are America/New_York. An .ics calendar file is attached so you can add these to your calendar app.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f4ebe3;color:#862633;text-align:left;">
            <th style="padding:8px 10px;">Date</th>
            <th style="padding:8px 10px;">Time</th>
            <th style="padding:8px 10px;">Space</th>
            <th style="padding:8px 10px;">Team</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="4" style="padding:12px;">No confirmed bookings found.</td></tr>`}</tbody>
      </table>
    </div>
  </div>
</body></html>`;
}

export function buildScheduleEmailText(
  bookings: ScheduleBookingRow[],
  coachName: string,
  tz: string = FACILITY_TZ
): string {
  const lines = [
    `ALTBSA Anchor Scheduler — your team schedule`,
    `Coach: ${coachName}`,
    `Timezone: ${tz}`,
    "",
  ];
  if (!bookings.length) {
    lines.push("No confirmed bookings found.");
  } else {
    for (const b of bookings) {
      lines.push(formatBookingLine(b, tz));
    }
  }
  lines.push("", "An .ics calendar file is attached.", "— ALTBSA");
  return lines.join("\n");
}
