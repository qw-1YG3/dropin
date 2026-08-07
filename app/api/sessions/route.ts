import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/dropin/sources";

// Server-only: raw per-municipality data snapshots are imported by their
// adapters, never by client code. This route hands the client only the
// small, already-filtered, normalized Session[] it actually needs, combined
// across every registered municipality.
//
// The full rolling 7-day window — the Results UI (date strip, date-scoped
// filtering/grouping, time-of-day refinement) now understands real calendar
// dates throughout, and Discovery's own highlight pool filters by an exact
// `date === today` match rather than the legacy two-day-only `day` field, so
// it stays scoped to today regardless of how much the fetched dataset covers.
export async function GET() {
  const sessions = getAllSessions(new Date(), { days: 7 });
  return NextResponse.json({ sessions });
}
