import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
  const verification = await fetch(`${apiUrl}/admin/dashboard/stats`, { headers: { Authorization: authorization }, cache: "no-store" });
  if (!verification.ok) return NextResponse.json({ error: "Forbidden" }, { status: verification.status === 401 ? 401 : 403 });
  // Route handlers cannot use updateTag; expire: 0 makes the next request wait for fresh data instead of serving stale.
  revalidateTag("catalog", { expire: 0 });
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true }, { headers: { "Cache-Control": "no-store" } });
}
