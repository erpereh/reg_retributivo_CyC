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
      mainRef.current?.focus({ preventScroll: true });
      const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      previousView.current = view;
      return () => window.cancelAnimationFrame(frame);
    }
    previousView.current = view;
  }, [view]);

  return (
    <div className="min-h-dvh bg-app-bg text-ink sm:p-3 lg:p-5">
      <div className="mx-auto min-h-dvh w-full max-w-[1560px] overflow-clip border-line/80 bg-panel shadow-nav sm:min-h-[calc(100dvh-1.5rem)] sm:rounded-[20px] sm:border lg:min-h-[calc(100dvh-2.5rem)] lg:rounded-[28px]">
        <TopNav />
        <main ref={mainRef} className="scroll-mt-24 px-3 py-5 outline-none sm:px-5 sm:py-6 lg:px-7 xl:px-8" tabIndex={-1}>
          {hydrating ? (
            <DashboardSkeleton />
          ) : (
            <motion.div
              key={view}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16, ease: "easeOut" }}
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
