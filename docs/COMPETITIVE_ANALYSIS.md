# Competitive Analysis

A living document. Add new competitors below, following the same structure: what they do well, where they create friction, what opportunities exist for DropIn, and our differentiation strategy.

---

## RecFinderTO

**What it is:** [recfinderto.ca](https://recfinderto.ca/) — "Toronto Drop-in Recreation Finder," built by Purpose Analytics. Uses the same underlying City of Toronto Open Data drop-in dataset we do, refreshed nightly, and explicitly scoped to drop-in programs only (not registered programs) — the same MVP boundary we've drawn for ourselves.

### What it does well

- Real, working filters for category, subcategory, date, time, age, and a text search box, all visible on one screen.
- A combined map + list view, so results are spatially browsable, not just a flat list.
- Honest about its own limits: an "About" panel explicitly states data is refreshed nightly, that last-minute changes may not be reflected, and that users should contact the centre directly for fees and current availability — a source-of-truth stance close to our own "don't imply certainty" principle.
- Search is reasonably forgiving as a prefix match (typing "badmin" surfaces "Badminton," "Badminton - Court," "Badminton (Women)," "Badminton with Family").

### Where it creates friction

- **Centre-first by default, not activity-first.** The result list's default sort is "Location name" — alphabetical by community centre — not by time or distance. A user has to actively change the sort to get anything resembling "what can I do soonest."
- **Raw, ungrouped category names.** Search for "Badminton" surfaces four separate, disconnected entries — "Badminton," "Badminton - Court," "Badminton (Women)," "Badminton with Family" — as flat, independent results rather than one normalized activity with visible variants. A user has to know to check all four, or miss sessions.
- **Defaults to "Tomorrow," not "Today."** The date filter opens on tomorrow's programs rather than answering the more urgent "what can I do right now" question.
- **No distance or price on the result card.** Cards show activity name, age range, centre name, date, and time — but not how far away it is or what it costs, even though the tool has the user's location context available via its map.
- **Dense, desktop-oriented layout.** A results sidebar next to a 200+ pin map is a lot of simultaneous visual information; it reads as a data-browsing tool rather than a quick decision aid, and doesn't obviously simplify down for a fast mobile glance.
- **No urgency framing.** Times are shown as plain start/end ranges ("7:00 AM – 8:45 AM"), never as "starts in X minutes," so there's no immediate sense of what's happening imminently versus later.

### Opportunities for DropIn

- Own the "what can I do right now, nearby" moment that RecFinderTO's alphabetical-by-centre default and tomorrow-first date filter don't answer well.
- Normalize the fragmented raw category names (our Activity / Activity Group model) so one search surfaces all real variants instead of requiring the user to guess every naming permutation.
- Surface distance and price directly on the result card — RecFinderTO has the underlying location data (it's driving a map) but doesn't put distance on the list itself.
- Lead with urgency-framed time and a mobile-first, decision-focused layout, rather than a dense data-browser layout.

### Our differentiation strategy

RecFinderTO proves the data foundation (Toronto Open Data, drop-in only) is workable — it's already doing it. DropIn's differentiation isn't the data; it's the decision layer on top of it: activity-first ranking (soonest + closest, not alphabetical by centre), a normalized activity taxonomy instead of raw source category names, urgency-framed time, and a calm, mobile-first, one-decision-per-screen experience aimed at answering "where can I go right now" in seconds rather than presenting a full browsable dataset.
