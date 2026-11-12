import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const bannerError =
    params.error === "not_allowed"
      ? "That email is not on the ALTBSA scheduler allowlist. Contact the board if you need access."
      : params.error === "auth"
        ? "Sign-in link was invalid or expired. Request a new magic link."
        : null;

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="rounded-lg border border-[var(--maroon)]/15 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-[var(--maroon)]">
          ALTBSA
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--ink)]">
          Anchor Scheduler
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Coaches on the allowlist sign in with a magic link to book Cages or
          Court when a spot is open. Bookings auto-confirm.
        </p>
        {bannerError ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {bannerError}
          </p>
        ) : null}
        <div className="mt-6">
          {configured ? (
            <LoginForm />
          ) : (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Supabase is not configured yet. Copy{" "}
              <code className="font-mono text-xs">.env.example</code> to{" "}
              <code className="font-mono text-xs">.env.local</code> and add
              your project URL and anon key.
            </p>
          )}
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-stone-500">
        Target host: schedule.altbsa.org
      </p>
    </main>
  );
}
