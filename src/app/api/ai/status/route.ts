import { NextResponse } from "next/server";
import { getGeminiModel, isGeminiConfigured, isGeminiEnabled } from "@/lib/ai/geminiClient";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    configured: isGeminiConfigured(),
    enabled: isGeminiEnabled(),
    model: getGeminiModel(),
  });
}
