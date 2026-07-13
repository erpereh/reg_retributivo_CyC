"use client";

import { Check, Users } from "lucide-react";
import { useState } from "react";

export function PersonContextPicker({ availableIds, associatedIds, primaryId, disabled = false, onAdd, onRemove, onPrimary }: Readonly<{
  availableIds: readonly string[];
  associatedIds: readonly string[];
  primaryId?: string;
  disabled?: boolean;
  onAdd(id: string): void;
  onRemove(id: string): void;
  onPrimary(id: string): void;
}>) {
  const [open, setOpen] = useState(false);
  const unique = [...new Set(associatedIds)];
  const visible = unique.slice(0, 3);
  if (!associatedIds.length) {
    return (
      <div className="space-y-2">
        {availableIds.map((id) => <button key={id} type="button" disabled={disabled} className="btn-secondary w-full justify-start" onClick={() => onAdd(id)}>Asociar matrícula {id}</button>)}
      </div>
    );
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Personas asociadas resumidas">
        {visible.map((id) => <span key={id} className={`rounded-full px-2.5 py-1 text-xs font-bold ${id === primaryId ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"}`}>{id}</span>)}
        {unique.length > visible.length ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">+ {unique.length - visible.length}</span> : null}
      </div>
      {primaryId ? <p className="text-xs font-medium text-muted">Matrícula asociada: {primaryId} · Principal: matrícula {primaryId}</p> : null}
      <button type="button" className="btn-secondary w-full" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Users aria-hidden="true" className="size-4" />Gestionar personas asociadas</button>
      {open ? (
        <fieldset className="space-y-2 rounded-xl bg-slate-50 p-3" aria-label="Personas asociadas">
          <legend className="sr-only">Personas asociadas</legend>
          {availableIds.map((id) => {
            const checked = unique.includes(id);
            return (
              <div key={id} className="flex min-h-11 items-center gap-2">
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" className="size-5" disabled={disabled} checked={checked} onChange={() => checked ? onRemove(id) : onAdd(id)} />Matrícula {id}
                </label>
                <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-primary hover:bg-blue-100 disabled:text-muted" disabled={disabled || id === primaryId} aria-label={`Marcar matrícula ${id} como principal`} onClick={() => onPrimary(id)}><Check aria-hidden="true" className="size-4" /></button>
              </div>
            );
          })}
        </fieldset>
      ) : null}
    </section>
  );
}
