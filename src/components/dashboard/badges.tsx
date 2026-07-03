"use client";

export function Badge({ value }: Readonly<{ value?: string }>) {
  const text = value ?? "Sin dato";
  const lower = text.toLowerCase();
  const cls = lower.includes("alta") || lower.includes("incidencia") || lower.includes("falta")
    ? "bg-danger-bg text-danger"
    : lower.includes("media") || lower.includes("revisar")
      ? "bg-warning-bg text-warning"
      : lower.includes("ok")
        ? "bg-success-bg text-success"
        : "bg-info-bg text-info";

  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${cls}`}>{text}</span>;
}
