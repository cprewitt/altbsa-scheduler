"use client";

import { useMemo, useState, useTransition } from "react";
import { parse } from "date-fns";
import { createBooking, cancelBooking } from "@/actions/bookings";
import { leaveEventTeam } from "@/actions/schedule-events";
import {
  DEFAULT_EVENT_TITLE,
  LOCATION_CHIP_CLASS,
  LOCATION_SLUGS,
  coachTeamsSmoothDefault,
  eventIncludesTeam,
  resourceOf,
  teamNamesLabel,
  teamsOf,
  type LocationSlug,
} from "@/lib/schedule-events";
import {
  FACILITY_TZ,
  formatDayHeader,
  formatHourLabel,
  localSlotToUtcIso,
  openSlotStarts,
  rangesOverlap,
  utcIsoToFacilityDate,
  weekDays,
} from "@/lib/time";
import type {
  AvailabilityWindow,
  Profile,
  Resource,
  ResourceBlock,
  ScheduleEvent,
  Team,
} from "@/lib/types";
import { formatInTimeZone } from "date-fns-tz";

type LayoutMode = "grid" | "list";

type Props = {
  weekStartIso: string;
  resources: Resource[];
  windows: AvailabilityWindow[];
  blocks: ResourceBlock[];
  events: ScheduleEvent[];
  teams: Team[];
  myTeamIds: string[];
  profile: Profile;
};

function slugOf(event: ScheduleEvent, resources: Resource[]): LocationSlug | null {
  const r = resourceOf(event);
  const slug = r?.slug || resources.find((x) => x.id === event.resource_id)?.slug;
  if (!slug) return null;
  return LOCATION_SLUGS.includes(slug as LocationSlug)
    ? (slug as LocationSlug)
    : null;
}

export function UnifiedSchedule({
  weekStartIso,
  resources,
  windows,
  blocks,
  events,
  teams,
  myTeamIds,
  profile,
}: Props) {
  const myTeams = useMemo(
    () => teams.filter((t) => myTeamIds.includes(t.id)),
    [teams, myTeamIds]
  );
  const autoFocus = coachTeamsSmoothDefault(myTeams);

  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [locations, setLocations] = useState<Set<LocationSlug>>(
    () => new Set(LOCATION_SLUGS)
  );
  const [sport, setSport] = useState<"all" | "baseball" | "softball">("all");
  const [ageGroup, setAgeGroup] = useState<string>("all");
  const [focusTeamId, setFocusTeamId] = useState<string | null>(autoFocus);
  const [bookLocation, setBookLocation] = useState<"cages" | "court">("cages");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const weekStart = useMemo(
    () => parse(weekStartIso, "yyyy-MM-dd", new Date()),
    [weekStartIso]
  );
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const ageOptions = useMemo(() => {
    const set = new Set(teams.map((t) => t.age_group));
    return Array.from(set).sort(
      (a, b) => parseInt(a, 10) - parseInt(b, 10)
    );
  }, [teams]);

  const resourceBySlug = useMemo(
    () => Object.fromEntries(resources.map((r) => [r.slug, r])),
    [resources]
  );

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const slug = slugOf(ev, resources);
      if (!slug || !locations.has(slug)) return false;
      const evTeams = teamsOf(ev);
      if (sport !== "all") {
        if (evTeams.length && !evTeams.some((t) => t.sport === sport)) {
          return false;
        }
      }
      if (ageGroup !== "all") {
        if (evTeams.length && !evTeams.some((t) => t.age_group === ageGroup)) {
          return false;
        }
      }
      return true;
    });
  }, [events, resources, locations, sport, ageGroup]);

  const listEvents = useMemo(() => {
    if (!focusTeamId) return [];
    return filteredEvents
      .filter((ev) => eventIncludesTeam(ev, focusTeamId))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [filteredEvents, focusTeamId]);

  const hours = useMemo(() => {
    const set = new Set<number>();
    for (const day of days) {
      for (const slug of ["cages", "court"] as const) {
        const id = resourceBySlug[slug]?.id;
        if (!id || !locations.has(slug)) continue;
        for (const start of openSlotStarts(day, id, windows)) {
          set.add(start.getHours());
        }
      }
    }
    for (const ev of filteredEvents) {
      set.add(utcIsoToFacilityDate(ev.starts_at).getHours());
    }
    for (const b of blocks) {
      const slug = resources.find((r) => r.id === b.resource_id)?.slug;
      if (slug && locations.has(slug as LocationSlug)) {
        set.add(utcIsoToFacilityDate(b.starts_at).getHours());
      }
    }
    // sensible default band if empty
    if (!set.size) {
      for (let h = 9; h <= 20; h++) set.add(h);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [days, resourceBySlug, windows, filteredEvents, blocks, resources, locations]);

  function toggleLocation(slug: LocationSlug) {
    setLocations((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      if (next.size === 0) return new Set(LOCATION_SLUGS);
      return next;
    });
  }

  function run(action: () => Promise<{ error?: string; ok?: true }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else setMessage("Saved.");
    });
  }

  function eventsAt(day: Date, hour: number): ScheduleEvent[] {
    const local = new Date(day);
    local.setHours(hour, 0, 0, 0);
    const startsAt = localSlotToUtcIso(local);
    const endLocal = new Date(day);
    endLocal.setHours(hour + 1, 0, 0, 0);
    const endsAt = localSlotToUtcIso(endLocal);
    return filteredEvents.filter(
      (ev) => ev.starts_at >= startsAt && ev.starts_at < endsAt
    );
  }

  function openBookable(day: Date, hour: number): string | null {
    if (!locations.has(bookLocation)) return null;
    const resource = resourceBySlug[bookLocation];
    if (!resource) return null;
    const open = openSlotStarts(day, resource.id, windows).some(
      (s) => s.getHours() === hour
    );
    if (!open) return null;
    const local = new Date(day);
    local.setHours(hour, 0, 0, 0);
    const startsAt = localSlotToUtcIso(local);
    const endLocal = new Date(day);
    endLocal.setHours(hour + 1, 0, 0, 0);
    const endsAt = localSlotToUtcIso(endLocal);
    const blocked = blocks.some(
      (b) =>
        b.resource_id === resource.id &&
        rangesOverlap(b.starts_at, b.ends_at, startsAt, endsAt)
    );
    if (blocked) return null;
    const taken = events.some(
      (ev) =>
        ev.resource_id === resource.id &&
        ev.status === "confirmed" &&
        ev.starts_at >= startsAt &&
        ev.starts_at < endsAt
    );
    if (taken) return null;
    return startsAt;
  }

  const showTeamPicker = myTeams.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-stone-300 overflow-hidden">
          {(
            [
              ["grid", "Full calendar"],
              ["list", "My team list"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setLayout(id)}
              className={
                layout === id
                  ? "bg-[var(--maroon)] px-3 py-1.5 text-sm font-semibold text-white"
                  : "bg-white px-3 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-stone-50"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {(showTeamPicker || layout === "list") && myTeams.length > 0 && (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-stone-600">Team</span>
            <select
              value={focusTeamId || ""}
              onChange={(e) => setFocusTeamId(e.target.value || null)}
              className="rounded border border-stone-300 bg-white px-2 py-1.5"
            >
              {showTeamPicker && <option value="">Select team…</option>}
              {myTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {!showTeamPicker && myTeams.length === 1 && (
          <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-sm text-stone-700">
            {myTeams[0].name}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Locations
        </span>
        <button
          type="button"
          className="rounded border border-stone-300 bg-white px-2 py-1 text-xs font-semibold"
          onClick={() => setLocations(new Set(LOCATION_SLUGS))}
        >
          All
        </button>
        {LOCATION_SLUGS.map((slug) => {
          const r = resourceBySlug[slug];
          if (!r) return null;
          const on = locations.has(slug);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggleLocation(slug)}
              className={
                on
                  ? `rounded border px-2 py-1 text-xs font-semibold ${LOCATION_CHIP_CLASS[slug]}`
                  : "rounded border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-400"
              }
            >
              {DEFAULT_EVENT_TITLE[slug]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 items-center text-sm">
        <label className="flex items-center gap-2">
          <span className="font-semibold text-stone-600">Sport</span>
          <select
            value={sport}
            onChange={(e) =>
              setSport(e.target.value as "all" | "baseball" | "softball")
            }
            className="rounded border border-stone-300 bg-white px-2 py-1"
          >
            <option value="all">All</option>
            <option value="baseball">Baseball</option>
            <option value="softball">Softball</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-semibold text-stone-600">Age</span>
          <select
            value={ageGroup}
            onChange={(e) => setAgeGroup(e.target.value)}
            className="rounded border border-stone-300 bg-white px-2 py-1"
          >
            <option value="all">All</option>
            {ageOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        {layout === "grid" && (
          <label className="flex items-center gap-2">
            <span className="font-semibold text-stone-600">Book open</span>
            <select
              value={bookLocation}
              onChange={(e) =>
                setBookLocation(e.target.value as "cages" | "court")
              }
              className="rounded border border-stone-300 bg-white px-2 py-1"
            >
              <option value="cages">Cages</option>
              <option value="court">Court</option>
            </select>
          </label>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {message}
        </p>
      )}

      {layout === "list" ? (
        <div className="rounded border border-stone-200 bg-white overflow-hidden">
          {!focusTeamId ? (
            <p className="p-4 text-sm text-stone-600">
              {myTeams.length === 0
                ? "No team is linked to your account yet. Ask an admin to assign you."
                : "Pick a team to see its full commitment (cages, gym, T3, Shoremen)."}
            </p>
          ) : listEvents.length === 0 ? (
            <p className="p-4 text-sm text-stone-600">
              No events this week for that team with the current filters.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {listEvents.map((ev) => {
                const slug = slugOf(ev, resources);
                const evTeams = teamsOf(ev);
                const mine = focusTeamId
                  ? eventIncludesTeam(ev, focusTeamId)
                  : false;
                return (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                  >
                    <div>
                      <div className="font-semibold text-[var(--ink)]">
                        {ev.title}
                      </div>
                      <div className="text-sm text-stone-600">
                        {formatInTimeZone(
                          new Date(ev.starts_at),
                          FACILITY_TZ,
                          "EEE MMM d · h:mm a"
                        )}
                        –
                        {formatInTimeZone(
                          new Date(ev.ends_at),
                          FACILITY_TZ,
                          "h:mm a"
                        )}
                        {slug ? ` · ${DEFAULT_EVENT_TITLE[slug]}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-[var(--maroon)]">
                        {teamNamesLabel(evTeams)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {mine &&
                        ev.attendance_policy === "bookable" &&
                        ev.booking_id && (
                          <button
                            type="button"
                            disabled={pending}
                            className="rounded border border-stone-300 px-2 py-1 text-xs font-semibold"
                            onClick={() =>
                              run(() => cancelBooking(ev.booking_id!))
                            }
                          >
                            Cancel
                          </button>
                        )}
                      {mine &&
                        focusTeamId &&
                        ev.attendance_policy === "team_optional" && (
                          <button
                            type="button"
                            disabled={pending}
                            className="rounded border border-stone-300 px-2 py-1 text-xs font-semibold"
                            onClick={() =>
                              run(() =>
                                leaveEventTeam({
                                  eventId: ev.id,
                                  teamId: focusTeamId,
                                })
                              )
                            }
                          >
                            Leave this T3
                          </button>
                        )}
                      {ev.attendance_policy === "fixed" && (
                        <span className="text-xs text-stone-500 self-center">
                          Age-group session (fixed)
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="min-w-[860px] w-full border-collapse text-sm">
            <thead>
              <tr className="bg-stone-50 text-[var(--maroon)]">
                <th className="w-16 border-b border-stone-200 px-2 py-2 text-right font-semibold">
                  Time
                </th>
                {days.map((d) => (
                  <th
                    key={d.toISOString()}
                    className="border-b border-stone-200 px-2 py-2 font-semibold"
                  >
                    {formatDayHeader(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour}>
                  <th className="border-b border-stone-100 px-2 py-1 text-right text-xs font-semibold text-stone-500">
                    {formatHourLabel(hour)}
                  </th>
                  {days.map((day) => {
                    const cellEvents = eventsAt(day, hour);
                    const openAt = openBookable(day, hour);
                    return (
                      <td
                        key={`${day.toISOString()}-${hour}`}
                        className="border-b border-l border-stone-100 align-top p-1 min-h-[52px]"
                      >
                        <div className="flex flex-col gap-1">
                          {cellEvents.map((ev) => {
                            const slug = slugOf(ev, resources);
                            const evTeams = teamsOf(ev);
                            const mine = evTeams.some((t) =>
                              myTeamIds.includes(t.id)
                            );
                            return (
                              <div
                                key={ev.id}
                                className={`rounded border px-1.5 py-1 text-[11px] leading-snug ${
                                  slug
                                    ? LOCATION_CHIP_CLASS[slug]
                                    : "border-stone-200 bg-stone-50"
                                } ${mine ? "ring-1 ring-[var(--maroon)]" : ""}`}
                              >
                                <div className="font-bold">{ev.title}</div>
                                <div>{teamNamesLabel(evTeams)}</div>
                              </div>
                            );
                          })}
                          {openAt && focusTeamId && (
                            <button
                              type="button"
                              disabled={pending}
                              className="rounded border border-dashed border-stone-300 px-1.5 py-1 text-[11px] text-stone-600 hover:border-[var(--maroon)] hover:text-[var(--maroon)]"
                              onClick={() =>
                                run(() =>
                                  createBooking({
                                    resourceId: resourceBySlug[bookLocation].id,
                                    startsAt: openAt,
                                    teamId: focusTeamId,
                                    title: DEFAULT_EVENT_TITLE[bookLocation],
                                  })
                                )
                              }
                            >
                              Book {bookLocation}
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-stone-500">
        Full calendar shows every team so coaches can trade. You can book open
        cages/court slots and cancel your own. T3: leave drops only your team.
        Train with the Shoremen / ShoreGals: age-group sessions stay fixed.
        {profile.role === "admin" ? " Admins can change anyone from Admin." : ""}
      </p>
    </div>
  );
}
