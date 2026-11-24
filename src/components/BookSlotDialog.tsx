"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_EVENT_TITLE,
  type LocationSlug,
} from "@/lib/schedule-events";
import { formatHourLabel, localSlotToUtcIso } from "@/lib/time";
import type { Profile, Team } from "@/lib/types";

export type BookSlotLocationOption = {
  resourceId: string;
  slug: string;
  name: string;
  /** Pre-filled when opened from a grid cell; omitted when picking date/time. */
  startsAt?: string;
};

export type SlotDialogAction = "book" | "block";

type CoachOption = Pick<Profile, "id" | "email" | "full_name">;

type Props = {
  timeLabel?: string;
  locations: BookSlotLocationOption[];
  teams: Pick<Team, "id" | "name">[];
  /** When set, show coach picker (admin book-on-behalf). */
  coaches?: CoachOption[];
  defaultAction?: SlotDialogAction;
  defaultTeamId?: string | null;
  defaultCoachId?: string;
  /** Let admin choose date + hour instead of a preselected slot. */
  pickDateTime?: boolean;
  defaultDate?: string;
  hourOptions?: number[];
  pending?: boolean;
  onClose: () => void;
  onConfirmBook: (input: {
    resourceId: string;
    startsAt: string;
    teamId: string;
    title: string;
    coachUserId?: string;
  }) => void;
  onConfirmBlock: (input: {
    resourceId: string;
    startsAt: string;
    reason: string;
  }) => void;
};

function defaultTitleForSlug(slug: string): string {
  if (slug in DEFAULT_EVENT_TITLE) {
    return DEFAULT_EVENT_TITLE[slug as LocationSlug];
  }
  return "Practice";
}

function wallClockToStartsAt(dateYmd: string, hour: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const local = new Date(y, m - 1, d, hour, 0, 0, 0);
  return localSlotToUtcIso(local);
}

export function BookSlotDialog({
  timeLabel,
  locations,
  teams,
  coaches,
  defaultAction = "book",
  defaultTeamId,
  defaultCoachId,
  pickDateTime = false,
  defaultDate,
  hourOptions = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  pending,
  onClose,
  onConfirmBook,
  onConfirmBlock,
}: Props) {
  const first = locations[0];
  const [action, setAction] = useState<SlotDialogAction>(defaultAction);
  const [resourceId, setResourceId] = useState(first?.resourceId || "");
  const [title, setTitle] = useState(
    first ? defaultTitleForSlug(first.slug) : "Practice"
  );
  const [teamId, setTeamId] = useState(defaultTeamId || teams[0]?.id || "");
  const [coachUserId, setCoachUserId] = useState(
    defaultCoachId || coaches?.[0]?.id || ""
  );
  const [reason, setReason] = useState("Admin block");
  const [touchedTitle, setTouchedTitle] = useState(false);
  const [dateYmd, setDateYmd] = useState(
    defaultDate || new Date().toISOString().slice(0, 10)
  );
  const [hour, setHour] = useState(hourOptions[0] ?? 17);

  useEffect(() => {
    setAction(defaultAction);
  }, [defaultAction]);

  useEffect(() => {
    if (defaultDate) setDateYmd(defaultDate);
  }, [defaultDate]);

  useEffect(() => {
    const loc = locations.find((l) => l.resourceId === resourceId) || locations[0];
    if (!loc) return;
    setResourceId(loc.resourceId);
    if (!touchedTitle) setTitle(defaultTitleForSlug(loc.slug));
  }, [locations, resourceId, touchedTitle]);

  const selected = useMemo(
    () => locations.find((l) => l.resourceId === resourceId) || locations[0],
    [locations, resourceId]
  );

  const startsAt = useMemo(() => {
    if (pickDateTime) {
      if (!dateYmd || !Number.isFinite(hour)) return null;
      return wallClockToStartsAt(dateYmd, hour);
    }
    return selected?.startsAt || null;
  }, [pickDateTime, dateYmd, hour, selected]);

  const canBook =
    !!selected &&
    !!startsAt &&
    !!teamId &&
    title.trim().length > 0 &&
    (!coaches?.length || !!coachUserId);

  const canBlock = !!selected && !!startsAt && reason.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-slot-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="book-slot-title"
              className="text-lg font-semibold text-[var(--maroon)]"
            >
              Book slot
            </h2>
            {timeLabel ? (
              <p className="mt-0.5 text-sm text-stone-600">{timeLabel}</p>
            ) : (
              <p className="mt-0.5 text-sm text-stone-600">
                Choose book or block, then fill the details.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm font-semibold text-stone-500 hover:bg-stone-100"
          >
            Close
          </button>
        </div>

        <div className="mt-3 flex rounded border border-stone-300 overflow-hidden">
          {(
            [
              ["book", "Book"],
              ["block", "Block"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAction(id)}
              className={
                action === id
                  ? "flex-1 bg-[var(--maroon)] px-3 py-1.5 text-sm font-semibold text-white"
                  : "flex-1 bg-white px-3 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-stone-50"
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 text-sm">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Location
            </span>
            <select
              value={selected?.resourceId || ""}
              onChange={(e) => {
                setResourceId(e.target.value);
                setTouchedTitle(false);
              }}
              className="rounded border border-stone-300 bg-white px-2 py-1.5"
              disabled={locations.length <= 1}
            >
              {locations.map((l) => (
                <option key={l.resourceId} value={l.resourceId}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          {pickDateTime && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Date
                </span>
                <input
                  type="date"
                  value={dateYmd}
                  onChange={(e) => setDateYmd(e.target.value)}
                  className="rounded border border-stone-300 bg-white px-2 py-1.5"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Time
                </span>
                <select
                  value={hour}
                  onChange={(e) => setHour(Number(e.target.value))}
                  className="rounded border border-stone-300 bg-white px-2 py-1.5"
                >
                  {hourOptions.map((h) => (
                    <option key={h} value={h}>
                      {formatHourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {action === "book" ? (
            <>
              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Event name
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => {
                    setTouchedTitle(true);
                    setTitle(e.target.value);
                  }}
                  className="rounded border border-stone-300 bg-white px-2 py-1.5"
                  placeholder="e.g. Batting cages"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Team
                </span>
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="rounded border border-stone-300 bg-white px-2 py-1.5"
                >
                  {teams.length === 0 && (
                    <option value="">No teams available</option>
                  )}
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              {coaches && coaches.length > 0 && (
                <label className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                    Coach
                  </span>
                  <select
                    value={coachUserId}
                    onChange={(e) => setCoachUserId(e.target.value)}
                    className="rounded border border-stone-300 bg-white px-2 py-1.5"
                  >
                    {coaches.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name || c.email}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <label className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Reason
              </span>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="rounded border border-stone-300 bg-white px-2 py-1.5"
                placeholder="e.g. Facility hold"
              />
            </label>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-stone-300 px-3 py-1.5 text-sm font-semibold"
          >
            Cancel
          </button>
          {action === "book" ? (
            <button
              type="button"
              disabled={!canBook || pending}
              className="rounded bg-[var(--maroon)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              onClick={() => {
                if (!selected || !startsAt || !teamId || !title.trim()) return;
                onConfirmBook({
                  resourceId: selected.resourceId,
                  startsAt,
                  teamId,
                  title: title.trim(),
                  coachUserId: coaches?.length ? coachUserId : undefined,
                });
              }}
            >
              {pending ? "Booking…" : "Book"}
            </button>
          ) : (
            <button
              type="button"
              disabled={!canBlock || pending}
              className="rounded bg-[var(--ink)] px-3 py-1.5 text-sm font-semibold text-[var(--gold)] disabled:opacity-50"
              onClick={() => {
                if (!selected || !startsAt || !reason.trim()) return;
                onConfirmBlock({
                  resourceId: selected.resourceId,
                  startsAt,
                  reason: reason.trim(),
                });
              }}
            >
              {pending ? "Blocking…" : "Block"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
