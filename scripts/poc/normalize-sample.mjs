// TEMPORARY Phase 3.1 proof-of-concept code — NOT the production adapter.
// Maps a handful of real ActiveCommunities calendar events to DropIn's
// current canonical Session shape (lib/dropin/types.ts) to test fit. Fields
// the source genuinely does not provide are left undefined rather than
// invented — see docs/PHASE_3_1_ACTIVECOMMUNITIES_POC.md section 16 for the
// full DIRECT MAP / TRANSFORMATION REQUIRED / MODEL GAP classification this
// was used to produce.

function toIsoLocal(spaceSeparated) {
  // Source format: "2026-08-11 19:00:00" -> "2026-08-11T19:00:00"
  return spaceSeparated.replace(" ", "T");
}

function priceToString(price) {
  if (!price) return undefined;
  if (price.free) return "Free";
  if (price.estimate_price) return price.estimate_price;
  return undefined;
}

export function normalizeEvent(event, { municipality, officialSource, fetchedAt, idPrefix }) {
  const facility = event.facilities?.[0];
  const [datePart, timePart] = event.start_time.split(" ");

  return {
    id: `${idPrefix}-${event.event_item_id}-${datePart}-${timePart.replace(/:/g, "")}`,
    projectedOccurrenceId: `${idPrefix}-${event.event_item_id}-${datePart}-${timePart.replace(/:/g, "")}`,
    sourceScheduleId: `${idPrefix}-${event.event_item_id}`,
    activity: event.title,
    category: event.title, // MODEL GAP: no activity taxonomy mapping built yet for this source family
    date: datePart,
    dayOfWeek: undefined, // TRANSFORMATION REQUIRED: derive from date via lib/dropin/time.ts, not from source
    absoluteTime: undefined, // TRANSFORMATION REQUIRED: derive via lib/dropin/time.ts formatAbsoluteTime()
    startMinutes: undefined, // TRANSFORMATION REQUIRED: derive from startDateTime
    startDateTime: toIsoLocal(event.start_time),
    endDateTime: toIsoLocal(event.end_time),
    centre: facility?.facility_name ?? facility?.center_name ?? "",
    municipality,
    district: "", // MODEL GAP: source has no neighbourhood/district concept at all
    address: undefined, // MODEL GAP: source never provides a street address, only a facility name
    postalCode: undefined, // MODEL GAP: not provided
    latitude: undefined, // MODEL GAP: not provided anywhere in this source
    longitude: undefined, // MODEL GAP: not provided anywhere in this source
    price: priceToString(event.price), // DIRECT MAP when present; often "See Facility for Details" (not a real value)
    ageMin: undefined, // MODEL GAP on THIS endpoint specifically — age exists on the separate Activities-search endpoint, not here
    ageMax: undefined,
    phone: undefined, // MODEL GAP: not provided
    officialUrl: event.activity_detail_url, // DIRECT MAP
    officialSource,
    lastUpdated: fetchedAt,
    verificationStatus: "unverified", // RECOMMENDATION: unlike Toronto, not yet proven reliable enough for "verified"
  };
}
