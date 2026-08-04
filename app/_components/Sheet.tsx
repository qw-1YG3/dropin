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
        className={`relative w-full max-w-2xl border border-border bg-white p-5 shadow-[0_16px_40px_-8px_rgba(47,43,39,0.20)] ${
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
        <div className={`mb-2 flex justify-center ${isModal ? "md:hidden" : ""}`}>
          <div className="h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          {lastContent.current.titleSlot}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex-shrink-0 rounded-full p-1.5 text-text-secondary transition-all duration-150 ease-out hover:bg-hover-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {lastContent.current.children}
      </div>
    </div>
  );
}
