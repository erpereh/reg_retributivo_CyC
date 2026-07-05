"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { cn } from "@/lib/utils/classNames";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastItem {
  readonly id: string;
  readonly kind: ToastKind;
  readonly title: string;
  readonly message?: string;
}

interface ToastViewportProps {
  readonly toasts: readonly ToastItem[];
  readonly onDismiss: (id: string) => void;
  readonly autoDismissMs?: number;
}

const TOAST_STYLE: Record<ToastKind, string> = {
  success: "border-emerald-200 bg-white text-emerald-900",
  error: "border-red-200 bg-white text-red-900",
  warning: "border-orange-200 bg-white text-orange-950",
  info: "border-blue-200 bg-white text-blue-950",
};

const ICON_STYLE: Record<ToastKind, string> = {
  success: "bg-emerald-50 text-emerald-700",
  error: "bg-red-50 text-red-700",
  warning: "bg-orange-50 text-orange-700",
  info: "bg-blue-50 text-blue-700",
};

function ToastIcon({ kind }: Readonly<{ kind: ToastKind }>) {
  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? XCircle : kind === "warning" ? AlertTriangle : Info;
  return (
    <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", ICON_STYLE[kind])}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

export function ToastViewport({ toasts, onDismiss, autoDismissMs = 4500 }: ToastViewportProps) {
  useEffect(() => {
    if (!toasts.length) {
      return undefined;
    }

    const timers = toasts.map((toast) => window.setTimeout(() => onDismiss(toast.id), autoDismissMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [autoDismissMs, onDismiss, toasts]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            role={toast.kind === "error" ? "alert" : "status"}
            aria-label={toast.title}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn("flex items-start gap-3 rounded-2xl border p-4 shadow-lift backdrop-blur", TOAST_STYLE[toast.kind])}
          >
            <ToastIcon kind={toast.kind} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.message ? <p className="mt-1 text-sm leading-5 text-slate-600">{toast.message}</p> : null}
            </div>
            <button
              type="button"
              aria-label={`Cerrar ${toast.title}`}
              onClick={() => onDismiss(toast.id)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
