import { NextResponse } from "next/server";
import { createGeminiClient, getGeminiModel, isGeminiConfigured, isGeminiEnabled } from "@/lib/ai/geminiClient";
import {
  AI_EXPLAIN_FALLBACK_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
  explainRequestSchema,
  normalizeAiExplanation,
  type ExplainRequest,
} from "@/lib/ai/explainTypes";

export const runtime = "nodejs";

function buildPrompt(request: ExplainRequest): string {
  return [
    "Eres un analista retributivo. Explica diferencias ya calculadas; no recalcules, no cambies estados y no inventes importes.",
    "Responde en español profesional y conciso, en JSON válido con las claves indicadas.",
    "No afirmes haber revisado documentos originales. Cuando hables de PDFs, usa la formulación: segun los datos extraidos de los PDFs.",
    "Usa siempre bloque Salario, bloque Complemento Salarial y bloque Extrasalarial para importes agregados por bloque.",
    "No uses Salario base salvo que el concepto concreto recibido sea exactamente Salario Base.",
    "No afirmes que algo está erróneamente clasificado. Usa clasificado de forma distinta, posible reclasificación o diferencia de criterio de clasificación.",
    "Incluye siempre: summary, probableCauses, registroReview, pdfReview, recommendedActions y confidence.",
    "confidence debe ser Alta, Media o Baja.",
    `Tipo de explicación: ${request.type}`,
    "Datos estructurados sanitizados:",
    JSON.stringify(request.payload, null, 2),
  ].join("\n");
}

function responseSchema() {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      probableCauses: { type: "array", items: { type: "string" } },
      registroReview: { type: "array", items: { type: "string" } },
      pdfReview: { type: "array", items: { type: "string" } },
      recommendedActions: { type: "array", items: { type: "string" } },
      confidence: { type: "string", enum: ["Alta", "Media", "Baja"] },
    },
    required: ["summary", "probableCauses", "registroReview", "pdfReview", "recommendedActions", "confidence"],
  };
}

export async function POST(request: Request) {
  const parsed = explainRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: "Solicitud IA no válida." }, { status: 400 });
  }

  if (!isGeminiConfigured() || !isGeminiEnabled()) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE, model: getGeminiModel() }, { status: 503 });
  }

  const client = createGeminiClient();
  if (!client) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE, model: getGeminiModel() }, { status: 503 });
  }

  try {
    const model = getGeminiModel();
    const response = await client.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(parsed.data) }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema(),
      },
    });
    const text = response.text;
    if (!text) {
      throw new Error("Empty Gemini response");
    }

    return NextResponse.json({ explanation: normalizeAiExplanation(JSON.parse(text)), model });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[ai-explain] Gemini explanation failed", error);
    }
    return NextResponse.json({ error: AI_EXPLAIN_FALLBACK_MESSAGE, model: getGeminiModel() }, { status: 502 });
  }
}
