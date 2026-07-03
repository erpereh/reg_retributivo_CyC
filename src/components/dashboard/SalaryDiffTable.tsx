"use client";

import type { SalaryDifference } from "@/lib/types";
import { formatEuro } from "@/lib/utils/money";
import { Badge } from "@/components/dashboard/badges";

export function SalaryDiffTable({ rows }: Readonly<{ rows: readonly SalaryDifference[] }>) {
  return (
    <section className="rounded-md border border-line bg-white shadow-sm">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Diferencia salarial</h2>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-[1600px] w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-ink text-white">
            <tr>
              {["Estado", "NIF", "Persona", "Matricula", "Centro", "Grupo profesional", "GT", "Total deberia", "Total esta", "Diferencia", "N nominas", "Periodos", "Observaciones"].map((header) => (
                <th key={header} className="border-b border-slate-700 px-3 py-3 text-xs font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.workerNif}-${row.employeeNumber}`} className="odd:bg-white even:bg-slate-50 hover:bg-blue-50">
                <td className="whitespace-nowrap px-3 py-2"><Badge value={row.status} /></td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{row.workerNif}</td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold">{row.workerName}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{row.employeeNumber}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.workplace}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.professionalGroup}</td>
                <td className="whitespace-nowrap px-3 py-2">{row.gt}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(row.totalShouldBe)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(row.totalActual)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{formatEuro(row.difference)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{row.payrollCount}</td>
                <td className="px-3 py-2">{row.periodsIncluded.join("; ")}</td>
                <td className="px-3 py-2">{row.observations}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <p className="p-6 text-sm text-muted">No hay diferencias salariales con los filtros actuales.</p> : null}
      </div>
    </section>
  );
}
