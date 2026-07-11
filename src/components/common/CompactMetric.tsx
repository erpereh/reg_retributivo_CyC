import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/classNames";

type MetricTone = "blue" | "green" | "orange" | "red" | "gray" | "violet";

const TONE_CLASS: Record<MetricTone, string> = {
  blue: "bg-blue-50 text-primary",
  green: "bg-emerald-50 text-success",
  orange: "bg-orange-50 text-warning",
  red: "bg-red-50 text-danger",
  gray: "bg-slate-100 text-muted",
  violet: "bg-violet-50 text-violet-700",
};

export function CompactMetric({ label, value, detail, icon: Icon, tone = "blue" }: Readonly<{ label: string; value: string | number; detail?: string; icon?: LucideIcon; tone?: MetricTone }>) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-line/80 bg-white px-4 py-3">
      {Icon ? <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[tone])}><Icon aria-hidden="true" /></span> : null}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-muted">{label}</p>
        <p className="mt-1 break-words text-lg font-semibold text-ink tabular-nums">{value}</p>
        {detail ? <p className="mt-1 text-xs leading-5 text-muted">{detail}</p> : null}
      </div>
    </div>
  );
}
