import type { SourceReference } from "@/lib/assistant/domain";

export function SourceDetails({ source }: Readonly<{ source: SourceReference }>) {
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-muted">
      <dt>Tipo</dt><dd className="text-right font-medium text-ink">{source.sourceType}</dd>
      {source.page ? <><dt>Página</dt><dd className="text-right font-medium text-ink">{source.page}</dd></> : null}
      {source.sheet ? <><dt>Hoja</dt><dd className="text-right font-medium text-ink">{source.sheet}</dd></> : null}
      {source.period ? <><dt>Periodo</dt><dd className="text-right font-medium text-ink">{source.period}</dd></> : null}
      <dt className="col-span-2 mt-1">Extracto anonimizado</dt>
      <dd className="col-span-2 text-slate-600">{source.excerpt}</dd>
    </dl>
  );
}
