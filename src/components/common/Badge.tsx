"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Info, XCircle } from "lucide-react";
import { motion } from "motion/react";
import { displayText } from "@/lib/ui/displayText";
import { cn } from "@/lib/utils/classNames";

interface BadgeProps {
  readonly value?: string;
  readonly className?: string;
}

export function Badge({ value, className }: BadgeProps) {
  const text = displayText(value) || "Sin dato";
  const lower = text.toLowerCase();
  const danger = lower.includes("alta") || lower.includes("incidencia") || lower.includes("falta");
  const warning = lower.includes("media") || lower.includes("revisar");
  const success = lower.includes("ok") || lower.includes("configurada") || lower.includes("activa");
  const Icon = danger ? XCircle : warning ? AlertTriangle : success ? CheckCircle2 : lower.includes("sin") ? CircleDashed : Info;

  return (
    <motion.span
      layout
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        danger && "bg-danger-bg text-danger",
        warning && "bg-warning-bg text-warning",
        success && "bg-success-bg text-success",
        !danger && !warning && !success && "bg-info-bg text-info",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </motion.span>
  );
}
