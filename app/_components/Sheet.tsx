"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "./icons";

// The single source of truth for how long closing takes — drives the
// scrim's fadeOut, the panel's slideDown/scaleOut, AND the JS unmount timer
// below. All three must match exactly: if the CSS animation and the timer
// disagree, there's a guaranteed window where the animation has already
// finished (and, without an explicit fill-mode, reverted to fully visible)
// before React actually removes the element — a brief flash of the
// scrim/panel reappearing right before it's gone.
const EXIT_DURATION_MS = 200;

// Mobile UX Polish pass — physical-device QA finding: a drag on the handle
// past this distance (px) counts as "let go of the sheet," matching the
// natural threshold every native bottom sheet uses (not too twitchy, not so
// far it feels unresponsive). Anything less snaps back rather than closing.
const SWIPE_DISMISS_THRESHOLD_PX = 80;

type SheetProps = {
  open: boolean;
  onClose: () => void;
  titleId: string;
  children: React.ReactNode;
  /**
   * "sheet" (default) — bottom sheet at every breakpoint. Used by the Quick
   * Action Sheet, unchanged from before.
   * "modal" — bottom sheet on mobile, centered dialog from md: up. The
   * Search Surface stays visible behind the scrim in both cases either way;
   * only the sheet's own position/shape changes.
   */
  desktopVariant?: "sheet" | "modal";
  /**
   * Element to focus when the sheet opens, instead of the Close button.
   * Use for sheets with one clear primary action (e.g. Directions) so
   * keyboard/screen-reader users land on it immediately rather than on Close.
   * Defaults to focusing Close, which remains correct for purely
   * informational sheets with no single primary action.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Optional content placed in the same row as Close, sharing its
   * horizontal space instead of leaving Close alone above a title that
   * renders further down. Use for sheets whose content leads with a short
   * title (e.g. the Quick Action Sheet's activity name) — an empty header
   * row above the title wastes vertical space without reading as
   * intentional whitespace. Leave unset for sheets like Product
   * Information, whose content doesn't lead with a single short title.
   */
  titleSlot?: React.ReactNode;
  /**
   * Narrows the desktop centered modal from md:max-w-md to md:max-w-sm.
   * Use for sparse content (e.g. the Quick Action Sheet's short title, one
   * line of centre text, and two stacked buttons) where the default width
   * leaves disproportionate side whitespace relative to how little content
   * fills it. Has no effect on the mobile bottom sheet, which is already
   * full-width by nature. Leave unset for content-dense sheets like Product
   * Information.
   */
  narrow?: boolean;
};

// One overlay mechanism shared by the Quick Action Sheet and the Product
// Information Sheet — same motion family, same scrim, same accessibility
// contract, different content payload and (optionally) different desktop
// placement.
export function Sheet({
  open,
  onClose,
  titleId,
  children,
  desktopVariant = "sheet",
  initialFocusRef,
  titleSlot,
  narrow = false,
}: SheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isModal = desktopVariant === "modal";

  // Mirrors `open`, but lags behind on the close transition so the sheet
  // stays mounted long enough to play its exit animation instead of
  // vanishing the instant `open` goes false.
  const [shouldRender, setShouldRender] = useState(open);
  const [closing, setClosing] = useState(false);

  // Swipe-down-to-dismiss, scoped to the drag handle only (never the
  // content area) — mobile bottom sheets only, since touch events simply
  // never fire from mouse/trackpad interaction, no separate desktop guard
  // needed. Scoping the gesture to the handle rather than the whole panel
  // means normal scrolling/tapping inside the sheet's content is completely
  // unaffected; only a touch that starts on the small handle nub can ever
  // move the panel.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef(0);

  function handleHandleTouchStart(e: React.TouchEvent) {
    dragStartYRef.current = e.touches[0].clientY;
    setDragging(true);
  }
  function handleHandleTouchMove(e: React.TouchEvent) {
    const delta = e.touches[0].clientY - dragStartYRef.current;
    if (delta > 0) setDragY(delta);
  }
  function handleHandleTouchEnd() {
    setDragging(false);
    if (dragY > SWIPE_DISMISS_THRESHOLD_PX) onClose();
    setDragY(0);
  }

  // Callers often derive `children`/`titleSlot` from state that's cleared
  // the instant `onClose` fires (e.g. the Quick Action Sheet's `selectedSession
  // && ...`) — that state going null and `open` going false happen in the
  // same render. Without this, the sheet would stay mounted to animate out
  // as designed, but with genuinely empty content, since the prop itself
  // has already gone blank. Freezing the last real content while `open` is
  // true means the closing sheet keeps showing what the user was just
  // looking at instead of flashing empty.
  const lastContent = useRef<{ children: React.ReactNode; titleSlot: React.ReactNode }>({ children, titleSlot });
  if (open) {
    lastContent.current = { children, titleSlot };
  }

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setClosing(false);
      return;
    }
    if (!shouldRender) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setShouldRender(false);
      setClosing(false);
    }, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (initialFocusRef?.current ?? closeButtonRef.current)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center ${isModal ? "md:items-center md:p-4" : ""}`}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        tabIndex={closing ? -1 : undefined}
        className={`absolute inset-0 bg-text-primary/30 ${
          closing
            ? `pointer-events-none motion-safe:animate-[fadeOut_${EXIT_DURATION_MS}ms_ease-out_both]`
            : "motion-safe:animate-[fadeIn_150ms_ease-out_both]"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        // Drag transform is applied via inline `style`, independent of the
        // `animate-[...]` utility classes below — the two never run at the
        // same time (dragging only happens once fully open; a release past
        // the threshold calls onClose, which resets dragY to 0 before the
        // close animation's own transform ever takes over), so there's no
        // conflict between the two mechanisms.
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: dragging ? "none" : "transform 200ms cubic-bezier(0.16,1,0.3,1)" } : undefined}
        // Scroll comfort — without a height cap, a long sheet (About's five
        // sections, on a real phone viewport) can grow taller than the
        // screen; since the panel is bottom-anchored (`items-end`), the
        // overflow happens at the TOP, pushing the handle/title/Close
        // completely off-screen with no way to scroll up and reach them —
        // reproduced live this pass (panel 43.5px taller than a real 757px
        // viewport). `max-h-[90dvh] overflow-y-auto` on THIS element fixes
        // it. A separate attempt — the same two classes on a new child
        // wrapped around only the body content, so the handle/title/Close
        // could stay pinned while just the content scrolled — was tried
        // first and reverted: it reproduced a real, confirmed Chrome
        // rendering defect (background page content bleeding through the
        // fully-opaque panel), independent of the animation below.
        // `overflow-y-auto` directly on this already-animated element,
        // instead of on a new nested scrolling child, does not trigger that
        // defect — verified live. Trade-off, accepted deliberately: the
        // handle/title/Close now scroll away with long content instead of
        // staying pinned, but that's a minor cost against the alternative
        // (content genuinely unreachable).
        className={`relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto overscroll-contain border border-border bg-white px-5 pb-5 pt-3 shadow-[0_16px_40px_-8px_rgba(47,43,39,0.20)] md:pt-5 ${
          closing
            ? `pointer-events-none motion-safe:animate-[slideDown_${EXIT_DURATION_MS}ms_cubic-bezier(0.16,1,0.3,1)_both]`
            : "motion-safe:animate-[slideUp_240ms_cubic-bezier(0.16,1,0.3,1)_both]"
        } ${
          isModal
            ? `rounded-t-2xl border-b-0 ${narrow ? "md:max-w-sm" : "md:max-w-md"} md:rounded-2xl md:border-b ${
                closing
                  ? `md:motion-safe:animate-[scaleOut_${EXIT_DURATION_MS}ms_cubic-bezier(0.16,1,0.3,1)_both]`
                  : "md:motion-safe:animate-[scaleIn_220ms_cubic-bezier(0.16,1,0.3,1)_both]"
              }`
            : "rounded-t-2xl border-b-0"
        }`}
      >
        {/* Mobile UX Polish pass — physical-device QA found the handle,
            title row, and Close button too close together. The touch zone
            below is deliberately taller than the visible pill (an
            invisible, generous grab target, same "enlarge the tap area
            without enlarging the visual" idea as the Close button below) and
            its own bottom padding is what creates the breathing room before
            the title row — replaces the old bare `mb-2`. `touch-none` stops
            the browser's own scroll/zoom gesture from fighting the drag
            while a finger is on the handle specifically; nothing outside
            this small zone is affected, so normal content scrolling and
            taps elsewhere in the sheet are untouched.

            Round 2 physical-device QA (2026-08-28): that fix correctly
            separated the handle from the title, but on a real phone the
            resulting gap read as too much dead space at the very top of a
            sheet, where vertical room is scarcest. Mobile-only, this zone's
            own padding shrinks (pt-3→pt-2, pb-5→pb-3.5) and the panel's own
            top padding above it does too (see the panel `className` above,
            pt-5→pt-3) — together, the handle sits visibly closer to the
            sheet's rounded top edge and the gap before the title is smaller
            but still a deliberate, comfortable gap, never the pre-Mobile-
            Polish bare `mb-2`. `md:` restores the exact original values
            (pt-3/pb-5, panel pt-5) so nothing here changes at desktop —
            distinct from `isModal ? "md:hidden" : ""` above, which already
            hides this entire zone at desktop for every current "modal"
            consumer regardless. The touch zone itself is still a full-width,
            ~26px-tall grab target (pt-2 + the 4px pill + pb-3.5), still
            comfortably larger than the pre-Polish original, which had no
            dedicated touch zone at all. */}
        <div className={`flex justify-center ${isModal ? "md:hidden" : ""}`}>
          <div
            className="flex w-full touch-none justify-center pt-2 pb-3.5 md:pt-3 md:pb-5"
            onTouchStart={handleHandleTouchStart}
            onTouchMove={handleHandleTouchMove}
            onTouchEnd={handleHandleTouchEnd}
          >
            <div className="h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          </div>
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          {lastContent.current.titleSlot}
          {/* 44×44 minimum touch target (mobile only — `md:h-auto md:w-auto`
              reverts to the original, smaller desktop hit area, since this
              is a touch-ergonomics fix, not a desktop redesign). The visible
              × glyph itself is unchanged; only the invisible tappable box
              around it grows, exactly like the handle above.

              Round 2 physical-device QA (2026-08-28): this outer button used
              to carry the visible chrome (background, ring) directly, which
              meant hover/focus-visible/active styles painted the FULL 44×44
              box — invisible at rest, but a jarringly large sage circle the
              moment Safari treated this sheet's open-time autofocus
              (`closeButtonRef.current?.focus()` below) as focus-visible.
              Decoupled here: this outer element is now purely the
              interactive hit target (sizing + focus/click semantics only,
              no visible chrome of its own) and `group` hands its
              hover/focus-visible/active state down to the small inner span,
              which carries the actual background/ring/scale and is sized to
              exactly the ~28px the visible × already occupied at desktop
              (`p-1.5` + the 16px icon) — so the ring now traces a small
              quiet circle around the ×, not the full invisible grab zone,
              at both breakpoints, while the 44×44 touch target and every
              interaction (click, keyboard, screen-reader name) stay on this
              same outer button, completely unchanged. */}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="group ml-auto flex h-11 w-11 flex-shrink-0 items-center justify-center focus-visible:outline-none md:h-auto md:w-auto"
          >
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-full p-1.5 text-text-secondary transition-all duration-150 ease-out group-hover:bg-hover-surface group-hover:text-text-primary group-focus-visible:ring-2 group-focus-visible:ring-sage-text group-active:scale-95"
            >
              <CloseIcon className="h-4 w-4" />
            </span>
          </button>
        </div>
        {lastContent.current.children}
      </div>
    </div>
  );
}
