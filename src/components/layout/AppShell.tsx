"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import { ToastViewport } from "@/components/common/ToastViewport";
import { TopNav } from "@/components/layout/TopNav";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { hydrating, view, toasts, dismissToast } = useAppState();
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (previousView.current !== view) {
      const activeElement = document.activeElement;
      const preservePrimaryTabFocus = activeElement instanceof HTMLElement
        && activeElement.getAttribute("role") === "tab"
        && activeElement.closest('header [role="tablist"]');
      if (!preservePrimaryTabFocus) {
        mainRef.current?.focus({ preventScroll: true });
      }
      const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      previousView.current = view;
      return () => window.cancelAnimationFrame(frame);
    }
    previousView.current = view;
  }, [view]);

  return (
    <div data-slot="app-shell" data-surface="canvas" className="flex min-h-dvh flex-col bg-app-bg text-ink">
      <div data-slot="app-content" data-surface="transparent" className="mx-auto flex min-h-dvh w-full max-w-[1560px] flex-1 flex-col">
        <TopNav />
        <main ref={mainRef} className={`scroll-mt-24 px-3 pb-8 pt-4 outline-none sm:px-5 sm:pb-10 sm:pt-5 lg:px-7 xl:px-8 ${view === "asistente" ? "flex min-h-0 flex-1 flex-col overflow-hidden pb-3" : ""}`} tabIndex={-1}>
          {hydrating ? (
            <DashboardSkeleton />
          ) : (
            <motion.div
              key={view}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
              className={view === "asistente" ? "flex min-h-0 flex-1 flex-col" : undefined}
            >
              {children}
            </motion.div>
          )}
        </main>
      </div>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
