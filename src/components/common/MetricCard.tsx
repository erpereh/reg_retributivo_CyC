"use client";

import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/common/Card";
import { cn } from "@/lib/utils/classNames";

export interface MetricCardProps {
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

const ACCENT_CLASS: Record<NonNullable<MetricCardProps["accent"]>, string> = {
  blue: "bg-blue-50 text-primary",
  green: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-700",
  red: "bg-red-50 text-red-700",
  gray: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-700",
};

export function MetricCard({ label, value, detail, tooltip, badge, icon: Icon, highlight = false, accent = "blue" }: MetricCardProps) {
  return (
    <div className="h-full" title={tooltip}>
      <Card tone={highlight ? "blue" : "default"} className="h-full min-h-[132px] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-muted">{label}</p>
            <p className="mt-3 break-words font-mono text-2xl font-semibold leading-none text-ink tabular-nums sm:text-3xl">{value}</p>
          </div>
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", ACCENT_CLASS[accent])}>
            <Icon aria-hidden="true" />
          </span>
        </div>
        {badge ? <span className={cn("mt-4 inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold", ACCENT_CLASS[accent])}>{badge}</span> : null}
        {detail ? <p className="mt-4 text-sm leading-5 text-muted">{detail}</p> : null}
      </Card>
    </div>
  );
}
