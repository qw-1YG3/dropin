export type Day = "today" | "tomorrow";

export type VerificationStatus = "verified" | "unverified";

// DropIn's common normalized session model — the one shape every municipal
// data source adapter (lib/dropin/sources/*) must produce. The Search Engine
// only ever operates on this; it never knows or cares which municipality or
// raw format a record came from. Only fields a source can actually verify
// are required — latitude/longitude, price, phone, officialUrl, and postal
// code are optional because most current sources (Toronto included) don't
// publish all of them, and inventing values would violate "Don't imply
// certainty when the data cannot support it."
export type Session = {
  id: string;
  activity: string;
  category: string;
  day: Day;
  urgent: boolean;
  absoluteTime: string;
  startMinutes: number;
  centre: string;
  municipality: string;
  district: string;
  address?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  price?: string;
  phone?: string;
  officialUrl?: string;
  officialSource: string;
  lastUpdated: string;
  verificationStatus: VerificationStatus;
};
