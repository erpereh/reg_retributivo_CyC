export type SensitiveCategory =
  | "identity"
  | "iban"
  | "social_security"
  | "bank_account"
  | "bank"
  | "email"
  | "phone"
  | "address"
  | "birth_date"
  | "secret"
  | "file_reference"
  | "unsafe_labeled_line";

export interface SensitiveFinding {
  readonly category: SensitiveCategory;
  readonly logicalPath: string;
  readonly ruleId: string;
}

interface SensitiveRule {
  readonly category: SensitiveCategory;
  readonly id: string;
  readonly pattern: RegExp;
}

const RULES: readonly SensitiveRule[] = [
  { category: "email", id: "contact.email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu },
  { category: "iban", id: "bank.iban", pattern: /\bES\d{2}(?:[\s-]*\d{4}){5}\b/iu },
  { category: "identity", id: "identity.spanish_tax_id", pattern: /\b(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])\b/iu },
  { category: "social_security", id: "identity.social_security", pattern: /(?<![\p{L}\p{N}-])\d{2}[\s/-]*\d{8}[\s/-]*\d{2}(?![\p{L}\p{N}-])/u },
  { category: "bank_account", id: "bank.account", pattern: /(?<![\p{L}\p{N}-])\d{4}[\s-]*\d{4}[\s-]*\d{2}[\s-]*\d{10}(?![\p{L}\p{N}-])/u },
  { category: "bank", id: "bank.entity", pattern: /(?:entidad\s+bancaria|banco)\s*[:#-]\s*[^\r\n]+/iu },
  { category: "phone", id: "contact.phone", pattern: /(?<![\p{L}\p{N}-])(?:\+?34[\s.-]*)?[6789](?:[\s.-]*\d){8}(?![\p{L}\p{N}-])/u },
  { category: "address", id: "contact.address", pattern: /(?:domicilio|direcci[oó]n|c\/|calle|avenida|plaza)\s*[:#.-]?\s*[^\r\n]+/iu },
  { category: "birth_date", id: "identity.birth_date", pattern: /(?:fecha\s+de\s+nacimiento|nacido\/?a?)\s*[:#-]?\s*[^\r\n]+/iu },
  { category: "secret", id: "secret.credential", pattern: /(?:api[_ -]?key|token|password|contrase[nñ]a|secret)\s*[:=]\s*\S+/iu },
  { category: "secret", id: "secret.provider_key", pattern: /\b(?:sk|AIza|gsk|csk)[-_][A-Za-z0-9_-]{8,}\b/u },
  { category: "file_reference", id: "metadata.path", pattern: /(?:\b[A-Z]:\\|\/(?:Users|home|tmp|var)\/)[^\r\n]+/iu },
  { category: "file_reference", id: "metadata.filename", pattern: /\b[^\s\\/:*?"<>|]+\.(?:pdf|xlsx?|docx?|csv|txt|md|zip)\b/iu },
  { category: "unsafe_labeled_line", id: "labeled.personal", pattern: /(?:datos\s+(?:personales|bancarios)|informaci[oó]n\s+personal)\s*[:#-]\s*[^\r\n]+/iu },
];

export const PROHIBITED_PERSISTENCE_KEYS = new Set([
  "author", "authors", "creator", "lastmodifiedby", "metadata", "properties", "officeproperties",
  "filename", "originalfilename", "localdisplayname", "path", "filepath", "fullpath", "directory",
  "raw", "rawtext", "rawvalue", "original", "originaltext", "binary", "buffer", "bytes",
  "apikey", "api_key", "token", "password", "secret", "authorization", "headers",
]);

export function canonicalizePrivacyText(input: string): string {
  if (/\p{Cf}/u.test(input)) throw new Error("El contenido contiene caracteres de formato Unicode no permitidos por privacidad.");
  return input.normalize("NFKC").replace(/\p{White_Space}+/gu, " ").trim().toLocaleLowerCase("es");
}

export function normalizeSensitiveKey(key: string): string {
  return canonicalizePrivacyText(key).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_]/giu, "");
}

export function detectSensitivePatterns(input: string, logicalPath = "$"): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  const safeLogicalPath = /^\$(?:(?:\.field\[\d+\])|(?:\[\d+\]))*$/u.test(logicalPath) ? logicalPath : "$";
  const canonical = canonicalizePrivacyText(input);
  for (const rule of RULES) {
    if (rule.pattern.test(canonical)) findings.push({ category: rule.category, logicalPath: safeLogicalPath, ruleId: rule.id });
  }
  return findings;
}
