// Launch Readiness 1B — the two public-facing project addresses, defined
// once so every UI surface (About, Feedback, Privacy) references the same
// source instead of a hardcoded string that could drift or, worse, get
// pasted from the wrong place. Both route through Cloudflare Email Routing
// to a private inbox that must NEVER appear in product copy, source code,
// or anywhere else user-visible — only these two addresses are public.
export const PUBLIC_CONTACT_EMAIL = "hello@getdropin.ca";
export const PUBLIC_FEEDBACK_EMAIL = "feedback@getdropin.ca";

// A minimal, non-cumbersome prefill — real content is left to the user to
// write in their own mail client, not constrained by an in-app textarea
// (Launch Readiness 1B, Part 10: "the user should still be able to write
// freely"). Kept as a function rather than a precomputed string so the
// encoding only ever happens once, at the actual call site.
export function feedbackMailtoUrl(): string {
  const subject = "DropIn Feedback";
  const body = ["Hi DropIn team,", "", "I wanted to share feedback about:", "", "", "Details:", ""].join("\n");
  return `mailto:${PUBLIC_FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
