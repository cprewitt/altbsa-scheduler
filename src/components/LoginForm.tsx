"use client";

import { useState, useTransition } from "react";
import { signInWithMagicLink } from "@/actions/auth";

export function LoginForm({ nextPath = "/schedule" }: { nextPath?: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3"
      action={(formData) => {
        setError(null);
        setMessage(null);
        startTransition(async () => {
          const result = await signInWithMagicLink(formData);
          if (result && "error" in result && result.error) {
            setError(result.error);
            return;
          }
          setMessage("Check your email for the magic link.");
        });
      }}
    >
      <input type="hidden" name="next" value={nextPath} />
      <label className="grid gap-1 text-sm">
        <span className="font-semibold">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="coach@example.com"
          className="rounded border border-stone-300 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--maroon)] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a magic link"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-800">{message}</p> : null}
    </form>
  );
}
