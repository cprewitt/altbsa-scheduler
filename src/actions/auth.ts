"use server";

import { redirect } from "next/navigation";
import { getAllowlistEntry, normalizeEmail } from "@/lib/allowlist";
import { createClient } from "@/lib/supabase/server";

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
    return {
      error: `Could not verify allowlist (${detail}). If you just added the allowlist, run supabase/migrations/002_allowlist.sql in the Supabase SQL Editor, confirm SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart npm run dev.`,
    };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
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
