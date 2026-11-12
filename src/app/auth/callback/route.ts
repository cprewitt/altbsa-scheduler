import { NextResponse } from "next/server";
import { syncProfileFromAllowlist } from "@/lib/allowlist";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/schedule";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=auth`);
      }

      try {
        const entry = await syncProfileFromAllowlist(user.id, user.email);
        if (!entry) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=not_allowed`);
        }
      } catch {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=auth`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
