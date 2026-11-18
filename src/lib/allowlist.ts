import { createServiceClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

export type AllowlistEntry = {
  email: string;
  full_name: string | null;
  intended_role: UserRole;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getAllowlistEntry(
  email: string
): Promise<AllowlistEntry | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const supabase = createServiceClient();
  let lastError: Error | null = null;

  // Brief retries — local DNS/network blips show up as TypeError: fetch failed
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data, error } = await supabase
        .from("allowed_emails")
        .select("email, full_name, intended_role")
        .eq("email", normalized)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      return data as AllowlistEntry | null;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const transient = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(
        lastError.message
      );
      if (!transient || attempt === 3) break;
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  throw lastError ?? new Error("Allowlist lookup failed");
}

export async function syncProfileFromAllowlist(
  userId: string,
  email: string
): Promise<AllowlistEntry | null> {
  const entry = await getAllowlistEntry(email);
  if (!entry) return null;

  const supabase = createServiceClient();
  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email: entry.email,
      full_name: entry.full_name,
      role: entry.intended_role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    throw new Error(error.message);
  }
  return entry;
}
