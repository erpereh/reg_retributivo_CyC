"use client";

import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import { AppStateProvider, useAppState } from "@/components/app/AppState";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { AssistantView } from "@/components/assistant/AssistantView";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { CuadreExcelView } from "@/components/cuadre-excel/CuadreExcelView";
import { HistoryView } from "@/components/history/HistoryView";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsView } from "@/components/settings/SettingsView";
import { TablesView } from "@/components/tables/TablesView";

const AssistantE2EAppScope = dynamic(
  () => import("@/components/assistant/AssistantE2EAppScope").then((module) => module.AssistantE2EAppScope),
  { ssr: false },
);

function ActiveView() {
  const { view } = useAppState();

  switch (view) {
    case "personas":
    case "conceptos":
    case "agrupaciones":
      return <TablesView mode={view} />;
    case "cuadre-excel":
      return <CuadreExcelView />;
    case "historial":
      return <HistoryView />;
    case "asistente":
      return <AssistantView />;
    case "ajustes":
      return <SettingsView />;
    case "dashboard":
    default:
      return <DashboardView />;
  }
}

export function DashboardApp({ assistantE2EMode = false }: Readonly<{ assistantE2EMode?: boolean }>) {
  return (
    <MotionConfig reducedMotion="user">
      <AppStateProvider>
        {assistantE2EMode ? <AssistantE2EAppScope><AppShell><ActiveView /></AppShell></AssistantE2EAppScope> : <AssistantAppScope />}
      </AppStateProvider>
    </MotionConfig>
  );
}

function AssistantAppScope() {
  const { activeAnalysis, navigateAssistantIntent } = useAppState();
  return <AssistantProvider activeAnalysis={activeAnalysis} onNavigate={navigateAssistantIntent}><AppShell><ActiveView /></AppShell></AssistantProvider>;
}
