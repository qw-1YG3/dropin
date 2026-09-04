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
// only pass: no sitemap/robots/structured-data/dynamic per-activity
// metadata added here.
const SITE_URL = "https://getdropin.ca";
const SITE_TITLE = "DropIn — Find a drop-in activity near you";
const SITE_DESCRIPTION = "Search-first companion for discovering nearby drop-in recreation activities across the GTA.";
// Branded Social Preview — the approved static artwork, used exactly as
// supplied (not regenerated/cropped/recolored here). A relative path
// resolves against `metadataBase` above, so both og:image and
// twitter:image render as the canonical https://getdropin.ca/... form
// automatically — never the old Vercel URL. One shared static image for
// the whole site; per-activity dynamic OG cards remain a separate,
// deferred P2.
const SOCIAL_PREVIEW_IMAGE = "/dropin-social-preview.png";

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
    images: [SOCIAL_PREVIEW_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_PREVIEW_IMAGE],
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
