import { describe, expect, test } from "vitest";
import { assertSafeForPersistence, assertSafeForProvider, PrivacyBoundaryError } from "@/lib/assistant/privacy/assertions";
import { detectSensitivePatterns } from "@/lib/assistant/privacy/patterns";
import { redactKnownPersonValues, sanitizeForAI } from "@/lib/assistant/privacy/sanitize";
import { sanitizeChatContent } from "@/lib/assistant/domain";

const people = [{ employeeNumber: "10048", person: "Ana García López" }] as const;

describe("deterministic assistant privacy boundary", () => {
  test.each(["hola", "Buenos días", "¿Qué puedes hacer?", "Explícame qué es un registro retributivo"])("allows ordinary general chat: %s", (content) => {
    expect(sanitizeChatContent(content, people, "general")).toBe(content);
  });

  test("replaces a known analysis person before the message crosses the boundary", () => {
    expect(sanitizeChatContent("Revisa a Ana García López", people, "analysis")).toBe("Revisa a matrícula 10048");
  });

  test.each(["DNI 12345678Z", "ES91 2100 0418 4502 0005 1332", "ana@example.com"])("blocks sensitive chat content: %s", (content) => {
    expect(() => sanitizeChatContent(content, people, "general")).toThrow("El contenido contiene datos sensibles no permitidos.");
  });

  test("replaces known person values with their safe employee reference recursively", () => {
    expect(redactKnownPersonValues({ note: "Ana García López", nested: ["ANA GARCÍA LÓPEZ"] }, people)).toEqual({
      note: "matrícula 10048",
      nested: ["matrícula 10048"],
    });
  });

  test.each([
    ["identity", "DNI 12345678Z"],
    ["identity", "NIE X1234567L"],
    ["identity", "NIF B12345678"],
    ["iban", "ES91 2100 0418 4502 0005 1332"],
    ["social_security", "Seguridad Social: 28/12345678/40"],
    ["bank_account", "Cuenta bancaria: 2100 0418 45 0200051332"],
    ["bank", "Entidad bancaria: Banco Privado"],
    ["email", "ana@example.com"],
    ["phone", "Teléfono: 612 345 678"],
    ["address", "Domicilio: Calle Mayor 10, Madrid"],
    ["unsafe_labeled_line", "Datos personales: información reservada"],
  ])("detects %s without returning the sensitive value", (category, input) => {
    const findings = detectSensitivePatterns(input);
    expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ category, logicalPath: "$" })]));
    expect(JSON.stringify(findings)).not.toContain(input);
  });

  test("sanitizes nested values, labeled lines, keys and non-finite numbers before AI use", () => {
    const sanitized = sanitizeForAI({
      employee: "Ana García López",
      notes: "DNI 12345678Z\nEmail: ana@example.com\nDatos bancarios: ocultos",
      author: "Ana García López",
      amount: Number.NaN,
    }, people);
    expect(sanitized).toEqual({
      employee: "matrícula 10048",
      notes: "[IDENTIFICADOR REDACTADO]\n[CONTACTO REDACTADO]\n[DATO SENSIBLE REDACTADO]",
      amount: null,
    });
    expect(() => assertSafeForProvider(sanitized)).not.toThrow();
  });

  test.each(["documents", "chunks", "searchTerms", "sources", "snapshots", "cache", "indexJobs", "errors"])(
    "audits %s recursively and fails closed without echoing the value",
    (store) => {
      const value = { id: "safe-id", [store]: { nested: [{ message: "ana@example.com" }] } };
      let caught: unknown;
      try { assertSafeForPersistence(value); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(PrivacyBoundaryError);
      expect((caught as PrivacyBoundaryError).findings[0]).toEqual(expect.objectContaining({ category: "email", logicalPath: "$.field[1].field[0][0].field[0]" }));
      expect(String(caught)).not.toContain("ana@example.com");
    },
  );

  test.each([
    { originalFileName: "nomina-ana.pdf" },
    { path: "C:\\privado\\nomina.pdf" },
    { author: "Ana García" },
    { metadata: { office: "privado" } },
    { rawText: "texto" },
    { apiKey: "sk-secret" },
  ])("rejects prohibited persistence fields: %o", (value) => {
    expect(() => assertSafeForPersistence(value)).toThrow(PrivacyBoundaryError);
  });

  test("accepts a recursively safe persisted projection", () => {
    expect(() => assertSafeForPersistence({
      id: "chunk-1",
      documentId: "document-1",
      sanitizedSourceLabel: "Documento adicional 1",
      content: "Concepto transporte: 20,00 EUR",
      sanitizedHash: "a1b2c3",
      terms: ["concepto", "transporte"],
    })).not.toThrow();
  });

  test("never exposes sensitive object keys in findings, logical paths or errors", () => {
    const sensitiveKey = "DNI 12345678Z ana@example.com";
    let caught: unknown;
    try { assertSafeForPersistence({ outer: { [sensitiveKey]: "safe" } }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PrivacyBoundaryError);
    const serializedFindings = JSON.stringify((caught as PrivacyBoundaryError).findings);
    expect(serializedFindings).not.toContain(sensitiveKey);
    expect(serializedFindings).not.toContain("12345678Z");
    expect(serializedFindings).not.toContain("ana@example.com");
    expect(String(caught)).not.toContain(sensitiveKey);
    expect((caught as PrivacyBoundaryError).findings[0]?.logicalPath).toMatch(/^\$\.field\[\d+\]\.field\[\d+\]$/u);
  });

  test("normalizes caller-supplied logical paths instead of trusting sensitive text", () => {
    const finding = detectSensitivePatterns("ana@example.com", "$['DNI 12345678Z']")[0];
    expect(finding?.logicalPath).toBe("$");
    expect(JSON.stringify(finding)).not.toContain("12345678Z");
  });

  test.each([
    ["phone", "612345678"],
    ["phone", "+34 612 345 678"],
    ["social_security", "281234567840"],
    ["social_security", "28 12345678 40"],
    ["bank_account", "21000418450200051332"],
    ["bank_account", "2100 0418 45 0200051332"],
  ])("detects autonomous %s values without labels", (category, value) => {
    expect(detectSensitivePatterns(value)).toEqual(expect.arrayContaining([expect.objectContaining({ category })]));
  });

  test.each(["chunks", "searchTerms"])("rejects autonomous identifiers recursively in %s", (store) => {
    expect(() => assertSafeForPersistence({ [store]: [{ id: "safe", content: "612345678" }] })).toThrow(PrivacyBoundaryError);
    expect(() => assertSafeForPersistence({ [store]: [{ id: "safe", term: "21000418450200051332" }] })).toThrow(PrivacyBoundaryError);
  });
});
