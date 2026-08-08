"use client";

import { useEffect, useState } from "react";
import { fullDateLabel } from "@/lib/dropin/time";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "./icons";
import { Sheet } from "./Sheet";

const WEEKDAY_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymKey(dateKey: string): { year: number; month: number } {
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)) - 1 };
}

type GridCell = { dateKey: string; day: number } | null;

// Plain Date arithmetic, not lib/dropin/time.ts's date-key utilities — this
// is month-grid layout math (offsets, days-in-month), a presentation
// concern specific to this component, not a data-layer date concept shared
// with the rest of the product.
function buildMonthGrid(year: number, month: number): GridCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: GridCell[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ dateKey: `${year}-${pad2(month + 1)}-${pad2(day)}`, day });
  }
  return cells;
}

type DateCalendarProps = {
  open: boolean;
  onClose: () => void;
  now: Date;
  selectedDate: string;
  todayDateKey: string;
  /** Earliest selectable date-key, inclusive — today, in practice. */
  minDateKey: string;
  /** Latest selectable date-key, inclusive — the real source-data boundary, never fabricated. */
  maxDateKey: string;
  onSelectDate: (dateKey: string) => void;
};

// The secondary "choose another date" mechanism — the 7-day strip stays the
// primary fast-navigation surface. Reuses Sheet for its existing
// bottom-sheet-on-mobile / centered-modal-on-desktop behaviour rather than
// building a new popover mechanism from scratch.
export function DateCalendar({
  open,
  onClose,
  now,
  selectedDate,
  todayDateKey,
  minDateKey,
  maxDateKey,
  onSelectDate,
}: DateCalendarProps) {
  const [view, setView] = useState(() => ymKey(selectedDate));

  // Re-centers on whichever date is actually selected every time the sheet
  // opens, rather than remembering wherever it was last scrolled to — "opens
  // around the currently selected date," not around browsing history.
  useEffect(() => {
    if (open) setView(ymKey(selectedDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const min = ymKey(minDateKey);
  const max = ymKey(maxDateKey);
  const canGoPrev = view.year > min.year || (view.year === min.year && view.month > min.month);
  const canGoNext = view.year < max.year || (view.year === max.year && view.month < max.month);

  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const cells = buildMonthGrid(view.year, view.month);

  return (
    <Sheet open={open} onClose={onClose} titleId="date-calendar-title" desktopVariant="modal" narrow>
      <h2 id="date-calendar-title" className="flex items-center gap-2 text-[18px] font-bold text-text-primary">
        <CalendarIcon className="h-5 w-5 flex-shrink-0 text-text-secondary" />
        Choose a date
      </h2>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          disabled={!canGoPrev}
          onClick={() => setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }))}
          aria-label="Previous month"
          className="rounded-full p-1.5 text-text-secondary transition-all duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-text-primary">{monthLabel}</p>
        <button
          type="button"
          disabled={!canGoNext}
          onClick={() => setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }))}
          aria-label="Next month"
          className="rounded-full p-1.5 text-text-secondary transition-all duration-150 ease-out hover:bg-hover-surface hover:text-sage-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text active:scale-95 disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center text-xs font-medium text-text-secondary">
        {WEEKDAY_SHORT.map((w, i) => (
          <div key={`${w}-${i}`}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-1" role="group" aria-label="Select a date">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} aria-hidden="true" />;
          const disabled = cell.dateKey < minDateKey || cell.dateKey > maxDateKey;
          const isSelected = cell.dateKey === selectedDate;
          const isToday = cell.dateKey === todayDateKey;
          return (
            <div key={cell.dateKey} className="flex justify-center py-0.5">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelectDate(cell.dateKey);
                  onClose();
                }}
                aria-pressed={isSelected}
                aria-current={isToday ? "date" : undefined}
                aria-label={fullDateLabel(cell.dateKey, now)}
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-text ${
                  disabled
                    ? "cursor-not-allowed text-text-secondary/30"
                    : isSelected
                      ? "bg-sage/15 font-semibold text-sage-text"
                      : isToday
                        ? "font-semibold text-sage-text hover:bg-hover-surface"
                        : "font-medium text-text-primary hover:bg-hover-surface hover:text-sage-text"
                }`}
              >
                {cell.day}
              </button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
