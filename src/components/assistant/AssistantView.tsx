"use client";

import { AssistantShell } from "@/components/assistant/AssistantShell";
import { useAssistant } from "@/components/assistant/AssistantProvider";

export function AssistantView() {
  const assistant = useAssistant();
  if (!assistant.ready) return assistant.error
    ? <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm font-semibold text-danger shadow-subtle">{assistant.error}</p>
    : <p role="status" className="rounded-2xl bg-white p-6 text-sm font-medium text-muted shadow-subtle">Cargando Asistente…</p>;
  return <AssistantShell assistant={assistant} />;
}
