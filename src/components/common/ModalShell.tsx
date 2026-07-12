"use client";

import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/classNames";

let bodyLockCount = 0;
let previousBodyOverflow = "";

interface ModalShellProps {
  readonly title: string;
  readonly eyebrow?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly onClose: () => void;
  readonly maxWidth?: "xl" | "2xl" | "3xl" | "4xl" | "5xl";
  readonly className?: string;
}

const WIDTH_CLASS: Record<NonNullable<ModalShellProps["maxWidth"]>, string> = {
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-5xl",
};

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function ModalShell({ title, eyebrow = "Detalle determinista", children, footer, onClose, maxWidth = "5xl", className }: ModalShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (bodyLockCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    bodyLockCount += 1;
    const frame = window.requestAnimationFrame(() => focusableElements(dialogRef.current ?? document.body)[0]?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      bodyLockCount = Math.max(0, bodyLockCount - 1);
      if (bodyLockCount === 0) document.body.style.overflow = previousBodyOverflow;
      openerRef.current?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const elements = focusableElements(dialogRef.current);
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleScrim(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-2 sm:p-4" onMouseDown={handleScrim}>
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.99, y: 6 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onKeyDown={handleKeyDown}
        data-slot="modal-shell"
        className={cn("grid max-h-[94dvh] w-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[20px] border border-line bg-white shadow-lift", WIDTH_CLASS[maxWidth], className)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink sm:text-2xl">{title}</h2>
          </div>
          <button type="button" aria-label={`Cerrar ${title}`} title="Cerrar" onClick={onClose} className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-white text-muted transition-colors hover:bg-slate-100 hover:text-ink">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? <footer className="border-t border-line bg-white px-5 py-4 sm:px-6">{footer}</footer> : <div />}
      </motion.div>
    </div>
  );
}
