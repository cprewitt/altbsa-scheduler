"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { slotEndIso } from "@/lib/time";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in.", supabase, user: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return { error: "Admin access required.", supabase, user: null };
  }
  return { error: null, supabase, user };
}

export async function createBlock(input: {
  resourceId: string;
  startsAt: string;
  endsAt?: string;
  reason?: string;
}) {
  const { error: authError, supabase, user } = await requireAdmin();
  if (authError || !user) return { error: authError || "Unauthorized" };

  const endsAt = input.endsAt || slotEndIso(input.startsAt);

  const { error } = await supabase.from("resource_blocks").insert({
    resource_id: input.resourceId,
    starts_at: input.startsAt,
    ends_at: endsAt,
    reason: input.reason || null,
    created_by: user.id,
  });

  if (error) {
    if (error.code === "23P01" || /overlap|exclude/i.test(error.message)) {
      return { error: "That block overlaps an existing block." };
    }
    return { error: error.message };
  }

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}

export async function deleteBlock(blockId: string) {
  const { error: authError, supabase } = await requireAdmin();
  if (authError) return { error: authError };

  const { error } = await supabase
    .from("resource_blocks")
    .delete()
    .eq("id", blockId);

  if (error) return { error: error.message };

  revalidatePath("/schedule");
  revalidatePath("/admin");
  return { ok: true as const };
}
