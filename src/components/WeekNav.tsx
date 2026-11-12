import Link from "next/link";
import { addDays, format } from "date-fns";
import { weekQueryParam } from "@/lib/time";

export function WeekNav({
  weekStart,
  basePath = "/schedule",
}: {
  weekStart: Date;
  basePath?: string;
}) {
  const prev = weekQueryParam(addDays(weekStart, -7));
  const next = weekQueryParam(addDays(weekStart, 7));
  const label = `${format(weekStart, "MMM d")} – ${format(
    addDays(weekStart, 6),
    "MMM d, yyyy"
  )}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <Link
        href={`${basePath}?week=${prev}`}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm font-semibold text-[var(--maroon)]"
      >
        ← Prev
      </Link>
      <strong className="text-sm sm:text-base">{label}</strong>
      <Link
        href={`${basePath}?week=${next}`}
        className="rounded border border-stone-300 px-3 py-1.5 text-sm font-semibold text-[var(--maroon)]"
      >
        Next →
      </Link>
    </div>
  );
}
