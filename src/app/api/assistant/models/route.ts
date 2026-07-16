export const runtime = "nodejs";

/** Legacy endpoint intentionally disabled: provider configuration and catalogs use /providers. */
export async function POST(): Promise<Response> {
  return Response.json({ error: "Endpoint retirado." }, { status: 410 });
}
