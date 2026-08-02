// Shapes mirror Toronto Open Data's "Registered Programs and Drop-in Courses
// Offering" package exactly (Drop-in.json / Locations.json resources) — field
// names keep the source's original casing/spacing so a diff against a fresh
// API pull stays meaningful.

export type RawDropInRecord = {
  _id: number;
  "Location ID": number;
  Course_ID: number;
  "Course Title": string;
  Section: string;
  "Age Min": string;
  "Age Max": string;
  "Date Range": string;
  "Start Hour": number;
  "Start Minute": number;
  "End Hour": number;
  "End Min": number;
  "First Date": string;
  "Last Date": string;
  DayOftheWeek: string;
};

export type RawLocation = {
  _id: number;
  "Location ID": number;
  "Parent Location ID": number;
  "Location Name": string;
  "Location Type": string;
  Accessibility: string;
  Intersection: string;
  "TTC Information": string;
  District: string;
  "Street No": string;
  "Street No Suffix": string;
  "Street Name": string;
  "Street Type": string;
  "Street Direction": string;
  "Postal Code": string;
  Description: string;
};

export type Day = "today" | "tomorrow";

// DropIn's internal session model. Only fields the real dataset can actually
// verify are required — price, phone, and officialUrl don't exist anywhere
// in Toronto Open Data, so they stay optional rather than being invented.
// distanceKm is likewise omitted until Phase 2 geolocation can compute it for
// real, per "Don't imply certainty when the data cannot support it."
export type Session = {
  id: number;
  activity: string;
  day: Day;
  urgent: boolean;
  absoluteTime: string;
  centre: string;
  district: string;
  postalCode?: string;
  distanceKm?: number;
  price?: string;
  phone?: string;
  officialUrl?: string;
};
