"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle, type LucideIcon } from "lucide-react";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";

export type StatusBadgeTone = "danger" | "warning" | "success" | "info" | "neutral";

export interface StatusBadgeProps {
  readonly value?: string;
  readonly tone?: StatusBadgeTone;
  readonly icon?: LucideIcon;
  readonly className?: string;
}

function derivedTone(text: string): StatusBadgeTone {
  const lower = text.toLowerCase();
  if (lower.includes("alta") || lower.includes("incidencia") || lower.includes("falta")) return "danger";
  if (lower.includes("media") || lower.includes("revisar")) return "warning";
  if (lower.includes("ok") || lower.includes("configurada") || lower.includes("activa")) return "success";
  if (lower.includes("sin")) return "neutral";
  return "info";
}

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  danger: "bg-danger-bg text-danger",
  warning: "bg-warning-bg text-warning",
  success: "bg-success-bg text-success",
  info: "bg-info-bg text-info",
  neutral: "bg-slate-100 text-slate-600",
};

const TONE_ICON: Record<StatusBadgeTone, LucideIcon> = {
  danger: XCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
  neutral: CircleDashed,
};

export function StatusBadge({ value, tone, icon, className }: StatusBadgeProps) {
  const rawText = displayText(value);
  const text = rawText === "Sin Registro" ? "Recibo sin Reg. Retrib." : rawText === "Sin PDF" ? "Reg. Retrib. sin Recibo" : rawText || "Sin dato";
  const resolvedTone = tone ?? derivedTone(text);
  const Icon = icon ?? TONE_ICON[resolvedTone];

  return (
    <span className={cn("inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold", TONE_CLASS[resolvedTone], className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </span>
  );
}
