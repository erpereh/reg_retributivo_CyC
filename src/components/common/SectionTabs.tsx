"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/classNames";

export interface SectionTabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly tabId?: string;
  readonly panelId?: string;
}

interface SectionTabsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly items: readonly SectionTabItem<T>[];
  readonly onValueChange: (value: T) => void;
  readonly className?: string;
}

export function SectionTabs<T extends string>({ label, value, items, onValueChange, className }: SectionTabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectAt(index: number) {
    const item = items[index];
    if (!item) return;
    onValueChange(item.value);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectAt(0);
    if (event.key === "End") return selectAt(items.length - 1);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    selectAt((index + direction + items.length) % items.length);
  }

  return (
    <div className={cn("no-scrollbar max-w-full overflow-x-auto pb-1", className)}>
      <div data-layout="fit-content" role="tablist" aria-label={label} className="inline-flex w-max min-w-max items-center gap-1 rounded-2xl bg-white p-1 shadow-subtle ring-1 ring-line/80">
        {items.map((item, index) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="tab"
              aria-label={item.accessibleLabel}
              aria-selected={selected}
              aria-controls={item.panelId}
              id={item.tabId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "min-h-10 rounded-xl px-4 text-sm font-semibold transition-colors duration-150",
                selected ? "bg-white text-ink shadow-subtle" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
