"use client";

import type { AnalysisError } from "@/lib/types";

export function ErrorsTable({ errors }: Readonly<{ errors: readonly AnalysisError[] }>) {
  if (!errors.length) {
    return null;
  }

  return (
    <section className="rounded-md border border-line bg-white shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Errores y avisos</h2>
      </div>
      <div className="overflow-auto">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="bg-ink text-white">
            <tr>
              {["Archivo", "Tipo", "Mensaje", "Accion recomendada"].map((header) => (
                <th key={header} className="px-3 py-3 text-xs font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {errors.map((error, index) => (
              <tr key={`${error.file}-${index}`} className="odd:bg-white even:bg-slate-50">
                <td className="px-3 py-3">{error.file}</td>
                <td className="px-3 py-3">{error.type}</td>
                <td className="px-3 py-3">{error.message}</td>
                <td className="px-3 py-3">{error.recommendedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
