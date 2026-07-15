import type { SourceReference } from "@/lib/assistant/domain";
import type { ToolRound } from "@/lib/assistant/toolRounds";

interface ToolFactSet {
  readonly money: readonly number[];
  readonly people: readonly string[];
  readonly codes: readonly string[];
}

export interface ToolGroundingResult {
  readonly valid: boolean;
  readonly contradiction: boolean;
  readonly usedSources: readonly SourceReference[];
  readonly primaryPersonId?: string;
}

const EXTERNAL_INTERPRETATIONS = /\b(?:veh[ií]culo|pa[ií]s|universidad|aeronave|patente|embarcaci[oó]n)\b/iu;
const INFORMATION_DENIAL = /\b(?:no dispongo de informaci[oó]n|no tengo informaci[oó]n|carezco de informaci[oó]n)\b/iu;
const MONEY_TOKEN = /[-+]?\d{1,3}(?:[.\s]\d{3})+(?:[,\.]\d{1,2})?\s*(?:€|eur)?|[-+]?\d+[,.]\d{1,2}\s*(?:€|eur)?/giu;
const PERSON_TOKEN = /\bmatr[ií]cula\s*(?:n(?:ú|u)mero\s*)?[#:ºo.]?\s*([a-z0-9-]{1,64})\b/giu;

export function normalizeMoney(value: string | number): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : undefined;
  let source = value.trim().replace(/(?:€|eur)/giu, "").replace(/\s+/gu, "");
  if (!source) return undefined;
  const negative = source.startsWith("-");
  source = source.replace(/^[+-]/u, "");
  const commas = [...source.matchAll(/,/gu)].map((item) => item.index ?? -1);
  const dots = [...source.matchAll(/\./gu)].map((item) => item.index ?? -1);
  const separator = Math.max(commas.at(-1) ?? -1, dots.at(-1) ?? -1);
  if (separator >= 0 && source.length - separator - 1 <= 2) source = `${source.slice(0, separator).replace(/[.,]/gu, "")}.${source.slice(separator + 1)}`;
  else source = source.replace(/[.,]/gu, "");
  const parsed = Number(source);
  return Number.isFinite(parsed) ? Math.round((negative ? -parsed : parsed) * 100) / 100 : undefined;
}

export function normalizeIdentifier(value: string): string { return value.trim().replace(/\s+/gu, "").toLocaleUpperCase("es"); }

export function verifyToolGrounding(text: string, rounds: readonly ToolRound[]): ToolGroundingResult {
  const successful = rounds.flatMap((round) => round.results).flatMap((result) => result.outcome.ok && !("empty" in result.outcome) ? [{ result, data: result.outcome.data }] : []);
  const facts = successful.map(({ result, data }) => ({ result, facts: factsFrom(data) }));
  const allFacts: ToolFactSet = {
    money: facts.flatMap((item) => item.facts.money),
    people: facts.flatMap((item) => item.facts.people),
    codes: facts.flatMap((item) => item.facts.codes),
  };
  const mentionsMoney = [...text.matchAll(MONEY_TOKEN)].map((match) => normalizeMoney(match[0])).filter((value): value is number => value !== undefined);
  const mentionsPeople = [...text.matchAll(PERSON_TOKEN)].map((match) => normalizeIdentifier(match[1]!));
  const forbidden = EXTERNAL_INTERPRETATIONS.test(text) || (successful.length > 0 && INFORMATION_DENIAL.test(text));
  const inventedMoney = mentionsMoney.some((amount) => !allFacts.money.some((fact) => fact === amount));
  const incompatiblePerson = mentionsPeople.some((personId) => !allFacts.people.includes(personId));
  const contradiction = forbidden || inventedMoney || incompatiblePerson;
  const evidenceSources = facts.flatMap(({ result, facts: local }) => supportsText(text, local) ? result.sources : []);
  // A matrícula alone is shared by several person-scoped tools. It is enough
  // to cite a sole recovered source, but must not attach every source merely
  // because they refer to the same person.
  const usedSources = evidenceSources.length || facts.length !== 1
    ? evidenceSources
    : facts[0]!.facts.people.some((person) => normalizeIdentifier(text).includes(person)) ? facts[0]!.result.sources : [];
  const primaryPersonId = allFacts.people.at(0);
  return { valid: !contradiction, contradiction, usedSources: uniqueSources(usedSources), ...(primaryPersonId ? { primaryPersonId } : {}) };
}

function supportsText(text: string, facts: ToolFactSet): boolean {
  const money = [...text.matchAll(MONEY_TOKEN)].map((match) => normalizeMoney(match[0])).filter((value): value is number => value !== undefined);
  if (money.some((amount) => facts.money.includes(amount))) return true;
  const normalized = normalizeIdentifier(text);
  return facts.codes.some((code) => normalized.includes(code));
}

function factsFrom(data: unknown): ToolFactSet {
  const money: number[] = [];
  const people: string[] = [];
  const codes: string[] = [];
  const visit = (value: unknown, key = ""): void => {
    if (typeof value === "number") { if (/(?:registro|payroll|recib|difference|diferencia|amount|importe|total)/iu.test(key)) { const amount = normalizeMoney(value); if (amount !== undefined) money.push(amount); } return; }
    if (typeof value === "string") {
      if (/^(?:personId|employeeNumber)$/iu.test(key)) people.push(normalizeIdentifier(value));
      if (/(?:registroCode|conceptId|code)$/iu.test(key)) codes.push(normalizeIdentifier(value));
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, key)); return; }
    if (value && typeof value === "object") Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
  };
  visit(data);
  return { money: [...new Set(money)], people: [...new Set(people)], codes: [...new Set(codes)] };
}

function uniqueSources(sources: readonly SourceReference[]): readonly SourceReference[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}
