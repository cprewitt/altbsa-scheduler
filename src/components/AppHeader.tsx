import Link from "next/link";
import { signOut } from "@/actions/auth";
import type { Profile } from "@/lib/types";

export function AppHeader({
  profile,
  active,
}: {
  profile: Profile;
  active: "schedule" | "admin";
}) {
  const isAdmin = profile.role === "admin";

  return (
    <header className="border-b-4 border-[var(--gold)] bg-[var(--maroon)] text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div>
          <div className="font-extrabold tracking-wide">
            ALTBSA Anchor Scheduler
          </div>
          <div className="text-sm text-white/90">
            {profile.full_name || profile.email}
            {isAdmin ? " · admin" : " · coach"}
          </div>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link
            href="/schedule"
            className={
              active === "schedule" ? "font-extrabold underline" : "font-medium"
            }
          >
            Schedule
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className={
                active === "admin" ? "font-extrabold underline" : "font-medium"
              }
            >
              Admin
            </Link>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded border border-[var(--gold)] px-2.5 py-1 font-semibold text-[var(--gold)]"
            >
              Sign out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
