"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils/classNames";

interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled = false }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {description ? <p className="mt-1 text-sm leading-5 text-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-200",
          checked ? "bg-primary" : "bg-slate-200",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="sr-only">{label}</span>
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 520, damping: 34 }}
          className={cn("block h-6 w-6 rounded-full bg-white shadow-sm", checked && "ml-6")}
        />
      </button>
    </div>
  );
}
