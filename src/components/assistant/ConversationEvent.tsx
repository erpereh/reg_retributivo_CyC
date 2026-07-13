import type { ChatEvent } from "@/lib/assistant/domain";

function eventText(event: ChatEvent["event"]): string {
  switch (event.type) {
    case "context_added": return `Contexto añadido: ${event.label}`;
    case "context_removed": return `Contexto retirado: ${event.label}`;
    case "person_added": return `Matrícula ${event.personId} asociada`;
    case "person_removed": return `Matrícula ${event.personId} retirada`;
    case "model_changed": return "Modelo actualizado";
    case "context_compacted": return "Contexto resumido para continuar";
    case "analysis_updated": return "Análisis actualizado";
    case "indexing_completed": return "Indexación completada";
    case "automatic_fallback": return "Modelo alternativo activado";
    case "action_accepted": return "Acción aceptada";
    case "action_rejected": return "Acción rechazada";
    case "action_failed": return "La acción no se pudo completar";
  }
}

export function ConversationEvent({ event }: Readonly<{ event: ChatEvent }>) {
  return <li className="mx-auto my-3 w-fit rounded-full bg-slate-100 px-3 py-1.5 text-center text-xs font-medium text-muted">{eventText(event.event)}</li>;
}
