"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAllowlistEntry, normalizeEmail } from "@/lib/allowlist";
import { createClient } from "@/lib/supabase/server";

async function magicLinkRedirectTo(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(
    /\/$/,
    ""
  );
  if (configured) {
    return configured.endsWith("/auth/callback")
      ? configured
      : `${configured}/auth/callback`;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "http";
  if (host) {
    return `${proto}://${host}/auth/callback`;
  }
  return "http://localhost:3000/auth/callback";
}

export async function signInWithMagicLink(formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") || ""));
  if (!email) {
    return { error: "Email is required." };
  }

  try {
    const allowed = await getAllowlistEntry(email);
    if (!allowed) {
      return {
        error:
          "That email is not on the ALTBSA scheduler allowlist. Contact the board if you need access.",
      };
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    const networkish = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(
      detail
    );
    return {
      error: networkish
        ? `Could not reach Supabase to verify the allowlist (${detail}). Check your network/DNS, confirm SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart npm run dev.`
        : `Could not verify allowlist (${detail}). If you just added the allowlist, run supabase/migrations/002_allowlist.sql in the Supabase SQL Editor, confirm SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart npm run dev.`,
    };
  }

  const emailRedirectTo = await magicLinkRedirectTo();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    return { error: error.message };
  }
  return { ok: true as const };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
