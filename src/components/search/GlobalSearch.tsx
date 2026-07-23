"use client";

import { Archive, FileText, Search, Sparkles, UserRound, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_FILTERS, useAppState } from "@/components/app/AppState";
import {
  buildGlobalSearchIndex,
  groupGlobalSearchResults,
  searchGlobalIndex,
  type GlobalSearchEntry,
  type GlobalSearchKind,
} from "@/lib/search/globalSearch";

const ICONS: Record<GlobalSearchKind, typeof Search> = {
  person: UserRound,
  concept: Sparkles,
  document: FileText,
  analysis: Archive,
};

export function GlobalSearch() {
  const { result, history, setView, setFilters, openStoredAnalysis } = useAppState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const index = useMemo(() => buildGlobalSearchIndex(result, history), [history, result]);
  const results = useMemo(() => searchGlobalIndex(index, query), [index, query]);
  const groups = useMemo(() => groupGlobalSearchResults(results), [results]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  function close() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  async function select(entry: GlobalSearchEntry) {
    if (entry.kind === "analysis" && entry.analysisId) {
      await openStoredAnalysis(entry.analysisId);
      setView("dashboard");
      close();
      return;
    }
    if (entry.query) setFilters({ ...EMPTY_FILTERS, query: entry.query });
    setView(entry.targetView);
    close();
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + step + results.length) % results.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) void select(selected);
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="global-search-trigger" onClick={() => setOpen(true)} aria-label="Abrir búsqueda global">
        <Search className="size-4" aria-hidden="true" />
        <span>Buscar personas, conceptos o documentos</span>
        <kbd>⌘ K</kbd>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="global-search-backdrop"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Búsqueda global"
              className="global-search-dialog"
              initial={reduceMotion ? false : { opacity: 0, y: -10, scale: .985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: .99 }}
              transition={{ duration: reduceMotion ? 0 : .18, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="global-search-input-row">
                <Search className="size-5" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  placeholder="Escribe una matrícula, persona, concepto o archivo…"
                  aria-label="Buscar"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="global-search-results"
                  aria-activedescendant={results[activeIndex]?.id ? `global-search-${results[activeIndex].id}` : undefined}
                />
                <button type="button" className="app-icon-button" onClick={close} aria-label="Cerrar búsqueda"><X className="size-4" /></button>
              </div>

              <div id="global-search-results" className="global-search-results" role="listbox">
                {!query.trim() ? (
                  <div className="global-search-empty">
                    <Sparkles className="size-5" aria-hidden="true" />
                    <strong>Búsqueda privada en tus datos</strong>
                    <p>Los resultados se calculan localmente y nunca salen del navegador.</p>
                  </div>
                ) : groups.length ? groups.map((group) => (
                  <section key={group.kind} className="global-search-group" aria-label={group.label}>
                    <p>{group.label}</p>
                    {group.entries.map((entry) => {
                      const Icon = ICONS[entry.kind];
                      const indexInResults = results.findIndex((item) => item.id === entry.id);
                      const active = indexInResults === activeIndex;
                      return (
                        <button
                          id={`global-search-${entry.id}`}
                          key={entry.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={active ? "global-search-result global-search-result--active" : "global-search-result"}
                          onMouseEnter={() => setActiveIndex(indexInResults)}
                          onClick={() => void select(entry)}
                        >
                          <span className="global-search-result__icon"><Icon className="size-4" /></span>
                          <span className="global-search-result__copy"><strong>{entry.title}</strong><small>{entry.subtitle}</small></span>
                        </button>
                      );
                    })}
                  </section>
                )) : (
                  <div className="global-search-empty"><Search className="size-5" /><strong>Sin resultados</strong><p>Prueba con otra matrícula, nombre, concepto o archivo.</p></div>
                )}
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
