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
};

// One overlay mechanism shared by the Quick Action Sheet and the Product
// Information Sheet — same motion family, same scrim, same accessibility
// contract, different content payload and (optionally) different desktop
// placement.
export function Sheet({ open, onClose, titleId, children, desktopVariant = "sheet", initialFocusRef }: SheetProps) {
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
        className="absolute inset-0 bg-gray-900/30 motion-safe:animate-[fadeIn_150ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full max-w-2xl border border-gray-200 bg-white p-5 shadow-lg motion-safe:animate-[slideUp_200ms_ease-out] ${
          isModal
            ? "rounded-t-2xl border-b-0 md:max-w-md md:rounded-2xl md:border-b md:motion-safe:animate-[scaleIn_200ms_ease-out]"
            : "rounded-t-2xl border-b-0"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className={`h-1 w-10 rounded-full bg-gray-200 ${isModal ? "md:hidden" : ""}`} aria-hidden="true" />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
