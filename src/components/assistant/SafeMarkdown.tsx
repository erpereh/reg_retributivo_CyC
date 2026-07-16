"use client";

import { useEffect, useState, type ComponentType } from "react";

type MarkdownComponent = ComponentType<{ content: string }>;
let cachedRenderer: MarkdownComponent | undefined;
let rendererPromise: Promise<MarkdownComponent> | undefined;

function loadRenderer(): Promise<MarkdownComponent> {
  rendererPromise ??= import("@/components/assistant/MarkdownRenderer").then((module) => {
    cachedRenderer = module.MarkdownRenderer;
    return module.MarkdownRenderer;
  });
  return rendererPromise;
}

if (typeof window !== "undefined") void loadRenderer().catch(() => undefined);

export function SafeMarkdown({ content, loader, onCitation }: Readonly<{ content: string; loader?: () => Promise<MarkdownComponent>; onCitation?: (index: number) => void }>) {
  const [Renderer, setRenderer] = useState<MarkdownComponent>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!loader && cachedRenderer) { setRenderer(() => cachedRenderer); return; }
    let active = true;
    void (loader ? loader() : loadRenderer()).then((renderer) => {
      if (active) setRenderer(() => renderer);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [loader]);
  const isPlainText = !/(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>|```)|\[[^\]]+\]\([^)]+\)|[*_~`]/m.test(content);
  if (onCitation && /\[\d+\]/u.test(content)) {
    const parts = content.split(/(\[\d+\])/gu);
    return <p className="whitespace-pre-wrap text-[0.9375rem] leading-7 text-slate-700">{parts.map((part, index) => { const match = /^\[(\d+)\]$/u.exec(part); return match ? <button key={`${part}-${index}`} type="button" className="mx-0.5 align-super text-xs font-bold text-primary hover:underline" aria-label={`Abrir fuente ${match[1]}`} onClick={() => onCitation(Number(match[1]))}>{part}</button> : part; })}</p>;
  }
  if (!loader && isPlainText) {
    return <p className="whitespace-pre-wrap text-[0.9375rem] leading-7 text-slate-700">{content}</p>;
  }
  return Renderer ? <Renderer content={content} /> : (
    <div>
      <p className="text-xs font-medium text-muted">{failed ? "No se pudo cargar el formato; se muestra texto seguro." : "Preparando formato seguro…"}</p>
      {failed ? <p className="mt-2 whitespace-pre-wrap text-[0.9375rem] leading-7 text-slate-700">{content}</p> : null}
    </div>
  );
}
