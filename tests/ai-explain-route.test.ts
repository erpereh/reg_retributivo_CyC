import { afterEach, describe, expect, test, vi } from "vitest";

const geminiMocks = vi.hoisted(() => ({
  configured: true,
  enabled: true,
  generateContent: vi.fn(),
  createGeminiClient: vi.fn(),
}));

vi.mock("@/lib/ai/geminiClient", () => ({
  createGeminiClient: geminiMocks.createGeminiClient,
  getGeminiModel: () => "gemini-3.1-flash-lite",
  isGeminiConfigured: () => geminiMocks.configured,
  isGeminiEnabled: () => geminiMocks.configured && geminiMocks.enabled,
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const payload = {
  rowId: "person:10048",
  employeeNumber: "10048",
  workplace: "Bilbao",
  position: "Administracion",
  category: "Categoria A",
  status: "Diferencia",
  amounts: [{ label: "Total", registro: 1000, pdf: 1200, difference: 200 }],
  deterministicCause: {
    label: "Teletrabajo",
    description: "Diferencia compatible con teletrabajo.",
    review: "Revisar conceptos extrasalariales.",
  },
};

describe("POST /api/explain", () => {
  afterEach(() => {
    geminiMocks.configured = true;
    geminiMocks.enabled = true;
    geminiMocks.generateContent.mockReset();
    geminiMocks.createGeminiClient.mockReset();
    vi.resetModules();
  });

  test("returns a safe disabled response when Gemini is not configured", async () => {
    geminiMocks.configured = false;
    const { POST } = await import("@/app/api/explain/route");

    const response = await POST(request({ type: "person", payload }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe("IA no configurada. Añade GEMINI_API_KEY en .env");
    expect(geminiMocks.createGeminiClient).not.toHaveBeenCalled();
  });

  test("normalizes Gemini output into the mandatory explanation sections", async () => {
    geminiMocks.createGeminiClient.mockReturnValue({
      models: {
        generateContent: geminiMocks.generateContent.mockResolvedValue({
          text: JSON.stringify({
            summary: "Diferencia localizada.",
            probableCauses: ["Concepto extrasalarial pendiente."],
            registroReview: ["Revisar Registro."],
            pdfReview: ["Revisar datos extraidos de los PDFs."],
            recommendedActions: ["Documentar decision."],
            confidence: "Media",
          }),
        }),
      },
    });
    const { POST } = await import("@/app/api/explain/route");

    const response = await POST(request({ type: "person", payload }));
    const body = await response.json();
    const call = geminiMocks.generateContent.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(body.explanation).toMatchObject({
      summary: "Diferencia localizada.",
      probableCauses: ["Concepto extrasalarial pendiente."],
      registroReview: ["Revisar Registro."],
      pdfReview: ["Revisar datos extraidos de los PDFs."],
      recommendedActions: ["Documentar decision."],
      confidence: "Media",
    });
    expect(JSON.stringify(call)).toContain("segun los datos extraidos de los PDFs");
    expect(JSON.stringify(call)).toContain("bloque Complemento Salarial");
    expect(JSON.stringify(call)).toContain("clasificado de forma distinta");
    expect(JSON.stringify(call)).not.toContain("leido el PDF");
  });

  test("sanitizes overly strong or imprecise wording returned by Gemini", async () => {
    const { normalizeAiExplanation } = await import("@/lib/ai/explainTypes");

    const explanation = normalizeAiExplanation({
      summary: "El Salario base se ha reclasificado erróneamente.",
      probableCauses: ["Salario base clasificado erróneamente."],
      registroReview: ["Revisar el error en salario base."],
      pdfReview: ["Ver salario base."],
      recommendedActions: ["Corregir el importe erróneamente clasificado."],
      confidence: "Media",
    });
    const serialized = JSON.stringify(explanation);

    expect(serialized).not.toMatch(/Salario base/i);
    expect(serialized).not.toMatch(/erróneamente|erroneamente/i);
    expect(serialized).toContain("bloque Salario");
    expect(serialized).toContain("clasificado de forma distinta");
  });
});
