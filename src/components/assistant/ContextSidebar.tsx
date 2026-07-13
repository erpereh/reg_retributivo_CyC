"use client";

import { Database, Settings2 } from "lucide-react";
import { ContextUsageDetails } from "@/components/assistant/ContextUsageDetails";
import { PersonContextPicker } from "@/components/assistant/PersonContextPicker";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";

export function ContextSidebar({ assistant }: Readonly<{ assistant: AssistantContextValue }>) {
  const conversation = assistant.conversation;
  const readOnly = conversation?.status !== "active";
  return (
    <aside aria-label="Contexto de la conversación" className="flex h-full min-h-0 flex-col bg-white">
      <header className="border-b border-line px-4 py-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted"><Database aria-hidden="true" className="size-4" />Contexto</p>
        <h2 className="mt-1 text-base font-bold text-ink">Alcance de la respuesta</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {conversation ? (
          <>
            <section className="space-y-3" aria-labelledby="assistant-preferences">
              <h3 id="assistant-preferences" className="flex items-center gap-2 text-sm font-bold text-ink"><Settings2 aria-hidden="true" className="size-4" />Configuración</h3>
              <label className="block text-xs font-semibold text-muted">Modelo
                <select className="filter-control mt-1" disabled={readOnly} aria-label="Modelo de conversación" value={conversation.modelProfileId} onChange={(event) => void assistant.updateConversationPreferences({ modelProfileId: event.target.value })}>
                  <option value="fake-retributivo-v1">Retributivo local</option>
                  {assistant.modelProfiles.filter((profile) => profile.enabled && (conversation.type === "analysis" ? profile.analysisCompatible : profile.generalChatCompatible)).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-muted">Modo de respuesta
                <select className="filter-control mt-1" disabled={readOnly} aria-label="Modo de respuesta" value={conversation.responseMode} onChange={(event) => void assistant.updateConversationPreferences({ responseMode: event.target.value as "strict" | "flexible" })}>
                  <option value="strict">Estricto</option><option value="flexible">Flexible</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-muted">Estrategia de contexto
                <select className="filter-control mt-1" disabled={readOnly} aria-label="Estrategia de contexto" value={conversation.contextStrategy} onChange={(event) => void assistant.updateConversationPreferences({ contextStrategy: event.target.value as "automatic" | "full" | "optimized" })}>
                  <option value="automatic">Automática</option><option value="optimized">Optimizada</option><option value="full">Completa</option>
                </select>
              </label>
            </section>
            {conversation.type === "analysis" ? (
              <section className="border-t border-line pt-4" aria-labelledby="people-context-title">
                <h3 id="people-context-title" className="mb-3 text-sm font-bold text-ink">Personas asociadas</h3>
                <PersonContextPicker
                  availableIds={assistant.availablePersonIds}
                  associatedIds={conversation.associatedPersonIds}
                  primaryId={conversation.primaryPersonId}
                  disabled={readOnly}
                  onAdd={(id) => void assistant.addPerson(id)}
                  onRemove={(id) => void assistant.removePerson(id)}
                  onPrimary={(id) => void assistant.setPrimaryPerson(id)}
                />
                {conversation.primaryPersonId ? <button type="button" className="btn-secondary mt-3 w-full" disabled={readOnly || assistant.streaming} onClick={() => void assistant.requestPersonProfile()}>Consultar perfil</button> : null}
              </section>
            ) : null}
            <ContextUsageDetails messages={assistant.messages} snapshots={assistant.snapshots} events={assistant.events} documents={assistant.documents} indexJobs={assistant.indexJobs} />
          </>
        ) : <p className="text-sm text-muted">Crea una conversación para configurar su contexto.</p>}
      </div>
    </aside>
  );
}
