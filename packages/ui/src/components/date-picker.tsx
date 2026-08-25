import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "../lib/utils";

type DatePickerProps = {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  max?: string;
  min?: string;
  onValueChange: (value: string) => void;
  required?: boolean;
  value: string;
};

const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"] as const;
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const displayFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const accessibleFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  weekday: "long",
  year: "numeric",
});

function parseIsoDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function isoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(date: Date, amount: number): Date {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + amount, 1);
  return new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    Math.min(date.getDate(), endOfMonth(targetMonth).getDate()),
  );
}

function sameDate(left: Date, right: Date): boolean {
  return isoDate(left) === isoDate(right);
}

function clampDate(date: Date, min: Date | null, max: Date | null): Date {
  if (min !== null && date < min) {
    return min;
  }
  if (max !== null && date > max) {
    return max;
  }
  return date;
}

function calendarDays(month: Date): Date[] {
  const first = startOfMonth(month);
  const gridStart = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function DatePicker({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  max,
  min,
  onValueChange,
  required = false,
  value,
}: DatePickerProps) {
  const selectedDate = parseIsoDate(value);
  const minDate = parseIsoDate(min);
  const maxDate = parseIsoDate(max);
  const now = new Date();
  const actualToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const today = clampDate(actualToday, minDate, maxDate);
  const initialDate = selectedDate ?? today;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(initialDate));
  const [activeDate, setActiveDate] = useState(initialDate);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const monthLabelId = useId();
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    if (open) {
      activeButtonRef.current?.focus();
    }
  }, [activeDate, open, visibleMonth]);

  const dateIsDisabled = (date: Date) =>
    (minDate !== null && date < minDate) ||
    (maxDate !== null && date > maxDate);

  const changeActiveDate = (nextDate: Date) => {
    const clamped = clampDate(nextDate, minDate, maxDate);
    setActiveDate(clamped);
    setVisibleMonth(startOfMonth(clamped));
  };

  const handleDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const movements: Partial<Record<string, number>> = {
      ArrowDown: 7,
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
    };
    const movement = movements[event.key];
    if (movement !== undefined) {
      event.preventDefault();
      changeActiveDate(addDays(activeDate, movement));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekOffset =
        event.key === "Home" ? -activeDate.getDay() : 6 - activeDate.getDay();
      changeActiveDate(addDays(activeDate, weekOffset));
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      changeActiveDate(addMonths(activeDate, event.key === "PageUp" ? -1 : 1));
    }
  };

  const selectDate = (date: Date) => {
    if (dateIsDisabled(date)) {
      return;
    }
    onValueChange(isoDate(date));
    setActiveDate(date);
    setVisibleMonth(startOfMonth(date));
    setOpen(false);
  };

  const moveMonth = (amount: number) => {
    const nextMonth = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + amount,
      1,
    );
    const candidate = clampDate(
      new Date(
        nextMonth.getFullYear(),
        nextMonth.getMonth(),
        Math.min(activeDate.getDate(), endOfMonth(nextMonth).getDate()),
      ),
      minDate,
      maxDate,
    );
    setVisibleMonth(startOfMonth(candidate));
    setActiveDate(candidate);
  };

  const previousMonthDisabled =
    minDate !== null && endOfMonth(addMonths(visibleMonth, -1)) < minDate;
  const nextMonthDisabled =
    maxDate !== null && startOfMonth(addMonths(visibleMonth, 1)) > maxDate;

  return (
    <PopoverPrimitive.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          const nextActiveDate = selectedDate ?? today;
          setActiveDate(nextActiveDate);
          setVisibleMonth(startOfMonth(nextActiveDate));
        }
      }}
      open={open}
    >
      <PopoverPrimitive.Trigger
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className={cn("date-picker__trigger", className)}
        disabled={disabled}
        type="button"
      >
        <span>
          {selectedDate === null
            ? "Choose date"
            : displayFormatter.format(selectedDate)}
        </span>
        <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
          <path d="M3.5 6.5h9M5 2.5v2M11 2.5v2M3 4h10v9H3z" />
        </svg>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          align="end"
          className="date-picker__positioner"
          sideOffset={8}
        >
          <PopoverPrimitive.Popup
            aria-label={`${ariaLabel} calendar`}
            className="date-picker__popup"
            initialFocus={activeButtonRef}
          >
            <div className="date-picker__header">
              <button
                aria-label="Previous month"
                className="date-picker__month-button"
                disabled={previousMonthDisabled}
                onClick={() => moveMonth(-1)}
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 12 12">
                  <path d="m7.5 2.5-3.5 3.5 3.5 3.5" />
                </svg>
              </button>
              <strong aria-live="polite" id={monthLabelId}>
                {monthFormatter.format(visibleMonth)}
              </strong>
              <button
                aria-label="Next month"
                className="date-picker__month-button"
                disabled={nextMonthDisabled}
                onClick={() => moveMonth(1)}
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 12 12">
                  <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                </svg>
              </button>
            </div>
            <div aria-hidden="true" className="date-picker__weekdays">
              {weekdayLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div
              aria-labelledby={monthLabelId}
              className="date-picker__grid"
              role="grid"
            >
              {Array.from({ length: 6 }, (_, weekIndex) => (
                <div className="date-picker__week" key={weekIndex} role="row">
                  {days.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                    const dateValue = isoDate(date);
                    const isActive = sameDate(date, activeDate);
                    const isSelected =
                      selectedDate !== null && sameDate(date, selectedDate);
                    const isOutsideMonth =
                      date.getMonth() !== visibleMonth.getMonth();
                    return (
                      <div
                        aria-selected={isSelected}
                        className="date-picker__cell"
                        key={dateValue}
                        role="gridcell"
                      >
                        <button
                          aria-current={
                            sameDate(date, actualToday) ? "date" : undefined
                          }
                          aria-label={accessibleFormatter.format(date)}
                          className={cn(
                            "date-picker__day",
                            isOutsideMonth && "date-picker__day--outside",
                          )}
                          disabled={dateIsDisabled(date)}
                          onClick={() => selectDate(date)}
                          onKeyDown={handleDayKeyDown}
                          ref={isActive ? activeButtonRef : undefined}
                          tabIndex={isActive ? 0 : -1}
                          type="button"
                        >
                          {date.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
