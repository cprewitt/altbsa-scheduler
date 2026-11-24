"use client";

import { useMemo, useState, useTransition } from "react";
import { format, parse } from "date-fns";
import { createBooking, cancelBooking } from "@/actions/bookings";
import { createBlock, deleteBlock } from "@/actions/blocks";
import {
  BookSlotDialog,
  type BookSlotLocationOption,
  type SlotDialogAction,
} from "@/components/BookSlotDialog";
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
  Booking,
  Profile,
  Resource,
  ResourceBlock,
  Team,
} from "@/lib/types";

type CoachOption = Pick<Profile, "id" | "email" | "full_name">;

/** Top-level schedule views. "other" groups Shoremen / ShoreGals / T3. */
const OTHER_SLUGS = ["shoremen", "shoregals", "t3"] as const;

type ViewId = "cages" | "court" | "other";

type Props = {
  weekStartIso: string;
  resources: Resource[];
  windows: AvailabilityWindow[];
  bookings: Booking[];
  blocks: ResourceBlock[];
  profile: Profile;
  mode?: "schedule" | "admin";
  /** Coaches who have signed in (for admin book-on-behalf). */
  coaches?: CoachOption[];
  /** Teams for the book dialog (admin). */
  teams?: Pick<Team, "id" | "name">[];
};

type CellState =
  | { kind: "closed" }
  | { kind: "open"; startsAt: string }
  | { kind: "mine" | "taken"; booking: Booking; label: string }
  | { kind: "blocked"; block: ResourceBlock; label: string };

function coachLabel(booking: Booking): string {
  const p = Array.isArray(booking.profiles)
    ? booking.profiles[0]
    : booking.profiles;
  const name = p?.full_name || p?.email || "Booked";
  if (!booking.notes) return name;
  const team = booking.notes
    .replace(/^(?:Jan weekly|Gym weekly|T3)\s*·\s*/i, "")
    .trim();
  return team ? `${name} · ${team}` : name;
}

function initialView(resources: Resource[]): ViewId {
  if (resources.some((r) => r.slug === "cages")) return "cages";
  if (resources.some((r) => r.slug === "court")) return "court";
  if (resources.some((r) => OTHER_SLUGS.includes(r.slug as (typeof OTHER_SLUGS)[number])))
    return "other";
  return "cages";
}

export function WeekGrid({
  weekStartIso,
  resources,
  windows,
  bookings,
  blocks,
  profile,
  mode = "schedule",
  coaches = [],
  teams = [],
}: Props) {
  const cages = useMemo(
    () => resources.find((r) => r.slug === "cages") || null,
    [resources]
  );
  const court = useMemo(
    () => resources.find((r) => r.slug === "court") || null,
    [resources]
  );
  const otherResources = useMemo(
    () =>
      resources
        .filter((r) =>
          OTHER_SLUGS.includes(r.slug as (typeof OTHER_SLUGS)[number])
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    [resources]
  );

  const [view, setView] = useState<ViewId>(() => initialView(resources));
  const [otherResourceId, setOtherResourceId] = useState(
    () => otherResources[0]?.id || ""
  );
  const [bookDraft, setBookDraft] = useState<{
    timeLabel: string;
    locations: BookSlotLocationOption[];
    action: SlotDialogAction;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isAdmin = profile.role === "admin";
  const showBookDialog = isAdmin && mode === "admin";

  const resourceId =
    view === "cages"
      ? cages?.id || ""
      : view === "court"
        ? court?.id || ""
        : otherResourceId || otherResources[0]?.id || "";

  const coachOptions = useMemo(() => {
    const map = new Map<string, CoachOption>();
    map.set(profile.id, {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
    });
    for (const c of coaches) {
      map.set(c.id, c);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.full_name || a.email).localeCompare(b.full_name || b.email)
    );
  }, [coaches, profile]);

  const weekStart = useMemo(
    () => parse(weekStartIso, "yyyy-MM-dd", new Date()),
    [weekStartIso]
  );
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const hours = useMemo(() => {
    const set = new Set<number>();
    if (!resourceId) return [];
    for (const day of days) {
      for (const start of openSlotStarts(day, resourceId, windows)) {
        set.add(start.getHours());
      }
    }
    for (const b of bookings.filter((x) => x.resource_id === resourceId)) {
      set.add(utcIsoToFacilityDate(b.starts_at).getHours());
    }
    for (const b of blocks.filter((x) => x.resource_id === resourceId)) {
      set.add(utcIsoToFacilityDate(b.starts_at).getHours());
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [days, resourceId, windows, bookings, blocks]);

  function cellFor(day: Date, hour: number): CellState {
    const local = new Date(day);
    local.setHours(hour, 0, 0, 0);
    const startsAt = localSlotToUtcIso(local);
    const endLocal = new Date(day);
    endLocal.setHours(hour + 1, 0, 0, 0);
    const endsAt = localSlotToUtcIso(endLocal);

    const open = openSlotStarts(day, resourceId, windows).some(
      (s) => s.getHours() === hour
    );

    const block = blocks.find(
      (b) =>
        b.resource_id === resourceId &&
        rangesOverlap(b.starts_at, b.ends_at, startsAt, endsAt)
    );
    if (block) {
      return { kind: "blocked", block, label: block.reason || "Blocked" };
    }

    // 1-hour bookings render only in the slot they start in (avoids
    // boundary/timezone fuzz painting one booking across two rows).
    const booking = bookings.find(
      (b) =>
        b.resource_id === resourceId &&
        b.status === "confirmed" &&
        b.starts_at >= startsAt &&
        b.starts_at < endsAt
    );
    if (booking) {
      const mine = booking.coach_user_id === profile.id;
      return {
        kind: mine ? "mine" : "taken",
        booking,
        label: coachLabel(booking),
      };
    }

    if (!open) return { kind: "closed" };
    return { kind: "open", startsAt };
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

  const selected = resources.find((r) => r.id === resourceId);

  function openLocationsForSlot(
    day: Date,
    hour: number,
    startsAt: string
  ): BookSlotLocationOption[] {
    if (!selected) return [];
    const locs: BookSlotLocationOption[] = [];
    const seen = new Set<string>();
    const pushIfOpen = (r: Resource | null) => {
      if (!r || seen.has(r.id)) return;
      const open = openSlotStarts(day, r.id, windows).some(
        (s) => s.getHours() === hour
      );
      if (!open) return;
      const endLocal = new Date(day);
      endLocal.setHours(hour + 1, 0, 0, 0);
      const endsAt = localSlotToUtcIso(endLocal);
      const blocked = blocks.some(
        (b) =>
          b.resource_id === r.id &&
          rangesOverlap(b.starts_at, b.ends_at, startsAt, endsAt)
      );
      if (blocked) return;
      const taken = bookings.some(
        (b) =>
          b.resource_id === r.id &&
          b.status === "confirmed" &&
          b.starts_at >= startsAt &&
          b.starts_at < endsAt
      );
      if (taken) return;
      seen.add(r.id);
      locs.push({
        resourceId: r.id,
        slug: r.slug,
        name: r.name,
        startsAt,
      });
    };
    pushIfOpen(selected);
    pushIfOpen(cages);
    pushIfOpen(court);
    if (!locs.length) {
      locs.push({
        resourceId,
        slug: selected.slug,
        name: selected.name,
        startsAt,
      });
    }
    return locs;
  }

  function openSlotDialog(
    day: Date,
    hour: number,
    startsAt: string,
    action: SlotDialogAction
  ) {
    if (!showBookDialog || !selected) return;
    setBookDraft({
      timeLabel: `${formatDayHeader(day)} · ${formatHourLabel(hour)}`,
      locations: openLocationsForSlot(day, hour, startsAt),
      action,
    });
  }

  const viewTabs: { id: ViewId; label: string; available: boolean }[] = [
    { id: "cages", label: "Cages", available: !!cages },
    { id: "court", label: "Court", available: !!court },
    {
      id: "other",
      label: "Other",
      available: otherResources.length > 0,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-2">
          {viewTabs
            .filter((t) => t.available)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setView(t.id);
                  if (t.id === "other" && !otherResourceId && otherResources[0]) {
                    setOtherResourceId(otherResources[0].id);
                  }
                }}
                className={
                  view === t.id
                    ? "rounded bg-[var(--maroon)] px-3 py-1.5 text-sm font-semibold text-white"
                    : "rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-[var(--ink)] hover:border-[var(--maroon)]"
                }
              >
                {t.label}
              </button>
            ))}
        </div>
      </div>

      {view === "other" && otherResources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {otherResources.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setOtherResourceId(r.id)}
              className={
                r.id === resourceId
                  ? "rounded border border-[var(--maroon)] bg-[var(--maroon)]/10 px-3 py-1.5 text-sm font-semibold text-[var(--maroon)]"
                  : "rounded border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold text-[var(--ink)] hover:border-[var(--maroon)]"
              }
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-stone-600">
        {selected?.description || selected?.name || "Select a schedule"} · times
        in {FACILITY_TZ} · 1-hour slots
        {showBookDialog
          ? " · Book or Block opens the slot form · cancel anyone"
          : ""}
      </p>
      {showBookDialog && coachOptions.length <= 1 && (
        <p className="text-sm text-amber-900">
          Only you appear as a coach until other allowlisted coaches magic-link
          in once.
        </p>
      )}

      {error && (
        <p className="text-sm text-red-800">{error}</p>
      )}
      {message && (
        <p className="text-sm text-emerald-800">{message}</p>
      )}
      {pending && <p className="text-sm text-stone-500">Working…</p>}

      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="min-w-[720px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border-b-2 border-[var(--maroon)] px-2 py-2 text-left w-[70px]">
                Time
              </th>
              {days.map((d) => (
                <th
                  key={d.toISOString()}
                  className="border-b-2 border-[var(--maroon)] px-2 py-2 text-left"
                >
                  {formatDayHeader(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-stone-500">
                  No open hours configured for this week.
                </td>
              </tr>
            ) : (
              hours.map((hour) => (
                <tr key={hour}>
                  <td className="whitespace-nowrap border-b border-stone-100 px-2 py-1 font-semibold">
                    {formatHourLabel(hour)}
                  </td>
                  {days.map((day) => {
                    const cell = cellFor(day, hour);
                    return (
                      <td
                        key={`${day.toISOString()}-${hour}`}
                        className="border-b border-stone-100 p-1 align-top"
                      >
                        <SlotCell
                          cell={cell}
                          disabled={pending}
                          isAdmin={isAdmin}
                          mode={mode}
                          onBook={(startsAt) =>
                            openSlotDialog(day, hour, startsAt, "book")
                          }
                          onCancel={(id) => run(() => cancelBooking(id))}
                          onBlock={(startsAt) =>
                            openSlotDialog(day, hour, startsAt, "block")
                          }
                          onUnblock={(id) => run(() => deleteBlock(id))}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {bookDraft && showBookDialog && (
        <BookSlotDialog
          timeLabel={bookDraft.timeLabel}
          locations={bookDraft.locations}
          teams={teams}
          coaches={coachOptions}
          defaultAction={bookDraft.action}
          defaultCoachId={profile.id}
          pending={pending}
          onClose={() => setBookDraft(null)}
          onConfirmBook={(input) => {
            setBookDraft(null);
            run(() =>
              createBooking({
                resourceId: input.resourceId,
                startsAt: input.startsAt,
                teamId: input.teamId,
                title: input.title,
                coachUserId: input.coachUserId,
              })
            );
          }}
          onConfirmBlock={(input) => {
            setBookDraft(null);
            run(() =>
              createBlock({
                resourceId: input.resourceId,
                startsAt: input.startsAt,
                reason: input.reason,
              })
            );
          }}
        />
      )}
    </div>
  );
}

function SlotCell({
  cell,
  disabled,
  isAdmin,
  mode,
  onBook,
  onCancel,
  onBlock,
  onUnblock,
}: {
  cell: CellState;
  disabled: boolean;
  isAdmin: boolean;
  mode: "schedule" | "admin";
  onBook: (startsAt: string) => void;
  onCancel: (id: string) => void;
  onBlock: (startsAt: string) => void;
  onUnblock: (id: string) => void;
}) {
  if (cell.kind === "closed") {
    return (
      <div className="min-h-11 bg-stone-100 px-1.5 py-1 text-xs text-stone-400">
        —
      </div>
    );
  }

  if (cell.kind === "blocked") {
    return (
      <div className="min-h-11 bg-[var(--ink)] px-1.5 py-1 text-xs text-[var(--gold)]">
        <div className="font-bold">Blocked</div>
        <div>{cell.label}</div>
        {isAdmin && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onUnblock(cell.block.id)}
            className="mt-1 underline disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  if (cell.kind === "mine" || cell.kind === "taken") {
    const canCancel = cell.kind === "mine" || isAdmin;
    return (
      <div
        className={
          cell.kind === "mine"
            ? "min-h-11 bg-[var(--maroon)] px-1.5 py-1 text-xs text-white"
            : "min-h-11 border border-[var(--gold)] bg-[var(--gold)]/25 px-1.5 py-1 text-xs text-[var(--ink)]"
        }
      >
        <div className="font-bold">
          {cell.kind === "mine" ? "Your booking" : "Booked"}
        </div>
        <div>{cell.label}</div>
        <div>
          {format(utcIsoToFacilityDate(cell.booking.starts_at), "h:mm a")}
        </div>
        {canCancel && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCancel(cell.booking.id)}
            className={
              cell.kind === "mine"
                ? "mt-1 font-bold text-[var(--gold)] underline disabled:opacity-50"
                : "mt-1 font-bold text-[var(--maroon)] underline disabled:opacity-50"
            }
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (cell.kind !== "open") {
    return null;
  }

  return (
    <div className="grid min-h-11 gap-1 bg-emerald-50 p-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onBook(cell.startsAt)}
        className="rounded bg-emerald-700 px-1.5 py-1 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
      >
        Book
      </button>
      {isAdmin && mode === "admin" && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onBlock(cell.startsAt)}
          className="rounded bg-[var(--ink)] px-1.5 py-1 text-xs font-bold text-[var(--gold)] disabled:opacity-50"
        >
          Block
        </button>
      )}
    </div>
  );
}
