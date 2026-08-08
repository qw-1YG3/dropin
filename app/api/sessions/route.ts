import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/dropin/sources";

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
export async function GET() {
  const sessions = getAllSessions(new Date());
  return NextResponse.json({ sessions });
}
