import type { ChatAction } from "@/lib/assistant/domain";

export function ActionProposal({ action }: Readonly<{ action: ChatAction }>) {
  const statusLabel: Record<ChatAction["status"], string> = {
    pending: "pendiente", accepted: "aceptada", rejected: "rechazada", failed: "fallida",
  };
  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
      <p className="text-xs font-semibold text-blue-800">Acción propuesta</p>
      <p className="mt-1 text-sm text-slate-700">{action.description}</p>
      <p className="mt-2 text-sm font-bold text-primary">{action.label} · Estado: {statusLabel[action.status]}</p>
    </div>
  );
}
