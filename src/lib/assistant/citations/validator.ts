export interface CitationValidationContext {
  readonly allowedSourceIds: readonly string[];
  readonly verifiedAmounts: readonly number[];
  readonly verifiedEmployeeIds: readonly string[];
}

export interface ValidatedCitedAnswer {
  readonly text: string;
  readonly usedSourceIds: readonly string[];
}

function parseLocalizedNumber(input: string): number {
  const compact = input.replace(/\s/g, "");
  const comma = compact.lastIndexOf(",");
  const dot = compact.lastIndexOf(".");
  const decimal = Math.max(comma, dot);
  if (decimal < 0) return Number(compact);
  const fractionLength = compact.length - decimal - 1;
  if (fractionLength !== 2) return Number(compact.replace(/[.,]/g, ""));
  const integer = compact.slice(0, decimal).replace(/[.,]/g, "");
  return Number(`${integer}.${compact.slice(decimal + 1)}`);
}

export function validateCitedAnswer(text: string, context: CitationValidationContext): ValidatedCitedAnswer {
  const allowed = new Set(context.allowedSourceIds);
  const usedSourceIds: string[] = [];
  const rendered = text.replace(/\[\[source:([^\]\s]+)\]\]/g, (_token, sourceId: string) => {
    if (!allowed.has(sourceId)) throw new Error("citation_not_allowed");
    let index = usedSourceIds.indexOf(sourceId);
    if (index < 0) { usedSourceIds.push(sourceId); index = usedSourceIds.length - 1; }
    return `[${index + 1}]`;
  });
  if (/\[\[source:/.test(rendered)) throw new Error("citation_invalid");

  const amountMatches = [...text.matchAll(/([-+]?\d[\d.,\s]*\d|[-+]?\d)\s*€/g)];
  for (const match of amountMatches) {
    const amount = parseLocalizedNumber(match[1]!);
    if (!Number.isFinite(amount) || !context.verifiedAmounts.some((verified) => Math.abs(verified - amount) <= 0.011)) throw new Error("contradictory_amount");
    const evidenceTail = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 120);
    if (!/\[\[source:[^\]]+\]\]/.test(evidenceTail)) throw new Error("citation_required_for_amount");
  }
  const verifiedEmployees = new Set(context.verifiedEmployeeIds);
  for (const match of text.matchAll(/matr[ií]cula\s+([\p{L}\p{N}._-]+)/giu)) {
    if (!verifiedEmployees.has(match[1]!)) throw new Error("invented_employee_id");
  }
  return { text: rendered, usedSourceIds };
}
