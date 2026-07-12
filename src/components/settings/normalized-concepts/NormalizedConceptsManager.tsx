"use client";

import { Pencil, Plus, Power, PowerOff, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppState } from "@/components/app/AppState";
import { Card } from "@/components/common/Card";
import { ModalShell } from "@/components/common/ModalShell";
import { Toggle } from "@/components/common/Toggle";
import type { NormalizedConcept } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";
import { formatEuro } from "@/lib/utils/money";
import { normalizeComparableText } from "@/lib/utils/normalize";
import {
  hasNormalizedConceptDuplicate,
  parseNormalizedConceptAmount,
  sortNormalizedConcepts,
} from "@/components/settings/normalized-concepts/normalizedConcepts";

type UsageFilter = "Todos" | "Activos" | "Desactivados";

interface ConceptForm {
  readonly year: string;
  readonly name: string;
  readonly amount: string;
  readonly comments: string;
  readonly active: boolean;
}

interface FormErrors {
  readonly year?: string;
  readonly name?: string;
  readonly amount?: string;
  readonly comments?: string;
  readonly duplicate?: string;
}

function emptyForm(): ConceptForm {
  return {
    year: String(new Date().getFullYear()),
    name: "",
    amount: "",
    comments: "",
    active: true,
  };
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ActionButton({
  label,
  title,
  tone = "neutral",
  onClick,
  children,
}: Readonly<{
  label: string;
  title: string;
  tone?: "neutral" | "active" | "inactive" | "danger";
  onClick: () => void;
  children: React.ReactNode;
}>) {
  const toneClass = {
    neutral: "border-line bg-white text-ink hover:bg-slate-100",
    active: "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
    inactive: "border-slate-200 bg-slate-100 text-slate-500 hover:bg-slate-200",
    danger: "border-red-100 bg-red-50 text-red-700 hover:bg-red-100",
  }[tone];

  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className={cn("inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors", toneClass)}
    >
      {children}
    </button>
  );
}

export function NormalizedConceptsManager() {
  const { settings, updateSettings, pushToast } = useAppState();
  const [concepts, setConcepts] = useState<readonly NormalizedConcept[]>(settings.normalizedConcepts ?? []);
  const [yearFilter, setYearFilter] = useState("Todos");
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("Todos");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | "new" | undefined>();
  const [form, setForm] = useState<ConceptForm>(emptyForm);
  const [errors, setErrors] = useState<FormErrors>({});

  useEffect(() => {
    setConcepts(settings.normalizedConcepts ?? []);
  }, [settings.normalizedConcepts]);

  const years = useMemo(() => [...new Set(concepts.map((concept) => concept.year))].sort((a, b) => b - a), [concepts]);
  const visibleConcepts = useMemo(() => {
    const normalizedQuery = normalizeComparableText(query);
    return sortNormalizedConcepts(
      concepts.filter((concept) => {
        const matchesYear = yearFilter === "Todos" || concept.year === Number(yearFilter);
        const matchesUsage =
          usageFilter === "Todos" || (usageFilter === "Activos" ? concept.active : !concept.active);
        const matchesQuery =
          !normalizedQuery ||
          normalizeComparableText(concept.name).includes(normalizedQuery) ||
          normalizeComparableText(concept.comments).includes(normalizedQuery);
        return matchesYear && matchesUsage && matchesQuery;
      }),
    );
  }, [concepts, query, usageFilter, yearFilter]);

  const counters = {
    total: concepts.length,
    active: concepts.filter((concept) => concept.active).length,
    years: years.length,
  };

  function persist(next: readonly NormalizedConcept[]): void {
    setConcepts(next);
    updateSettings({ normalizedConcepts: next });
  }

  function openCreate(): void {
    setEditingId("new");
    setForm(emptyForm());
    setErrors({});
  }

  function openEdit(concept: NormalizedConcept): void {
    setEditingId(concept.id);
    setForm({
      year: String(concept.year),
      name: concept.name,
      amount: String(concept.amount).replace(".", ","),
      comments: concept.comments,
      active: concept.active,
    });
    setErrors({});
  }

  function saveForm(): void {
    const year = Number(form.year);
    const name = form.name.trim();
    const amount = parseNormalizedConceptAmount(form.amount);
    const comments = form.comments.trim();
    const nextErrors: FormErrors = {
      year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? undefined : "Introduce un año válido.",
      name: name && name.length <= 120 ? undefined : name ? "El nombre no puede superar 120 caracteres." : "Introduce un nombre.",
      amount: amount === undefined ? "Introduce un valor válido." : undefined,
      comments: comments.length <= 500 ? undefined : "Los comentarios no pueden superar 500 caracteres.",
      duplicate:
        Number.isInteger(year) && name && hasNormalizedConceptDuplicate(concepts, year, name, editingId === "new" ? undefined : editingId)
          ? "Ya existe un concepto con ese nombre para el año seleccionado."
          : undefined,
    };
    if (Object.values(nextErrors).some(Boolean)) {
      setErrors(nextErrors);
      return;
    }

    const now = new Date().toISOString();
    if (editingId === "new") {
      const created: NormalizedConcept = {
        id: createId(),
        year,
        name,
        amount: amount!,
        comments,
        active: form.active,
        createdAt: now,
        updatedAt: now,
      };
      persist([...concepts, created]);
      pushToast({ kind: "success", title: "Concepto normalizado creado." });
    } else {
      const next = concepts.map((concept) =>
        concept.id === editingId
          ? { ...concept, year, name, amount: amount!, comments, active: form.active, updatedAt: now }
          : concept,
      );
      persist(next);
      pushToast({ kind: "success", title: "Concepto normalizado actualizado." });
    }
    setEditingId(undefined);
    setErrors({});
  }

  function toggleConcept(concept: NormalizedConcept): void {
    persist(concepts.map((item) => (item.id === concept.id ? { ...item, active: !item.active } : item)));
  }

  function deleteConcept(concept: NormalizedConcept): void {
    if (!window.confirm(`¿Eliminar el concepto «${concept.name}» de ${concept.year}?`)) {
      return;
    }
    persist(concepts.filter((item) => item.id !== concept.id));
    pushToast({ kind: "success", title: "Concepto normalizado eliminado." });
  }

  return (
    <Card data-surface="normalized-concepts-layout" className="p-4 sm:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold text-ink">Conceptos normalizados</h2>
          <p className="mt-1 text-sm leading-6 text-muted">Gestiona los conceptos y valores configurados para cada año.</p>
          <p className="mt-1 text-xs font-medium leading-5 text-muted">
            Estos conceptos se guardan como parametrización. Todavía no se aplican a los cálculos del análisis.
          </p>
        </div>
        <button type="button" className="btn-primary whitespace-nowrap" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Crear concepto
        </button>
      </div>

      <div className="mt-5 grid overflow-hidden rounded-2xl bg-slate-50/80 sm:grid-cols-3 sm:divide-x sm:divide-line/80">
        {[
          ["Conceptos totales", counters.total],
          ["Activos", counters.active],
          ["Años configurados", counters.years],
        ].map(([label, value]) => (
          <div key={label} className="border-t border-line/70 px-4 py-3 first:border-t-0 sm:border-t-0">
            <p className="text-xs font-semibold uppercase text-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <section data-surface="normalized-concepts-table" className="mt-5 overflow-hidden border-y border-line">
      <div className="grid gap-3 bg-slate-50/70 p-4 xl:grid-cols-[200px_1fr_200px]">
        <label className="text-sm font-semibold text-ink">
          Filtro Año
          <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="filter-control mt-2">
            <option>Todos</option>
            {years.map((year) => <option key={year}>{year}</option>)}
          </select>
        </label>
        <label className="relative text-sm font-semibold text-ink">
          Buscar
          <Search className="pointer-events-none absolute bottom-3 left-4 h-4 w-4 text-muted" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar concepto o comentario"
            className="filter-control mt-2 pl-10"
          />
        </label>
        <label className="text-sm font-semibold text-ink">
          Filtro Uso
          <select value={usageFilter} onChange={(event) => setUsageFilter(event.target.value as UsageFilter)} className="filter-control mt-2">
            <option>Todos</option>
            <option>Activos</option>
            <option>Desactivados</option>
          </select>
        </label>
      </div>

      {!concepts.length ? (
        <div className="border-t border-dashed border-line bg-white px-6 py-8 text-center">
          <p className="font-semibold text-ink">No hay conceptos normalizados creados.</p>
          <p className="mt-1 text-sm text-muted">Crea el primer concepto para comenzar la parametrización.</p>
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-line bg-white">
          <table className="min-w-[920px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Año</th>
                <th className="px-4 py-3">Concepto</th>
                <th className="px-4 py-3">Valor</th>
                <th className="px-4 py-3">Comentarios</th>
                <th className="px-4 py-3">Uso</th>
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleConcepts.map((concept) => (
                <tr key={concept.id} className="border-t border-line/70">
                  <td className="px-4 py-3 font-mono font-semibold text-ink">{concept.year}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{concept.name}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-ink">{formatEuro(concept.amount)}</td>
                  <td className="max-w-[320px] px-4 py-3 text-muted" title={concept.comments || undefined}>{concept.comments || "Sin comentarios"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", concept.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600")}>
                      {concept.active ? "Activo" : "Desactivado"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <ActionButton label={`Editar concepto ${concept.name}`} title="Editar concepto" onClick={() => openEdit(concept)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </ActionButton>
                      <ActionButton
                        label={`${concept.active ? "Desactivar" : "Activar"} concepto ${concept.name}`}
                        title={concept.active ? "Desactivar concepto" : "Activar concepto"}
                        tone={concept.active ? "active" : "inactive"}
                        onClick={() => toggleConcept(concept)}
                      >
                        {concept.active ? <Power className="h-4 w-4" aria-hidden="true" /> : <PowerOff className="h-4 w-4" aria-hidden="true" />}
                      </ActionButton>
                      <ActionButton label={`Eliminar concepto ${concept.name}`} title="Eliminar concepto" tone="danger" onClick={() => deleteConcept(concept)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleConcepts.length ? <p className="p-6 text-sm font-semibold text-muted">No hay conceptos con estos filtros.</p> : null}
        </div>
      )}
      </section>

      {editingId ? (
        <ModalShell
          title={editingId === "new" ? "Crear concepto" : "Editar concepto"}
          eyebrow="Conceptos normalizados"
          maxWidth="xl"
          onClose={() => setEditingId(undefined)}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditingId(undefined)}>Cancelar</button>
              <button type="button" className="btn-primary" onClick={saveForm}>Guardar concepto</button>
            </div>
          )}
        >
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-ink" htmlFor="normalized-year">
                Año
                <input id="normalized-year" aria-label="Año" type="number" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} className="filter-control mt-2" />
                {errors.year ? <span className="mt-1 block text-sm text-danger">{errors.year}</span> : null}
              </label>
              <label className="text-sm font-semibold text-ink" htmlFor="normalized-amount">
                Valor (€)
                <input id="normalized-amount" aria-label="Valor (€)" inputMode="decimal" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="filter-control mt-2" />
                {errors.amount ? <span className="mt-1 block text-sm text-danger">{errors.amount}</span> : null}
              </label>
            </div>
            <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="normalized-name">
              Nombre del concepto
              <input id="normalized-name" aria-label="Nombre del concepto" maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="filter-control mt-2" />
              {errors.name ? <span className="mt-1 block text-sm text-danger">{errors.name}</span> : null}
            </label>
            <label className="mt-4 block text-sm font-semibold text-ink" htmlFor="normalized-comments">
              Comentarios
              <textarea id="normalized-comments" aria-label="Comentarios" maxLength={500} value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} className="mt-2 min-h-24 w-full rounded-2xl border border-line p-4 text-sm" />
              {errors.comments ? <span className="mt-1 block text-sm text-danger">{errors.comments}</span> : null}
            </label>
            <div className="mt-4 rounded-2xl bg-slate-50 p-4">
              <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Activo" description="Disponible como parametrización informativa." />
            </div>
            {errors.duplicate ? <p className="mt-4 text-sm font-semibold text-danger">{errors.duplicate}</p> : null}
        </ModalShell>
      ) : null}
    </Card>
  );
}
