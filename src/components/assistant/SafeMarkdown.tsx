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

export function SafeMarkdown({ content, loader }: Readonly<{ content: string; loader?: () => Promise<MarkdownComponent> }>) {
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
