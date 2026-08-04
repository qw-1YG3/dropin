"use client";

import { useEffect, useRef } from "react";
import { CloseIcon } from "./icons";

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

  useEffect(() => {
    if (!open) return;
    (initialFocusRef?.current ?? closeButtonRef.current)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center ${isModal ? "md:items-center md:p-4" : ""}`}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-text-primary/30 motion-safe:animate-[fadeIn_150ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full max-w-2xl border border-border bg-white p-5 shadow-[0_16px_40px_-8px_rgba(47,43,39,0.20)] motion-safe:animate-[slideUp_240ms_cubic-bezier(0.16,1,0.3,1)] ${
          isModal
            ? `rounded-t-2xl border-b-0 ${narrow ? "md:max-w-sm" : "md:max-w-md"} md:rounded-2xl md:border-b md:motion-safe:animate-[scaleIn_220ms_cubic-bezier(0.16,1,0.3,1)]`
            : "rounded-t-2xl border-b-0"
        }`}
      >
        <div className={`mb-2 flex justify-center ${isModal ? "md:hidden" : ""}`}>
          <div className="h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        </div>
        <div className="mb-3 flex items-center justify-between gap-3">
          {titleSlot}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex-shrink-0 rounded-full p-1.5 text-text-secondary transition-colors duration-150 hover:bg-hover-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
