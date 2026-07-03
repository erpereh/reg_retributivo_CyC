"use client";

import { MotionConfig } from "motion/react";
import { AppStateProvider, useAppState } from "@/components/app/AppState";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { HistoryView } from "@/components/history/HistoryView";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsView } from "@/components/settings/SettingsView";
import { TablesView } from "@/components/tables/TablesView";

function ActiveView() {
  const { view } = useAppState();

  switch (view) {
    case "tablas":
      return <TablesView />;
    case "historial":
      return <HistoryView />;
    case "ajustes":
      return <SettingsView />;
    case "dashboard":
    default:
      return <DashboardView />;
  }
}

export function DashboardApp() {
  return (
    <MotionConfig reducedMotion="user">
      <AppStateProvider>
        <AppShell>
          <ActiveView />
        </AppShell>
      </AppStateProvider>
    </MotionConfig>
  );
}
