import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Custom Domain P1 Cleanup — getdropin.ca is the canonical, attached
// production origin (www redirects to it, never the canonical form
// itself; getdropin.vercel.app remains reachable but is not canonical).
// Defined once so title/description aren't duplicated between the root
// metadata and its Open Graph/Twitter counterparts below. Correctness-
// only pass: no OG image yet (a separate, later launch task — see
// docs/LAUNCH_READINESS_PLAN.md), no sitemap/robots/structured-data/
// dynamic per-activity metadata added here.
const SITE_URL = "https://getdropin.ca";
const SITE_TITLE = "DropIn — Find a drop-in activity near you";
const SITE_DESCRIPTION = "Search-first companion for discovering nearby drop-in recreation activities across the GTA.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: "DropIn",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
