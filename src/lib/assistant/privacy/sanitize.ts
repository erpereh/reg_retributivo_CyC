import type { KnownPersonReference } from "@/lib/assistant/domain";
import { detectSensitivePatterns, normalizeSensitiveKey, PROHIBITED_PERSISTENCE_KEYS, type SensitiveCategory } from "@/lib/assistant/privacy/patterns";

export type SanitizedValue = null | boolean | number | string | SanitizedValue[] | { readonly [key: string]: SanitizedValue };

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function replaceKnownPeopleInText(input: string, knownPeople: readonly KnownPersonReference[]): string {
  return knownPeople.reduce((text, person) => {
    const name = person.person?.trim();
    if (!name) return text;
    return text.replace(new RegExp(escapeRegularExpression(name), "giu"), `matrícula ${person.employeeNumber}`);
  }, input);
}

function placeholder(category: SensitiveCategory): string {
  if (category === "email" || category === "phone") return "[CONTACTO REDACTADO]";
  if (category === "unsafe_labeled_line" || category === "bank" || category === "bank_account" || category === "address") return "[DATO SENSIBLE REDACTADO]";
  if (category === "secret") return "[SECRETO REDACTADO]";
  if (category === "file_reference") return "[REFERENCIA LOCAL REDACTADA]";
  return "[IDENTIFICADOR REDACTADO]";
}

function sanitizeText(input: string): string {
  return input.split(/\r?\n/u).map((line) => {
    const finding = detectSensitivePatterns(line)[0];
    return finding ? placeholder(finding.category) : line;
  }).join("\n");
}

function sanitizeValue(input: unknown, knownPeople: readonly KnownPersonReference[]): SanitizedValue {
  if (input === null || typeof input === "boolean" || typeof input === "string") {
    return typeof input === "string" ? sanitizeText(replaceKnownPeopleInText(input, knownPeople)) : input;
  }
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (Array.isArray(input)) return input.map((value) => sanitizeValue(value, knownPeople));
  if (typeof input === "object") {
    const output: Record<string, SanitizedValue> = {};
    for (const [key, value] of Object.entries(input)) {
      if (PROHIBITED_PERSISTENCE_KEYS.has(normalizeSensitiveKey(key))) continue;
      output[key] = sanitizeValue(value, knownPeople);
    }
    return output;
  }
  return null;
}

export function redactKnownPersonValues(input: unknown, knownPeople: readonly KnownPersonReference[]): SanitizedValue {
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input === "string") return replaceKnownPeopleInText(input, knownPeople);
  if (Array.isArray(input)) return input.map((value) => redactKnownPersonValues(value, knownPeople));
  if (typeof input === "object") {
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, redactKnownPersonValues(value, knownPeople)]));
  }
  return null;
}

export function sanitizeForAI(input: unknown, knownPeople: readonly KnownPersonReference[] = []): SanitizedValue {
  return sanitizeValue(input, knownPeople);
}
