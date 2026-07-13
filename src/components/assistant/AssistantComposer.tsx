"use client";

import { Send, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

export function AssistantComposer({ streaming, disabled = false, onSend, onStop }: Readonly<{
  streaming: boolean;
  disabled?: boolean;
  onSend(value: string): Promise<void>;
  onStop(): void;
}>) {
  const [value, setValue] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const raw = value;
    if (!raw.trim() || streaming || disabled) return;
    setValue("");
    await onSend(raw);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="border-t border-line bg-white/95 p-3 backdrop-blur sm:p-4">
      <label htmlFor="assistant-composer" className="sr-only">Pregunta</label>
      <div className="flex items-end gap-2 rounded-2xl bg-slate-50 p-2 ring-1 ring-line focus-within:ring-2 focus-within:ring-primary/40">
        <textarea
          id="assistant-composer"
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-y bg-transparent px-2 py-2.5 text-sm leading-6 outline-none placeholder:text-muted"
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pregunta sobre el análisis retributivo"
          disabled={streaming || disabled}
        />
        {streaming ? (
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-ink text-white" aria-label="Detener respuesta" onClick={onStop}><Square aria-hidden="true" className="size-4 fill-current" /></button>
        ) : (
          <button type="submit" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-primary text-white shadow-blue hover:bg-primary-dark disabled:opacity-40" aria-label="Enviar" disabled={disabled || !value.trim()}><Send aria-hidden="true" className="size-4" /></button>
        )}
      </div>
      <p className="mt-2 px-1 text-xs text-muted">Enter para enviar · Shift+Enter para nueva línea</p>
    </form>
  );
}
