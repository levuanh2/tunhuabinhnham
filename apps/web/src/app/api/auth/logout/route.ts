import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase Auth is not configured" }, { status: 503 });
  }

  const response = NextResponse.json(
    { signedOut: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: "Unable to sign out" }, { status: 502 });
  }
  request.cookies
    .getAll()
    .filter(({ name }) => name.startsWith("sb-") && name.includes("auth-token"))
    .forEach(({ name }) => {
      response.cookies.set(name, "", { expires: new Date(0), maxAge: 0, path: "/" });
    });
  return response;
}
