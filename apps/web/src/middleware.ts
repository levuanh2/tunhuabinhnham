import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.append("Vary", "Cookie");
  return response;
}

export async function middleware(request: NextRequest) {
  let response = privateResponse(NextResponse.next({ request }));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return privateResponse(
      NextResponse.redirect(new URL("/admin/login?reason=configuration", request.url)),
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = privateResponse(NextResponse.next({ request }));
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return privateResponse(NextResponse.redirect(new URL("/admin/login", request.url)));
  }
  return response;
}

export const config = { matcher: ["/admin", "/admin/((?!login).*)"] };
