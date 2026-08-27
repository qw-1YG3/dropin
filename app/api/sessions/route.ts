import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/dropin/sources";
import { createPresignedReadUrl, isR2StorageMode } from "@/lib/dropin/snapshot/io";
import { combinedLatestPath } from "@/lib/dropin/snapshot/paths";

// Server-only: raw per-municipality data snapshots are imported by their
// adapters, never by client code. This route hands the client only the
// small, already-filtered, normalized Session[] it actually needs, combined
// across every registered municipality.
//
// No explicit `days` here on purpose: the UI's 7-day quick-nav strip and the
// data layer's real fetch/availability window are deliberately two different
// concepts now. Each adapter knows its own genuine schedule-availability
// boundary (see getTorontoSessions' default) — this route just asks for
// "everything the source can honestly back up" and lets the client's own
// calendar/date-strip logic decide how to navigate within it. Discovery's
// highlight pool separately filters by an exact `date === today` match, so
// it stays scoped to today regardless of how much data this returns.

// Phase 5B response-size architecture decision: R2's own object bytes
// (~26MB) exceed Vercel's Function response limit — a redirect to a
// short-lived presigned URL serves those bytes directly from R2/CDN,
// never through this Function's own response body. 300s comfortably
// covers even a slow mobile connection completing a ~26MB download
// (at ~1 Mbps that's ~3.5 minutes) with real margin, while still being
// unambiguously "short-lived" — a fresh URL is generated on every
// request, never reused, never cached beyond one response.
const PRESIGNED_URL_EXPIRY_SECONDS = 300;

export async function GET() {
  if (isR2StorageMode()) {
    // Deliberately does NOT call getAllSessions()/read the combined
    // object's bytes here — the whole point is that this Function never
    // holds the ~26MB payload in memory or in its own response body. The
    // client's existing `fetch("/api/sessions")` follows this redirect
    // transparently; the bytes arrive from R2 directly.
    const url = await createPresignedReadUrl(combinedLatestPath(), PRESIGNED_URL_EXPIRY_SECONDS);
    return NextResponse.redirect(url);
  }

  // Local filesystem development — unchanged from before this phase.
  const sessions = await getAllSessions(new Date());
  return NextResponse.json({ sessions });
}
