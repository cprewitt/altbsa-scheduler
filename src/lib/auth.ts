import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export async function getSessionProfile(): Promise<{
  userId: string;
  profile: Profile;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (data) {
    return { userId: user.id, profile: data as Profile };
  }

  return {
    userId: user.id,
    profile: {
      id: user.id,
      email: user.email || "",
      full_name: null,
      role: "coach",
    },
  };
}
