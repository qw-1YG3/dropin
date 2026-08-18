// Shared coordinate validation (Phase 3.4/3.5B, extracted Phase 4.1). This
// GTA-area plausibility check was originally private to
// perfectmind/normalize.ts (the first source to receive real coordinates);
// Phase 4.1's facility-location resolution needs the exact same rule for
// coordinates it obtains from an official-facility dataset or geocoding, so
// it now lives here as the one shared definition rather than being
// duplicated or drifting between two copies.
//
// Wide enough to cover every municipality DropIn could plausibly add
// (Toronto through the outer 905 belt) without being so wide it would
// accept an obviously wrong coordinate (e.g. a swapped lat/long landing in
// the ocean or another continent).
export const GTA_LAT_RANGE: [number, number] = [43.0, 44.5];
export const GTA_LON_RANGE: [number, number] = [-80.5, -78.5];

export function isValidGtaCoordinate(lat: number | undefined, lon: number | undefined): boolean {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  return lat >= GTA_LAT_RANGE[0] && lat <= GTA_LAT_RANGE[1] && lon >= GTA_LON_RANGE[0] && lon <= GTA_LON_RANGE[1];
}

// Keeps only lat/lon that pass the GTA check — everything else becomes
// undefined rather than a silently-wrong value, same discipline the
// PerfectMind adapter already applied to session-level coordinates.
export function validGtaCoordinate(lat: number | undefined, lon: number | undefined): { latitude?: number; longitude?: number } {
  if (!isValidGtaCoordinate(lat, lon)) return {};
  return { latitude: lat, longitude: lon };
}
