"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import { TopNav } from "@/components/layout/TopNav";

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { error, success, hydrating, view } = useAppState();

  return (
    <div className="min-h-dvh bg-app-bg text-ink">
      <div className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8">
        <TopNav />
        <div className="mt-6 space-y-4" aria-live="polite">
          {error ? (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[24px] border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-800 shadow-subtle"
            >
              {error}
            </motion.div>
          ) : null}
          {success ? (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800 shadow-subtle"
            >
              {success}
            </motion.div>
          ) : null}
        </div>
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
    </div>
  );
}
