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
  const { data, error } = await supabase
    .from("allowed_emails")
    .select("email, full_name, intended_role")
    .eq("email", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data as AllowlistEntry | null;
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
