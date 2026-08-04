"use client";

import type { CSSProperties } from "react";
import SearchSurfaceV2 from "./SearchSurfaceV2";
import { PreviewHeader } from "../_components/PreviewHeader";

// Iteration 2 — the first pass (#F7F8FA background, #26775F accent) was
// judged too subtle. This pass uses a more saturated cool green-gray
// background and a fresher accent, both re-verified against WCAG AA rather
// than assumed. See the chat response for exact before/after values and
// contrast ratios.
const EXPLORATION_THEME = {
  "--surface": "#EEF4F1",
  "--accent": "#21816B",
  "--accent-soft": "#DFF1EA",
} as CSSProperties;

export default function ColourExplorationV2() {
  return (
    <div style={EXPLORATION_THEME}>
      <PreviewHeader pageName="Colour Exploration" stage="V2 — more saturated, still not a decision" version="V2" />
      <SearchSurfaceV2 />
    </div>
  );
}
