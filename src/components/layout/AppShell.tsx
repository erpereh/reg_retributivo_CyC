"use client";

import {
  Archive,
  Bot,
  Building2,
  Download,
  FileSpreadsheet,
  History,
  Home,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  Tags,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { useAppState } from "@/components/app/AppState";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import { ToastViewport } from "@/components/common/ToastViewport";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { AppView } from "@/lib/types";
import { cn } from "@/lib/utils/classNames";

interface NavigationItem {
  readonly id: AppView;
  readonly label: string;
  readonly accessibleLabel?: string;
  readonly icon: LucideIcon;
}

const OPERATIVE_NAVIGATION: readonly NavigationItem[] = [
  { id: "dashboard", label: "Inicio", accessibleLabel: "Dashboard", icon: Home },
  { id: "personas", label: "Personas", icon: UsersRound },
  { id: "conceptos", label: "Conceptos", icon: Tags },
  { id: "cuadre-excel", label: "Cuadre del registro", accessibleLabel: "Cuadre Reg.", icon: FileSpreadsheet },
  { id: "agrupaciones", label: "Agrupaciones", icon: Archive },
  { id: "historial", label: "Historial", icon: History },
] as const;

const INTELLIGENCE_NAVIGATION: readonly NavigationItem[] = [
  { id: "asistente", label: "Asistente", icon: Bot },
] as const;

const SETTINGS_ITEM: NavigationItem = { id: "ajustes", label: "Ajustes", icon: Settings };
const NAVIGATION = [...OPERATIVE_NAVIGATION, ...INTELLIGENCE_NAVIGATION, SETTINGS_ITEM] as const;
const SIDEBAR_STORAGE_KEY = "retributivo.sidebar.collapsed.v1";

function readCollapsedPreference(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
}

function formatAnalysisDate(value?: string): string {
  if (!value) return "Sin análisis activo";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function Brand({ collapsed }: Readonly<{ collapsed: boolean }>) {
  return (
    <div className="app-brand">
      <span className="app-brand__mark" aria-hidden="true"><Building2 className="size-5" /></span>
      <AnimatePresence initial={false}>
        {!collapsed ? (
          <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="app-brand__copy">
            <strong>Retributivo</strong>
            <small>Control salarial</small>
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NavGroup({
  label,
  items,
  collapsed,
  view,
  selectAt,
  onKeyDown,
  refs,
}: Readonly<{
  label: string;
  items: readonly NavigationItem[];
  collapsed: boolean;
  view: AppView;
  selectAt: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  refs: MutableRefObject<Array<HTMLButtonElement | null>>;
}>) {
  const reduceMotion = useReducedMotion();
  return (
    <div className="app-nav__group">
      {!collapsed ? <p className="app-nav__label">{label}</p> : null}
      {items.map((item) => {
        const index = NAVIGATION.findIndex((entry) => entry.id === item.id);
        const active = view === item.id;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={item.accessibleLabel ?? item.label}
            tabIndex={active ? 0 : -1}
            className={cn("app-nav__item", active && "app-nav__item--active")}
            onClick={() => selectAt(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            title={collapsed ? item.label : undefined}
          >
            {active ? <motion.span layoutId="sidebar-active-item" className="app-nav__active" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 36 }} /> : null}
            <Icon className="app-nav__icon" aria-hidden="true" />
            {!collapsed ? <span className="app-nav__copy"><strong>{item.label}</strong></span> : null}
            {item.id === "asistente" && !collapsed ? <span className="app-nav__badge" aria-hidden="true">IA</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({
  collapsed,
  mobileOpen,
  onCollapse,
  onCloseMobile,
}: Readonly<{ collapsed: boolean; mobileOpen: boolean; onCollapse: () => void; onCloseMobile: () => void }>) {
  const { view, setView, activeAnalysis } = useAppState();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const people = activeAnalysis?.result.summary.uniquePeople ?? 0;
  const documents = activeAnalysis ? activeAnalysis.pdfCount + 1 : 0;

  function selectAt(index: number) {
    const item = NAVIGATION[index];
    if (!item) return;
    setView(item.id);
    refs.current[index]?.focus();
    onCloseMobile();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return selectAt(0);
    if (event.key === "End") return selectAt(NAVIGATION.length - 1);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    selectAt((index + (forward ? 1 : -1) + NAVIGATION.length) % NAVIGATION.length);
  }

  return (
    <aside className={cn("app-sidebar", collapsed && "app-sidebar--collapsed", mobileOpen && "app-sidebar--mobile-open")} aria-label="Navegación de la aplicación">
      <div className="app-sidebar__header">
        <Brand collapsed={collapsed} />
        <button type="button" className="app-icon-button app-sidebar__mobile-close" onClick={onCloseMobile} aria-label="Cerrar navegación"><X className="size-4" /></button>
      </div>

      <div className="app-sidebar__context" aria-label="Contexto del análisis">
        <span className="app-sidebar__context-icon">RR</span>
        {!collapsed ? (
          <span className="min-w-0">
            <small>ANÁLISIS ACTUAL</small>
            <strong>{activeAnalysis?.registroFileName ?? "Sin análisis cargado"}</strong>
            <em>{activeAnalysis ? `${activeAnalysis.pdfCount} recibos · Registro retributivo` : "Carga los archivos para comenzar"}</em>
          </span>
        ) : null}
      </div>

      <nav className="app-nav" role="tablist" aria-label="Vistas principales" aria-orientation="vertical">
        <NavGroup label="Operativa" items={OPERATIVE_NAVIGATION} collapsed={collapsed} view={view} selectAt={selectAt} onKeyDown={onKeyDown} refs={refs} />
        <NavGroup label="Inteligencia" items={INTELLIGENCE_NAVIGATION} collapsed={collapsed} view={view} selectAt={selectAt} onKeyDown={onKeyDown} refs={refs} />
      </nav>

      <div className="app-sidebar__footer">
        <button
          type="button"
          role="tab"
          aria-selected={view === SETTINGS_ITEM.id}
          className={cn("app-nav__item app-nav__settings", view === SETTINGS_ITEM.id && "app-nav__item--active")}
          onClick={() => setView(SETTINGS_ITEM.id)}
          title={collapsed ? SETTINGS_ITEM.label : undefined}
        >
          {view === SETTINGS_ITEM.id ? <span className="app-nav__active" /> : null}
          <Settings className="app-nav__icon" aria-hidden="true" />
          {!collapsed ? <span className="app-nav__copy"><strong>Ajustes</strong></span> : null}
        </button>

        <div className={cn("app-analysis-note", collapsed && "app-analysis-note--compact")}>
          <span className="app-analysis-note__avatar"><FileSpreadsheet className="size-4" /></span>
          {!collapsed ? (
            <span>
              <strong>{activeAnalysis ? "Análisis activo" : "Sin análisis activo"}</strong>
              <small>{activeAnalysis ? `${people} personas · ${documents} documentos` : "No hay datos cargados"}</small>
              <em>{activeAnalysis ? `Actualizado ${formatAnalysisDate(activeAnalysis.createdAt)}` : "Carga un análisis para empezar"}</em>
            </span>
          ) : null}
          {!collapsed && activeAnalysis ? <span className="app-analysis-note__status" aria-label="Activo" /> : null}
        </div>

        <button type="button" className="app-collapse-button" onClick={onCollapse} aria-label={collapsed ? "Ampliar navegación" : "Contraer navegación"}>
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed ? <span>Contraer menú</span> : null}
        </button>
      </div>
    </aside>
  );
}

function Topbar({ onOpenMobile, onToggleSidebar }: Readonly<{ onOpenMobile: () => void; onToggleSidebar: () => void }>) {
  const { result, exporting, exportActiveAnalysis, setView } = useAppState();
  const { effectiveTheme, cycleTheme } = useTheme();

  return (
    <header className="app-topbar" data-surface="floating-header">
      <div className="app-topbar__identity">
        <button type="button" className="app-icon-button app-topbar__menu" onClick={onOpenMobile} aria-label="Abrir navegación"><Menu className="size-5" /></button>
        <button type="button" className="app-icon-button app-topbar__collapse" onClick={onToggleSidebar} aria-label="Contraer o ampliar navegación"><PanelLeftClose className="size-4" /></button>
      </div>

      <div className="app-topbar__search"><GlobalSearch /></div>

      <div className="app-topbar__actions">
        <button type="button" className="app-icon-button" onClick={cycleTheme} aria-label={effectiveTheme === "dark" ? "Activar modo claro" : "Activar modo oscuro"} title={effectiveTheme === "dark" ? "Modo claro" : "Modo oscuro"}>
          {effectiveTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button type="button" className="btn-secondary app-topbar__assistant" onClick={() => setView("asistente")}>
          <Bot className="size-4" /><span>Preguntar al asistente</span>
        </button>
        <button type="button" className="btn-primary app-topbar__export" aria-label="Exportar Excel" disabled={!result || exporting} onClick={() => void exportActiveAnalysis()}>
          <Download className="size-4" aria-hidden="true" /><span>{exporting ? "Exportando…" : "Exportar"}</span>
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { hydrating, view, toasts, dismissToast } = useAppState();
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const previousView = useRef(view);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (previousView.current !== view) mainRef.current?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view]);

  return (
    <div data-slot="app-shell" data-surface="canvas" className={cn("app-frame theme-transition", collapsed && "app-frame--collapsed", view === "asistente" && "app-frame--assistant")}>
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onCollapse={() => setCollapsed((value) => !value)} onCloseMobile={() => setMobileOpen(false)} />
      <AnimatePresence>
        {mobileOpen ? <motion.button type="button" aria-label="Cerrar navegación" className="app-sidebar-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} /> : null}
      </AnimatePresence>
      <section className="app-workspace" data-slot="app-content" data-surface="transparent">
        <Topbar onOpenMobile={() => setMobileOpen(true)} onToggleSidebar={() => setCollapsed((value) => !value)} />
        <main ref={mainRef} className={cn("app-main", view === "asistente" && "app-main--assistant")} tabIndex={-1}>
          {hydrating ? <DashboardSkeleton /> : (
            <motion.div key={view} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .18, ease: [0.22, 1, 0.36, 1] }} className={view === "asistente" ? "flex min-h-0 flex-1 flex-col" : undefined}>
              {children}
            </motion.div>
          )}
        </main>
      </section>
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
