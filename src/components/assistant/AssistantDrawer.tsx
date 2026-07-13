"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export function AssistantDrawer({ open, title, side, onClose, children }: Readonly<{
  open: boolean;
  title: string;
  side: "left" | "right";
  onClose(): void;
  children: ReactNode;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    setEntered(false);
    const frame = requestAnimationFrame(() => { setEntered(true); focusables()[0]?.focus(); });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="absolute inset-0 min-h-11 min-w-11 cursor-default bg-slate-950/35" aria-label={`Descartar ${title.toLowerCase()}`} onClick={onClose} />
      <div ref={panelRef} data-testid="assistant-drawer-panel" className={`absolute inset-y-0 ${side === "left" ? "left-0" : "right-0"} flex w-[min(90vw,24rem)] flex-col bg-white shadow-lift transition-transform duration-180 motion-reduce:transition-none ${entered ? "translate-x-0" : side === "left" ? "-translate-x-full" : "translate-x-full"}`}>
        <header className="flex min-h-16 items-center gap-3 border-b border-line px-4">
          <h2 id={titleId} className="flex-1 text-base font-bold text-ink">{title}</h2>
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-muted hover:bg-slate-100 hover:text-ink" aria-label={`Cerrar ${title.toLowerCase()}`} onClick={onClose}><X aria-hidden="true" className="size-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
