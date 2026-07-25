import { NextResponse } from "next/server";
import { parsePayrollPdf } from "@/lib/parsers/payrollPdfParser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const pdf = formData.get("pdf");
    if (!(pdf instanceof File)) {
      return NextResponse.json({ error: "Falta el PDF de nómina." }, { status: 400 });
    }
    const parsed = await parsePayrollPdf(Buffer.from(await pdf.arrayBuffer()), pdf.name);
    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el PDF." }, { status: 500 });
  }
}
