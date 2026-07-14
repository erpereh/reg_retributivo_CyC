"use client";

import { Database, Settings2 } from "lucide-react";
import { useState } from "react";
import { ContextUsageDetails } from "@/components/assistant/ContextUsageDetails";
import { PersonContextPicker } from "@/components/assistant/PersonContextPicker";
import { ModalShell } from "@/components/common/ModalShell";
import type { AssistantContextValue } from "@/components/assistant/AssistantProvider";

export function ContextSidebar({ assistant }: Readonly<{ assistant: AssistantContextValue }>) {
  const [personId, setPersonId] = useState<string>();
  const conversation = assistant.conversation;
  const readOnly = conversation?.status !== "active";
  const profiles = assistant.modelProfiles.filter((profile) => profile.enabled && (conversation?.type === "analysis" ? profile.analysisCompatible : profile.generalChatCompatible));
  return <aside aria-label="Contexto de la conversacion" className="flex h-full min-h-0 flex-col bg-white">
    <header className="border-b border-line px-4 py-3"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted"><Database aria-hidden="true" className="size-4" />Contexto</p><h2 className="mt-1 text-base font-bold text-ink">Alcance de la respuesta</h2></header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      {conversation ? <>
        <section className="space-y-3" aria-labelledby="assistant-preferences">
          <h3 id="assistant-preferences" className="flex items-center gap-2 text-sm font-bold text-ink"><Settings2 aria-hidden="true" className="size-4" />Configuracion</h3>
          <label className="block text-xs font-semibold text-muted">Modelo
            <select className="filter-control mt-1" disabled={readOnly || !profiles.length} aria-label="Modelo de conversacion" value={conversation.modelProfileId ?? ""} onChange={(event) => void assistant.updateConversationPreferences({ modelProfileId: event.target.value || undefined })}>
              <option value="">{profiles.length ? "Selecciona un modelo" : "No hay modelos configurados"}</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
          {!profiles.length ? <p className="text-xs font-semibold text-danger">No hay modelos configurados. Configuralos en Ajustes &gt; IA.</p> : null}
          <label className="block text-xs font-semibold text-muted">Modo de respuesta<select className="filter-control mt-1" disabled={readOnly} aria-label="Modo de respuesta" value={conversation.responseMode} onChange={(event) => void assistant.updateConversationPreferences({ responseMode: event.target.value as "strict" | "flexible" })}><option value="strict">Estricto</option><option value="flexible">Flexible</option></select></label>
          <label className="block text-xs font-semibold text-muted">Estrategia de contexto<select className="filter-control mt-1" disabled={readOnly} aria-label="Estrategia de contexto" value={conversation.contextStrategy} onChange={(event) => void assistant.updateConversationPreferences({ contextStrategy: event.target.value as "automatic" | "full" | "optimized" })}><option value="automatic">Automatica</option><option value="optimized">Optimizada</option><option value="full">Completa</option></select></label>
        </section>
        {conversation.type === "analysis" ? <section className="border-t border-line pt-4" aria-labelledby="people-context-title"><h3 id="people-context-title" className="mb-3 text-sm font-bold text-ink">Personas asociadas</h3><PersonContextPicker availableIds={assistant.availablePersonIds} associatedIds={conversation.associatedPersonIds} primaryId={conversation.primaryPersonId} disabled={readOnly} onAdd={(id) => void assistant.addPerson(id)} onRemove={(id) => void assistant.removePerson(id)} onPrimary={(id) => void assistant.setPrimaryPerson(id)} onOpen={setPersonId} /></section> : <p className="border-t border-line pt-4 text-sm text-muted">Convierte la conversacion al analisis activo para asociar personas.</p>}
        <ContextUsageDetails messages={assistant.messages} snapshots={assistant.snapshots} events={assistant.events} documents={assistant.documents} indexJobs={assistant.indexJobs} />
      </> : <p className="text-sm text-muted">Crea una conversacion para configurar su contexto.</p>}
    </div>
    {personId ? <PersonDialog person={assistant.people.find((person) => person.employeeNumber === personId)} onClose={() => setPersonId(undefined)} /> : null}
  </aside>;
}

function PersonDialog({ person, onClose }: Readonly<{ person?: { employeeNumber: string; person?: string; workplace?: string; position?: string; category?: string; status?: string; periods?: readonly string[] }; onClose(): void }>) {
  return <ModalShell title="Detalle persona" onClose={onClose}>{person ? <dl className="grid gap-4 sm:grid-cols-2"><Field label="Matricula" value={person.employeeNumber} /><Field label="Persona" value={person.person} /><Field label="Centro" value={person.workplace} /><Field label="Puesto" value={person.position} /><Field label="Categoria" value={person.category} /><Field label="Estado" value={person.status} /><Field label="Periodos" value={person.periods?.join(", ")} /></dl> : <p className="text-sm text-muted">La persona ya no esta disponible en el analisis activo.</p>}</ModalShell>;
}
function Field({ label, value }: Readonly<{ label: string; value?: string }>) { return <div><dt className="text-xs font-semibold text-muted">{label}</dt><dd className="mt-1 text-sm font-semibold text-ink">{value || "-"}</dd></div>; }
