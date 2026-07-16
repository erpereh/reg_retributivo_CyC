import { detectSensitivePatterns, normalizeSensitiveKey, PROHIBITED_PERSISTENCE_KEYS, type SensitiveFinding } from "@/lib/assistant/privacy/patterns";

export class PrivacyBoundaryError extends Error {
  constructor(readonly findings: readonly SensitiveFinding[]) {
    super(`El contenido no supera el límite de privacidad (${findings.map((finding) => `${finding.category} en ${finding.logicalPath}`).join(", ")}).`);
    this.name = "PrivacyBoundaryError";
  }
}

function propertyPath(parent: string, position: number): string {
  return `${parent}.field[${position}]`;
}

function audit(input: unknown, logicalPath: string, findings: SensitiveFinding[], seen: WeakSet<object>): void {
  if (typeof input === "string") {
    findings.push(...detectSensitivePatterns(input, logicalPath));
    return;
  }
  if (typeof input === "number" && !Number.isFinite(input)) {
    findings.push({ category: "unsafe_labeled_line", logicalPath, ruleId: "json.non_finite" });
    return;
  }
  if (input === null || typeof input === "boolean" || typeof input === "number") return;
  if (typeof input !== "object") {
    findings.push({ category: "unsafe_labeled_line", logicalPath, ruleId: "json.unsupported_type" });
    return;
  }
  if (seen.has(input)) {
    findings.push({ category: "unsafe_labeled_line", logicalPath, ruleId: "json.circular_reference" });
    return;
  }
  seen.add(input);
  if (Array.isArray(input)) {
    input.forEach((value, index) => audit(value, `${logicalPath}[${index}]`, findings, seen));
  } else {
    Object.entries(input).forEach(([key, value], position) => {
      const nextPath = propertyPath(logicalPath, position);
      if (PROHIBITED_PERSISTENCE_KEYS.has(normalizeSensitiveKey(key))) {
        findings.push({ category: "unsafe_labeled_line", logicalPath: nextPath, ruleId: "metadata.prohibited_key" });
      } else {
        findings.push(...detectSensitivePatterns(key, nextPath));
        audit(value, nextPath, findings, seen);
      }
    });
  }
  seen.delete(input);
}

function assertSafe(input: unknown): void {
  const findings: SensitiveFinding[] = [];
  audit(input, "$", findings, new WeakSet());
  if (findings.length) throw new PrivacyBoundaryError(findings);
}

/**
 * Thought signatures are provider-issued opaque bytes encoded as text. Their
 * shape is validated at the chat contract boundary, but their contents must
 * not be interpreted as user, tool, or model text by the privacy scanners.
 */
export function withoutOpaqueProviderSignatures(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(withoutOpaqueProviderSignatures);
  if (!input || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  const context = record.providerContext;
  const isValidatedToolRecord = typeof record.requestId === "string" && typeof record.tool === "string"
    && context && typeof context === "object" && !Array.isArray(context)
    && (context as Record<string, unknown>).kind === "gemini"
    && typeof (context as Record<string, unknown>).partIndex === "number"
    && Object.keys(context).every((field) => ["kind", "partIndex", "thoughtSignature"].includes(field));
  return Object.fromEntries(Object.entries(record).map(([key, value]) => isValidatedToolRecord && key === "providerContext"
    ? [key, Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([field]) => field !== "thoughtSignature"))]
    : [key, withoutOpaqueProviderSignatures(value)]));
}

export function assertSafeForProvider(input: unknown): void { assertSafe(input); }
export function assertSafeForPersistence(input: unknown): void { assertSafe(input); }
