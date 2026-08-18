// Toronto's official "Parks and Recreation Facilities" open dataset
// (Phase 4.1) — a real City of Toronto CKAN dataset, entirely separate from
// the "Registered Programs and Drop-in Courses Offering" package DropIn's
// session data already comes from, confirmed live this phase to carry real
// WGS84 (EPSG:4326) coordinates for ~1,795 parks/community-centre records —
// exactly the "another verified official endpoint from the same
// municipality" tier (Part 4, tier "official-facility-source") Phase 4.0
// hypothesized but did not confirm. This is build-script-only: never
// imported by app/ or lib/dropin/sources/index.ts, called only from
// scripts/refresh/facility-locations.ts.
//
// Dataset: cbea3a67-9168-4c6d-8186-16ac1a795b5b ("parks-and-recreation-facilities")
// Resource used: 61691590-4c3f-42d3-94c5-443ad3856f64 ("...-4326.csv", WGS84)
const CKAN_HOST = "https://ckan0.cf.opendata.inter.prod-toronto.ca";
const DATASET_ID = "cbea3a67-9168-4c6d-8186-16ac1a795b5b";
const CSV_RESOURCE_ID = "61691590-4c3f-42d3-94c5-443ad3856f64";
const FETCH_TIMEOUT_MS = 30_000;

export type TorontoFacilityRecord = {
  assetName: string;
  type: string;
  address: string;
  latitude: number;
  longitude: number;
};

// Standard CSV quote escaping: a doubled `""` inside a quoted field is a
// literal `"`, not a field boundary — the geometry column (real JSON,
// containing many internal quote characters) is unparseable without this;
// a naive toggle-on-every-quote parser silently corrupts every row.
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      result.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  result.push(cur);
  return result;
}

// A geometry cell looks like {"coordinates": [[-79.44, 43.66]], "type": "MultiPoint"} —
// real shape confirmed against live data this phase, not assumed.
function parseGeometry(cell: string): { longitude: number; latitude: number } | undefined {
  try {
    const parsed = JSON.parse(cell) as { coordinates?: unknown };
    const coords = parsed.coordinates;
    const point = Array.isArray(coords) ? (Array.isArray(coords[0]) ? coords[0] : coords) : undefined;
    if (Array.isArray(point) && typeof point[0] === "number" && typeof point[1] === "number") {
      return { longitude: point[0], latitude: point[1] };
    }
  } catch {
    // Malformed geometry cell — treated as no coordinate, never guessed.
  }
  return undefined;
}

export async function fetchTorontoFacilities(): Promise<TorontoFacilityRecord[]> {
  const url = `${CKAN_HOST}/dataset/${DATASET_ID}/resource/${CSV_RESOURCE_ID}/download/parks-and-recreation-facilities-4326.csv`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Toronto facilities CSV fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  const header = parseCsvLine(lines[0]);
  const nameIdx = header.indexOf("ASSET_NAME");
  const typeIdx = header.indexOf("TYPE");
  const addrIdx = header.indexOf("ADDRESS");
  const geomIdx = header.findIndex((h) => h.trim() === "geometry");
  if (nameIdx === -1 || addrIdx === -1 || geomIdx === -1) {
    throw new Error(`Toronto facilities CSV: expected columns not found (got header: ${header.join(", ")})`);
  }

  const records: TorontoFacilityRecord[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const geo = parseGeometry(cols[geomIdx]);
    if (!geo) continue;
    records.push({
      assetName: cols[nameIdx].trim(),
      type: cols[typeIdx]?.trim() ?? "",
      address: cols[addrIdx].trim(),
      latitude: geo.latitude,
      longitude: geo.longitude,
    });
  }
  if (records.length === 0) throw new Error("Toronto facilities CSV: parsed zero valid records");
  return records;
}

// Matches a DropIn session's (centre name, address) against the official
// facilities dataset — name first (exact, case-insensitive), then a
// street-number + first-street-word address prefix as a fallback, since
// several real facilities are named slightly differently between the two
// City of Toronto datasets (e.g. "and Arena"/"& Playground Paradise"
// suffixes present in one source but not the other — confirmed this
// phase, not a hypothetical). Neither is fuzzy string similarity — both
// are exact matches on a specific, real field.
function addressPrefixKey(address: string | undefined): string | undefined {
  if (!address) return undefined;
  const match = address.trim().toUpperCase().match(/^(\d+[A-Z]?)\s+(\S+)/);
  return match ? `${match[1]} ${match[2]}` : address.trim().toUpperCase();
}

export function matchTorontoFacility(
  records: TorontoFacilityRecord[],
  centreName: string,
  centreAddress: string | undefined,
): TorontoFacilityRecord | undefined {
  const byName = records.find((r) => r.assetName.toUpperCase() === centreName.trim().toUpperCase());
  if (byName) return byName;

  const targetKey = addressPrefixKey(centreAddress);
  if (!targetKey) return undefined;
  return records.find((r) => addressPrefixKey(r.address) === targetKey);
}
