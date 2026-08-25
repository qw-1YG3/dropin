import { NextResponse } from "next/server";

// /design/* is an internal design-review environment (see
// docs/PROJECT_WORKFLOW.md) — never a production surface. This intercepts
// the request before Next.js renders or serves any page for that path, so
// no page content (including its RSC hydration payload) is ever
// transmitted to a production visitor. Development is unaffected — the
// preview workflow keeps working under `next dev`.
export function proxy() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/design", "/design/:path*"],
};
