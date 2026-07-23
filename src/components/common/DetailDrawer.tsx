"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";

export function DetailDrawer({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: Readonly<{
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}>) {
  const reduceMotion = useReducedMotion();
  const previousFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => closeButton.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      requestAnimationFrame(() => previousFocus.current?.focus());
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="detail-drawer-layer" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" className="detail-drawer-backdrop" onClick={onClose} aria-label="Cerrar detalle" />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-drawer-title"
            className="detail-drawer"
            initial={reduceMotion ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: reduceMotion ? 0 : .24, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="detail-drawer__header">
              <div><h2 id="detail-drawer-title">{title}</h2>{description ? <p>{description}</p> : null}</div>
              <button ref={closeButton} type="button" className="app-icon-button" onClick={onClose} aria-label="Cerrar"><X className="size-4" /></button>
            </header>
            <div className="detail-drawer__content">{children}</div>
            {footer ? <footer className="detail-drawer__footer">{footer}</footer> : null}
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
