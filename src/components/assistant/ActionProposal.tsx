import type { ChatAction } from "@/lib/assistant/domain";

function LocalActionResult({ label, output }: Readonly<{ label: string; output: unknown }>) {
  const rows = Array.isArray(output) ? output : output && typeof output === "object" && "people" in output && Array.isArray(output.people) ? output.people : undefined;
  if (!rows) return output ? <p className="mt-3 text-xs text-slate-600">Resultado generado localmente.</p> : null;
  return (
    <div className="mt-3 overflow-x-auto">
      <table aria-label={`Resultado de ${label}`} className="w-full text-left text-xs">
        <thead><tr className="border-b border-blue-200"><th className="p-2">Matrícula</th><th className="p-2">Estado</th><th className="p-2">Diferencia</th><th className="p-2">Periodos</th></tr></thead>
        <tbody>{rows.map((raw, index) => {
          const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
          const totals = row.totals && typeof row.totals === "object" ? row.totals as Record<string, unknown> : {};
          return <tr key={String(row.personId ?? index)} className="border-b border-blue-100"><td className="p-2">{String(row.personId ?? "—")}</td><td className="p-2">{String(row.status ?? "—")}</td><td className="p-2">{String(totals.difference ?? "—")}</td><td className="p-2">{Array.isArray(row.periods) ? row.periods.join(", ") : "—"}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export function ActionProposal({ action, output, disabled = false, onAccept = () => undefined, onReject = () => undefined }: Readonly<{
  action: ChatAction;
  output?: unknown;
  disabled?: boolean;
  onAccept?(actionId: string): void;
  onReject?(actionId: string): void;
}>) {
  const statusLabel: Record<ChatAction["status"], string> = { pending: "pendiente", accepted: "aceptada", rejected: "rechazada", failed: "fallida" };
  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/70 p-3">
      <p className="text-xs font-semibold text-blue-800">Acción propuesta</p>
      <p className="mt-1 text-sm text-slate-700">{action.description}</p>
      <p className="mt-2 text-sm font-bold text-primary">{action.label} · Estado: {statusLabel[action.status]}</p>
      {action.status === "pending" ? <div className="mt-3 flex gap-2"><button type="button" className="btn-primary" disabled={disabled} aria-label={`Aceptar ${action.label}`} onClick={() => onAccept(action.id)}>Aceptar</button><button type="button" className="btn-secondary" disabled={disabled} aria-label={`Rechazar ${action.label}`} onClick={() => onReject(action.id)}>Rechazar</button></div> : null}
      <LocalActionResult label={action.label} output={output} />
    </div>
  );
}
