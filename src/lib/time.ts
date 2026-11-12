import {
  addDays,
  addHours,
  format,
  parse,
  startOfWeek,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import type { AvailabilityWindow } from "./types";

export const FACILITY_TZ =
  process.env.NEXT_PUBLIC_TIMEZONE || "America/New_York";

export const SLOT_HOURS = 1;

export function getWeekStart(anchor: Date = new Date()): Date {
  return startOfWeek(anchor, { weekStartsOn: 0 });
}

export function weekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatDayHeader(d: Date): string {
  return format(d, "EEE M/d");
}

export function formatHourLabel(hour: number): string {
  const d = setMinutes(setHours(new Date(), hour), 0);
  return format(d, "h a");
}

/** Parse "HH:mm:ss" or "HH:mm" into hour number. */
export function timeToHour(t: string): number {
  const [h] = t.split(":").map(Number);
  return h;
}

export function windowsForDay(
  windows: AvailabilityWindow[],
  dayOfWeek: number,
  resourceId: string
): AvailabilityWindow[] {
  return windows.filter(
    (w) =>
      w.day_of_week === dayOfWeek &&
      (w.resource_id === null || w.resource_id === resourceId)
  );
}

/** Build 1-hour slot starts (facility-local) for a calendar day + resource. */
export function openSlotStarts(
  day: Date,
  resourceId: string,
  windows: AvailabilityWindow[]
): Date[] {
  const dow = day.getDay();
  const dayWindows = windowsForDay(windows, dow, resourceId);
  const starts: Date[] = [];

  for (const w of dayWindows) {
    const startH = timeToHour(w.start_time);
    const endH = timeToHour(w.end_time);
    for (let h = startH; h + SLOT_HOURS <= endH; h += SLOT_HOURS) {
      const local = setMilliseconds(
        setSeconds(setMinutes(setHours(day, h), 0), 0),
        0
      );
      starts.push(local);
    }
  }
  return starts;
}

/** Convert a facility-local Date (as if local wall clock) to UTC ISO. */
export function localSlotToUtcIso(localWallClock: Date): string {
  const wall = format(localWallClock, "yyyy-MM-dd HH:mm:ss");
  const asUtc = fromZonedTime(wall, FACILITY_TZ);
  return asUtc.toISOString();
}

export function utcIsoToFacilityDate(iso: string): Date {
  return toZonedTime(new Date(iso), FACILITY_TZ);
}

export function slotEndIso(startIso: string): string {
  return addHours(new Date(startIso), SLOT_HOURS).toISOString();
}

export function weekQueryParam(weekStart: Date): string {
  return format(weekStart, "yyyy-MM-dd");
}

export function parseWeekParam(value: string | null | undefined): Date {
  if (!value) return getWeekStart();
  const parsed = parse(value, "yyyy-MM-dd", new Date());
  if (Number.isNaN(parsed.getTime())) return getWeekStart();
  return getWeekStart(parsed);
}

/** Half-open overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅ */
export function rangesOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
