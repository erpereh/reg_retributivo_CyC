import { NextResponse } from "next/server";
import { exportAnalysisToBuffer } from "@/lib/export/exportExcel";
import type { AnalysisResult } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const analysis = (await request.json()) as AnalysisResult;
    const buffer = await exportAnalysisToBuffer(analysis);
    const body = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    return new NextResponse(body, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="comparativa_reg_retributivo_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo exportar el Excel." },
      { status: 500 },
    );
  }
}
