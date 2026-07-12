"use client";

import { useEffect, useState } from "react";
import { useAssistant } from "@/components/assistant/AssistantProvider";

export function AssistantView() {
  const assistant = useAssistant();
  const [composer, setComposer] = useState("");
  useEffect(() => () => setComposer(""), []);

  if (!assistant.ready) return <p role="status">Cargando Asistente…</p>;
  if (!assistant.conversation) {
    return <button type="button" onClick={() => void assistant.createGeneralConversation()}>Crear conversación general</button>;
  }

  const associated = assistant.conversation.primaryPersonId;
  return (
    <section aria-labelledby="assistant-title" className="space-y-4 rounded-2xl bg-white p-5 shadow-subtle ring-1 ring-line/80">
      <header>
        <h1 id="assistant-title" className="text-xl font-bold">Asistente</h1>
        <p>{assistant.conversation.title}</p>
      </header>
      <div aria-live="polite" className="space-y-2">
        {assistant.messages.map((message) => <p key={message.id}>{message.content}</p>)}
        {assistant.sources.map((source) => <p key={source.id}>{source.sanitizedSourceLabel}</p>)}
        {assistant.notice ? <p>{assistant.notice}</p> : null}
        {assistant.error ? <p role="alert">{assistant.error}</p> : null}
        {associated ? <p>Matrícula asociada: {associated}</p> : null}
      </div>
      {assistant.conversation.type === "general" ? (
        <button type="button" onClick={() => void assistant.convertToActiveAnalysis()}>Convertir al análisis activo</button>
      ) : (
        <div className="flex flex-wrap gap-2">
          {!associated ? assistant.availablePersonIds.map((personId) => (
            <button key={personId} type="button" onClick={() => void assistant.associatePerson(personId)}>Asociar matrícula {personId}</button>
          )) : null}
          {associated ? <button type="button" disabled={assistant.streaming} onClick={() => void assistant.requestPersonProfile()}>Consultar perfil</button> : null}
        </div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); const raw = composer; setComposer(""); void assistant.send(raw); }} className="space-y-2">
        <label htmlFor="assistant-composer">Pregunta</label>
        <textarea id="assistant-composer" value={composer} onChange={(event) => setComposer(event.target.value)} disabled={assistant.streaming} />
        <button type="submit" disabled={assistant.streaming || !composer.trim()}>Enviar</button>
      </form>
    </section>
  );
}
