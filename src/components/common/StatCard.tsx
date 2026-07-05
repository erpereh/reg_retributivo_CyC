"use client";

import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { Card } from "@/components/common/Card";
import { cn } from "@/lib/utils/classNames";

interface StatCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
  readonly tooltip?: string;
  readonly badge?: string;
  readonly icon: LucideIcon;
  readonly highlight?: boolean;
  readonly accent?: "blue" | "green" | "orange" | "red" | "gray" | "violet";
  readonly index?: number;
}

const ACCENT_CLASS: Record<NonNullable<StatCardProps["accent"]>, string> = {
  blue: "bg-blue-50 text-primary",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-700",
};

export function StatCard({ label, value, detail, tooltip, badge, icon: Icon, highlight = false, accent = "blue", index = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.04, 0.22), ease: "easeOut" }}
      className="group relative"
    >
      <Card interactive tone={highlight ? "blue" : "default"} className="min-h-[150px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-sm font-medium", highlight ? "text-blue-50" : "text-muted")}>{label}</p>
            <p className={cn("mt-4 break-words text-3xl font-semibold leading-none", highlight ? "text-white" : "text-ink")}>
              {value}
            </p>
          </div>
          <span
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
              highlight ? "bg-white text-primary" : ACCENT_CLASS[accent],
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
        {badge ? (
          <span className={cn("mt-4 inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold", highlight ? "bg-white/20 text-white" : ACCENT_CLASS[accent])}>
            {badge}
          </span>
        ) : null}
        {detail ? <p className={cn("mt-5 text-sm", highlight ? "text-blue-50" : "text-muted")}>{detail}</p> : null}
      </Card>
      {tooltip ? (
        <div className="pointer-events-none absolute left-4 right-4 top-[calc(100%-0.75rem)] z-20 origin-top rounded-2xl border border-line bg-white p-4 text-sm leading-6 text-slate-700 opacity-0 shadow-lift transition duration-150 group-hover:translate-y-2 group-hover:opacity-100 group-focus-within:translate-y-2 group-focus-within:opacity-100">
          {tooltip}
        </div>
      ) : null}
    </motion.div>
  );
}
