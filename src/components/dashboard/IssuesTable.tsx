"use client";

import type { FieldIssue } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";
import { Badge } from "@/components/dashboard/badges";

export function IssuesTable({ issues }: Readonly<{ issues: readonly FieldIssue[] }>) {
  return (
    <section className="rounded-md border border-line bg-white shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Campos mal</h2>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-[1800px] w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-ink text-white">
            <tr>
              {["NIF", "Persona", "Matricula", "Campo", "Deberia estar", "Como esta", "Salario deberia", "Salario esta", "Diferencia", "Periodos", "Archivos", "Severidad", "Observaciones", "Accion"].map((header) => (
                <th key={header} className="border-b border-slate-700 px-3 py-3 text-xs font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => (
              <tr key={`${issue.workerNif}-${issue.field}-${index}`} className="odd:bg-white even:bg-slate-50 hover:bg-blue-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono">{issue.workerNif}</td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{issue.workerName}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{issue.employeeNumber}</td>
                <td className="whitespace-nowrap px-3 py-2">{issue.field}</td>
                <td className="px-3 py-2">{issue.shouldBe}</td>
                <td className="px-3 py-2">{issue.actual}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(issue.salaryShouldBe)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(issue.salaryActual)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(issue.salaryDifference)}</td>
                <td className="px-3 py-2">{issue.affectedPeriods.join("; ")}</td>
                <td className="px-3 py-2">{issue.affectedFiles.join("; ")}</td>
                <td className="px-3 py-3"><Badge value={issue.severity} /></td>
                <td className="px-3 py-2">{issue.observations}</td>
                <td className="px-3 py-2">{issue.recommendedAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!issues.length ? <p className="p-6 text-sm text-muted">No hay incidencias de campos con los filtros actuales.</p> : null}
      </div>
    </section>
  );
}
