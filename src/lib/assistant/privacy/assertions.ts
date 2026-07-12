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

export function assertSafeForProvider(input: unknown): void { assertSafe(input); }
export function assertSafeForPersistence(input: unknown): void { assertSafe(input); }
