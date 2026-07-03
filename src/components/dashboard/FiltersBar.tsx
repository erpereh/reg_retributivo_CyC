"use client";

export interface DashboardFilters {
  readonly query: string;
  readonly center: string;
  readonly group: string;
  readonly gt: string;
  readonly severity: string;
  readonly status: string;
}

interface FiltersBarProps {
  readonly filters: DashboardFilters;
  readonly centers: readonly string[];
  readonly groups: readonly string[];
  readonly gts: readonly string[];
  readonly onChange: (filters: DashboardFilters) => void;
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: Readonly<{ label: string; value: string; values: readonly string[]; onChange: (value: string) => void }>) {
  return (
    <label className="text-xs font-semibold uppercase text-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-line bg-white px-2 text-sm font-normal normal-case text-ink"
      >
        <option value="">Todos</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FiltersBar({ filters, centers, groups, gts, onChange }: FiltersBarProps) {
  return (
    <section className="rounded-md border border-line bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-semibold uppercase text-muted xl:col-span-2">
          Buscar
          <input
            type="search"
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            placeholder="Nombre, NIF o matricula"
            className="mt-1 h-10 w-full rounded-md border border-line px-3 text-sm font-normal normal-case text-ink"
          />
        </label>
        <SelectField label="Centro" value={filters.center} values={centers} onChange={(center) => onChange({ ...filters, center })} />
        <SelectField label="Grupo" value={filters.group} values={groups} onChange={(group) => onChange({ ...filters, group })} />
        <SelectField label="GT" value={filters.gt} values={gts} onChange={(gt) => onChange({ ...filters, gt })} />
        <label className="text-xs font-semibold uppercase text-muted">
          Severidad / estado
          <select
            value={`${filters.severity}|${filters.status}`}
            onChange={(event) => {
              const [severity, status] = event.target.value.split("|");
              onChange({ ...filters, severity, status });
            }}
            className="mt-1 h-10 w-full rounded-md border border-line bg-white px-2 text-sm font-normal normal-case text-ink"
          >
            <option value="|">Todos</option>
            <option value="Alta|">Alta</option>
            <option value="Media|">Media</option>
            <option value="Baja|">Baja</option>
            <option value="|OK">OK</option>
            <option value="|Revisar">Revisar</option>
            <option value="|Incidencia">Incidencia</option>
          </select>
        </label>
      </div>
    </section>
  );
}
