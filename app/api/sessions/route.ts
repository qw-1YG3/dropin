import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/dropin/sources";

// Server-only: raw per-municipality data snapshots are imported by their
// adapters, never by client code. This route hands the client only the
// small, already-filtered, normalized Session[] it actually needs, combined
// across every registered municipality.
//
// The data layer can now honestly serve a real rolling 7-day window (see
// lib/dropin/sources/toronto.ts and lib/dropin/time.ts) — this route still
// explicitly requests only 2 days (today/tomorrow) on purpose. The Results
// UI (Discovery's highlight pool, the Today/This Week toggle, day-based
// grouping) was all built against a strictly two-day assumption; widening
// this without first rebuilding that UI would make the meta count and the
// visible list disagree, since day-3-onward sessions would be present in
// the data but invisible in the current grouping. Raise `days` here once
// that UI work ships.
export async function GET() {
  const sessions = getAllSessions(new Date(), { days: 2 });
  return NextResponse.json({ sessions });
}
