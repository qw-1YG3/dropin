import { NextResponse } from "next/server";
import { getAllSessions } from "@/lib/dropin/sources";

// Server-only: raw per-municipality data snapshots are imported by their
// adapters, never by client code. This route hands the client only the
// small, already-filtered, normalized Session[] it actually needs for
// Today/Tomorrow, combined across every registered municipality.
export async function GET() {
  const sessions = getAllSessions(new Date());
  return NextResponse.json({ sessions });
}
