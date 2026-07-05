"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import { ToastViewport } from "@/components/common/ToastViewport";
import { TopNav } from "@/components/layout/TopNav";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { hydrating, view, toasts, dismissToast } = useAppState();

  return (
    <div className="min-h-dvh bg-app-bg text-ink">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8">
        <TopNav />
        <main className="py-6" tabIndex={-1}>
          {hydrating ? (
            <DashboardSkeleton />
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.24, ease: "easeOut" }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          )}
        </main>
      </div>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
