import { NextResponse } from "next/server";
import { extractGroupedExcelSheets } from "@/lib/groupings/groupedExcelSheets";
import { parseRegistroRetributivo } from "@/lib/parsers/registroRetributivoParser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const registro = formData.get("registro");
    if (!(registro instanceof File)) {
      return NextResponse.json({ error: "Falta el Excel del Registro Retributivo." }, { status: 400 });
    }
    const buffer = Buffer.from(await registro.arrayBuffer());
    const parsed = await parseRegistroRetributivo(buffer);
    return NextResponse.json({ ...parsed, groupedExcelSheets: extractGroupedExcelSheets(buffer), fileName: registro.name });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el Excel." }, { status: 500 });
  }
}
