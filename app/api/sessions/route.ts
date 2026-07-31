import { NextResponse } from "next/server";
import { normalizeSessions } from "@/lib/dropin/normalize";

// Server-only: the raw Toronto Open Data snapshot (~4.5MB across both
// resources) is imported by the normalizer, never by client code. This
// route hands the client only the small, already-filtered Session[] it
// actually needs for Today/Tomorrow.
export async function GET() {
  const sessions = normalizeSessions(new Date());
  return NextResponse.json({ sessions });
}
