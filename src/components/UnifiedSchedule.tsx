"use client";

import { useMemo, useState, useTransition } from "react";
import { parse } from "date-fns";
import { cancelBooking } from "@/actions/bookings";
import { leaveEventTeam } from "@/actions/schedule-events";
import {
  DEFAULT_EVENT_TITLE,
  LOCATION_CHIP_CLASS,
  LOCATION_SLUGS,
  ageGroupsFromShoremenLabel,
  coachTeamsSmoothDefault,
  eventIncludesTeam,
  resourceOf,
  teamNamesDetail,
  teamNamesLabel,
  teamsOf,
  type LocationSlug,
} from "@/lib/schedule-events";
import {
  FACILITY_TZ,
  calendarDateKey,
  facilityDateKey,
  facilityHour,
  formatDayHeader,
  formatHourLabel,
  localSlotToUtcIso,
  openSlotStarts,
  rangesOverlap,
  weekDays,
} from "@/lib/time";
import type {
  AvailabilityWindow,
  Profile,
  Resource,
  ResourceBlock,
  ScheduleEvent,
  Team,
  TeamCoachInfo,
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
  coaches: TeamCoachInfo[];
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

function coachesForTeams(
  teamIds: string[],
  coaches: TeamCoachInfo[]
): TeamCoachInfo[] {
  const seen = new Set<string>();
  const out: TeamCoachInfo[] = [];
  for (const c of coaches) {
    if (!teamIds.includes(c.team_id)) continue;
    const key = c.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function coachNamesLabel(coaches: TeamCoachInfo[]): string {
  if (!coaches.length) return "";
  return coaches
    .map((c) => c.full_name?.trim() || c.email.split("@")[0])
    .join(", ");
}

export function UnifiedSchedule({
  weekStartIso,
  resources,
  windows,
  blocks,
  events,
  teams,
  coaches,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
        if (
          !evTeams.length &&
          (slug === "shoremen" || slug === "shoregals") &&
          ((slug === "shoremen" && sport !== "baseball") ||
            (slug === "shoregals" && sport !== "softball"))
        ) {
          return false;
        }
      }
      if (ageGroup !== "all") {
        if (evTeams.length) {
          if (!evTeams.some((t) => t.age_group === ageGroup)) return false;
        } else {
          const band = ageGroupsFromShoremenLabel(ev.notes);
          if (band.length && !band.includes(ageGroup)) return false;
        }
      }
      return true;
    });
  }, [events, resources, locations, sport, ageGroup]);

  const selected = useMemo(
    () => filteredEvents.find((e) => e.id === selectedId) || null,
    [filteredEvents, selectedId]
  );

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
      set.add(facilityHour(ev.starts_at));
    }
    for (const b of blocks) {
      const slug = resources.find((r) => r.id === b.resource_id)?.slug;
      if (slug && locations.has(slug as LocationSlug)) {
        set.add(facilityHour(b.starts_at));
      }
    }
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
    const dayKey = calendarDateKey(day);
    return filteredEvents.filter(
      (ev) =>
        facilityDateKey(ev.starts_at) === dayKey &&
        facilityHour(ev.starts_at) === hour
    );
  }

  function blocksAt(day: Date, hour: number): ResourceBlock[] {
    const dayKey = calendarDateKey(day);
    const local = new Date(day);
    local.setHours(hour, 0, 0, 0);
    const startsAt = localSlotToUtcIso(local);
    const endLocal = new Date(day);
    endLocal.setHours(hour + 1, 0, 0, 0);
    const endsAt = localSlotToUtcIso(endLocal);
    return blocks.filter((b) => {
      const slug = resources.find((r) => r.id === b.resource_id)?.slug;
      if (!slug || !locations.has(slug as LocationSlug)) return false;
      if (facilityDateKey(b.starts_at) !== dayKey) {
        // still allow multi-hour blocks via overlap
      }
      return rangesOverlap(b.starts_at, b.ends_at, startsAt, endsAt);
    });
  }

  const showTeamPicker = myTeams.length > 1;

  function EventCard({
    ev,
    compact,
  }: {
    ev: ScheduleEvent;
    compact?: boolean;
  }) {
    const slug = slugOf(ev, resources);
    const evTeams = teamsOf(ev);
    const mine = evTeams.some((t) => myTeamIds.includes(t.id));
    const eventCoaches = coachesForTeams(
      evTeams.map((t) => t.id),
      coaches
    );
    const coachLine = coachNamesLabel(eventCoaches);
    return (
      <button
        type="button"
        onClick={() => setSelectedId(ev.id)}
        className={`w-full rounded border px-1.5 py-1 text-left text-[11px] leading-snug transition hover:brightness-95 ${
          slug ? LOCATION_CHIP_CLASS[slug] : "border-stone-200 bg-stone-50"
        } ${mine ? "ring-1 ring-[var(--maroon)]" : ""} ${
          selectedId === ev.id ? "outline outline-2 outline-[var(--maroon)]" : ""
        }`}
      >
        <div className="font-bold">{ev.title}</div>
        <div>{teamNamesLabel(evTeams, ev.notes)}</div>
        {coachLine ? (
          <div className={compact ? "truncate text-[10px] opacity-80" : "text-[10px] opacity-80"}>
            {coachLine}
          </div>
        ) : null}
      </button>
    );
  }

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
                const eventCoaches = coachesForTeams(
                  evTeams.map((t) => t.id),
                  coaches
                );
                return (
                  <li
                    key={ev.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                  >
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => setSelectedId(ev.id)}
                    >
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
                        {slug ? ` · ${resourceOf(ev)?.name || DEFAULT_EVENT_TITLE[slug]}` : ""}
                      </div>
                      <div className="mt-1 text-sm text-[var(--maroon)]">
                        {teamNamesLabel(evTeams, ev.notes)}
                      </div>
                      {eventCoaches.length > 0 && (
                        <div className="text-xs text-stone-500">
                          {coachNamesLabel(eventCoaches)}
                        </div>
                      )}
                    </button>
                    <div className="flex flex-wrap gap-2">
                      {focusTeamId &&
                        eventIncludesTeam(ev, focusTeamId) &&
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
                      {focusTeamId &&
                        eventIncludesTeam(ev, focusTeamId) &&
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
                    const cellBlocks = blocksAt(day, hour);
                    return (
                      <td
                        key={`${day.toISOString()}-${hour}`}
                        className="border-b border-l border-stone-100 align-top p-1 min-h-[52px]"
                      >
                        <div className="flex flex-col gap-1">
                          {cellBlocks.map((b) => (
                            <div
                              key={b.id}
                              className="rounded border border-stone-400 bg-stone-200 px-1.5 py-1 text-[11px] leading-snug text-stone-800"
                            >
                              <div className="font-bold">Blocked</div>
                              <div className="truncate">
                                {b.reason || "Unavailable"}
                              </div>
                            </div>
                          ))}
                          {cellEvents.map((ev) => (
                            <EventCard key={ev.id} ev={ev} compact />
                          ))}
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

      {selected && (
        <EventDetailPanel
          event={selected}
          resources={resources}
          coaches={coaches}
          myTeamIds={myTeamIds}
          focusTeamId={focusTeamId}
          pending={pending}
          onClose={() => setSelectedId(null)}
          onCancelBooking={(bookingId) => run(() => cancelBooking(bookingId))}
          onLeaveT3={(eventId, teamId) =>
            run(() => leaveEventTeam({ eventId, teamId }))
          }
        />
      )}

      <p className="text-xs text-stone-500">
        Full calendar shows every team so coaches can trade. Click an event for
        full details. T3: leave drops only your team. Train with the Shoremen /
        ShoreGals: age-group sessions stay fixed.
        {profile.role === "admin"
          ? " Book and block open slots from Admin."
          : ""}
      </p>
    </div>
  );
}

function EventDetailPanel({
  event,
  resources,
  coaches,
  myTeamIds,
  focusTeamId,
  pending,
  onClose,
  onCancelBooking,
  onLeaveT3,
}: {
  event: ScheduleEvent;
  resources: Resource[];
  coaches: TeamCoachInfo[];
  myTeamIds: string[];
  focusTeamId: string | null;
  pending: boolean;
  onClose: () => void;
  onCancelBooking: (bookingId: string) => void;
  onLeaveT3: (eventId: string, teamId: string) => void;
}) {
  const slug = slugOf(event, resources);
  const evTeams = teamsOf(event);
  const locationName =
    resourceOf(event)?.name ||
    (slug ? DEFAULT_EVENT_TITLE[slug] : "Unknown location");
  const eventCoaches = coachesForTeams(
    evTeams.map((t) => t.id),
    coaches
  );
  const timeLabel = `${formatInTimeZone(
    new Date(event.starts_at),
    FACILITY_TZ,
    "EEE MMM d · h:mm a"
  )} – ${formatInTimeZone(new Date(event.ends_at), FACILITY_TZ, "h:mm a")} ET`;
  const mine =
    focusTeamId != null
      ? eventIncludesTeam(event, focusTeamId)
      : evTeams.some((t) => myTeamIds.includes(t.id));

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-detail-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="event-detail-title"
            className="text-lg font-semibold text-[var(--maroon)]"
          >
            {event.title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm font-semibold text-stone-500 hover:bg-stone-100"
          >
            Close
          </button>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Team(s)
            </dt>
            <dd className="text-[var(--ink)]">
              {teamNamesDetail(evTeams, event.notes)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Location
            </dt>
            <dd className="text-[var(--ink)]">{locationName}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Time
            </dt>
            <dd className="text-[var(--ink)]">{timeLabel}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Coach(es)
            </dt>
            <dd className="text-[var(--ink)]">
              {eventCoaches.length
                ? eventCoaches
                    .map((c) => c.full_name?.trim() || c.email)
                    .join(", ")
                : "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {mine &&
            event.attendance_policy === "bookable" &&
            event.booking_id && (
              <button
                type="button"
                disabled={pending}
                className="rounded border border-stone-300 px-3 py-1.5 text-xs font-semibold"
                onClick={() => onCancelBooking(event.booking_id!)}
              >
                Cancel booking
              </button>
            )}
          {mine &&
            focusTeamId &&
            event.attendance_policy === "team_optional" && (
              <button
                type="button"
                disabled={pending}
                className="rounded border border-stone-300 px-3 py-1.5 text-xs font-semibold"
                onClick={() => onLeaveT3(event.id, focusTeamId)}
              >
                Leave this T3
              </button>
            )}
          {event.attendance_policy === "fixed" && (
            <span className="self-center text-xs text-stone-500">
              Age-group session (fixed)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
