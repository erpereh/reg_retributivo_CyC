"use client";

import {
  Archive,
  Bot,
  ChevronLeft,
  Download,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Sparkles,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import { ToastViewport } from "@/components/common/ToastViewport";
import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";

interface NavigationItem {
  readonly id: AppView;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const NAVIGATION: readonly NavigationItem[] = [
  { id: "dashboard", label: "Dashboard", description: "Resumen y nuevo análisis", icon: LayoutDashboard },
  { id: "personas", label: "Personas", description: "Comparativa individual", icon: UsersRound },
  { id: "cuadre-excel", label: "Cuadre Reg.", description: "Validación del registro", icon: FileSpreadsheet },
  { id: "agrupaciones", label: "Agrupaciones", description: "Análisis agregado", icon: Archive },
  { id: "asistente", label: "Asistente", description: "Consulta con contexto", icon: Bot },
  { id: "historial", label: "Historial", description: "Análisis guardados", icon: History },
  { id: "ajustes", label: "Ajustes", description: "Parámetros y privacidad", icon: Settings },
] as const;

function Brand({ collapsed }: Readonly<{ collapsed: boolean }>) {
  return (
    <div className="app-brand">
      <span className="app-brand__mark" aria-hidden="true">
        <Sparkles className="size-5" />
      </span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="app-brand__copy">
            <strong>Registro Retributivo</strong>
            <small>Control y comparativa salarial</small>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, onCollapse, onCloseMobile }: Readonly<{ collapsed: boolean; mobileOpen: boolean; onCollapse: () => void; onCloseMobile: () => void }>) {
  const { view, setView } = useAppState();
  const reduceMotion = useReducedMotion();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectAt(index: number) {
    const item = NAVIGATION[index];
    if (!item) return;
    setView(item.id);
    refs.current[index]?.focus();
    onCloseMobile();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectAt(0);
    if (event.key === "End") return selectAt(NAVIGATION.length - 1);
    selectAt((index + (event.key === "ArrowDown" ? 1 : -1) + NAVIGATION.length) % NAVIGATION.length);
  }

  return (
    <aside className={cn("app-sidebar", collapsed && "app-sidebar--collapsed", mobileOpen && "app-sidebar--mobile-open")} aria-label="Navegación de la aplicación">
      <div className="app-sidebar__header">
        <Brand collapsed={collapsed} />
        <button type="button" className="app-icon-button app-sidebar__mobile-close" onClick={onCloseMobile} aria-label="Cerrar navegación"><X className="size-4" /></button>
      </div>

      <div className="app-sidebar__context" aria-label="Espacio de trabajo">
        <span className="app-sidebar__context-icon">RR</span>
        {!collapsed ? <span className="min-w-0"><strong>Comparativa retributiva</strong><small>Procesamiento local y privado</small></span> : null}
      </div>

      <nav className="app-nav" role="tablist" aria-label="Vistas principales" aria-orientation="vertical">
        {!collapsed ? <p className="app-nav__label">Navegación</p> : null}
        {NAVIGATION.map((item, index) => {
          const active = view === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              tabIndex={active ? 0 : -1}
              className={cn("app-nav__item", active && "app-nav__item--active")}
              onClick={() => selectAt(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              title={collapsed ? item.label : undefined}
            >
              {active ? <motion.span layoutId="sidebar-active-item" className="app-nav__active" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 36 }} /> : null}
              <Icon className="app-nav__icon" aria-hidden="true" />
              {!collapsed ? <span className="app-nav__copy" aria-hidden="true"><strong>{item.label}</strong><small>{item.description}</small></span> : null}
              {item.id === "asistente" && !collapsed ? <span className="app-nav__badge" aria-hidden="true">IA</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="app-sidebar__footer">
        <div className={cn("app-privacy-note", collapsed && "app-privacy-note--compact")}>
          <span className="app-privacy-note__dot" />
          {!collapsed ? <span><strong>Datos protegidos</strong><small>Sin cuentas ni datos bancarios</small></span> : null}
        </div>
        <button type="button" className="app-collapse-button" onClick={onCollapse} aria-label={collapsed ? "Ampliar navegación" : "Contraer navegación"}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>Contraer menú</span> : null}
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onOpenMobile }: Readonly<{ onOpenMobile: () => void }>) {
  const { view, result, exporting, exportActiveAnalysis, resetForNewAnalysis } = useAppState();
  const current = useMemo(() => NAVIGATION.find((item) => item.id === view) ?? NAVIGATION[0], [view]);

  return (
    <header className="app-topbar" data-surface="floating-header">
      <div className="app-topbar__title">
        <button type="button" className="app-icon-button app-topbar__menu" onClick={onOpenMobile} aria-label="Abrir navegación"><Menu className="size-5" /></button>
        <span className="app-topbar__crumb">Registro Retributivo</span>
        <ChevronLeft className="size-3.5 rotate-180 text-muted/60" aria-hidden="true" />
        <strong>{current.label}</strong>
      </div>
      <div className="app-topbar__actions">
        <span className="app-system-status" aria-label="Estado del sistema"><span /> Sistema listo</span>
        <button type="button" className="btn-secondary app-topbar__secondary" disabled={!result || exporting} onClick={() => void exportActiveAnalysis()}>
          <Download className="size-4" aria-hidden="true" /><span>{exporting ? "Exportando…" : "Exportar Excel"}</span>
        </button>
        <button type="button" className="btn-primary" onClick={resetForNewAnalysis}><Plus className="size-4" aria-hidden="true" /><span>Nuevo análisis</span></button>
      </div>
    </header>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { hydrating, view, toasts, dismissToast } = useAppState();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (previousView.current !== view) {
      const activeElement = document.activeElement;
      const preserveTabFocus = activeElement instanceof HTMLElement && activeElement.getAttribute("role") === "tab";
      if (!preserveTabFocus) mainRef.current?.focus({ preventScroll: true });
      const frame = window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
      previousView.current = view;
      return () => window.cancelAnimationFrame(frame);
    }
    previousView.current = view;
  }, [view]);

  return (
    <div data-slot="app-shell" data-surface="canvas" className={cn("app-frame", collapsed && "app-frame--collapsed", view === "asistente" && "app-frame--assistant")}>
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onCollapse={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <AnimatePresence>
        {mobileOpen ? <motion.button type="button" aria-label="Cerrar navegación" className="app-sidebar-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} /> : null}
      </AnimatePresence>
      <section className="app-workspace" data-slot="app-content" data-surface="transparent">
        <Topbar onOpenMobile={() => setMobileOpen(true)} />
        <main ref={mainRef} className={cn("app-main", view === "asistente" && "app-main--assistant")} tabIndex={-1}>
          {hydrating ? <DashboardSkeleton /> : (
            <motion.div key={view} initial={reduceMotion ? false : { opacity: 0, y: 10, filter: "blur(2px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }} className={view === "asistente" ? "flex min-h-0 flex-1 flex-col" : undefined}>
              {children}
            </motion.div>
          )}
        </main>
      </section>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
