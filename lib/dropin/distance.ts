// Straight-line distance (Phase 4.2, Part 7/8). Deterministic, no
// dependency, no network call — the same discipline as coordinates.ts's
// validation: a small pure-function module, not a service. Phase 4.0's own
// analysis (docs/PHASE_4_0_GEOSPATIAL_READINESS_MAP_NECESSITY_AUDIT.md §8)
// already concluded Haversine is sufficient for a first version at DropIn's
// GTA scale — this is that implementation, unchanged in scope.
const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two coordinate pairs, in kilometres.
// Geographic proximity only — never presented as drive distance, walking
// distance, or travel time (Part 21); callers are responsible for that
// framing, this function just returns a number.
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Rounding rule (Part 8), chosen to avoid false precision without being so
// coarse it stops being useful for comparing two nearby options:
//   < 10 km  -> one decimal place  (0.4 km, 1.2 km, 3.8 km)
//   >= 10 km -> nearest whole km   (12 km, 47 km)
// A raw Haversine result carries far more precision than a straight-line
// estimate can honestly claim (it doesn't account for roads, elevation, or
// GPS accuracy) — this is the same "don't imply certainty the data can't
// support" principle already applied to price/age elsewhere in this project.
export function formatDistanceKm(km: number): number {
  if (km < 10) return Math.round(km * 10) / 10;
  return Math.round(km);
}
