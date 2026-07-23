"use client";

import { Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { ACCENT_COLORS, APPEARANCE_MODES, type AccentColor, type AppearanceMode } from "@/lib/theme/themePreferences";
import { cn } from "@/lib/utils/classNames";

const MODE_COPY: Record<AppearanceMode, { label: string; description: string; icon: typeof Monitor }> = {
  system: { label: "Sistema", description: "Sigue la apariencia del dispositivo.", icon: Monitor },
  light: { label: "Claro", description: "Interfaz luminosa para trabajar de día.", icon: Sun },
  dark: { label: "Oscuro", description: "Reduce el brillo en entornos con poca luz.", icon: Moon },
};

const ACCENT_COPY: Record<AccentColor, { label: string; color: string }> = {
  violet: { label: "Violeta", color: "#6d5dfc" },
  blue: { label: "Azul", color: "#2878f0" },
  emerald: { label: "Esmeralda", color: "#15956d" },
  orange: { label: "Naranja", color: "#df7a24" },
  rose: { label: "Rosa", color: "#d64f82" },
};

export function AppearanceSettings() {
  const { mode, accent, effectiveTheme, setMode, setAccent, resetTheme } = useTheme();
  const reduceMotion = useReducedMotion();

  return (
    <div className="appearance-settings">
      <section className="appearance-settings__section" aria-labelledby="appearance-mode-title">
        <div className="appearance-settings__heading">
          <div>
            <p className="appearance-settings__eyebrow">Tema</p>
            <h2 id="appearance-mode-title">Modo de visualización</h2>
            <p>Elige cómo quieres ver la aplicación. La opción se guarda en este navegador.</p>
          </div>
          <span className="appearance-settings__status">Activo: {effectiveTheme === "dark" ? "oscuro" : "claro"}</span>
        </div>

        <div className="appearance-mode-grid" role="radiogroup" aria-label="Modo de visualización">
          {APPEARANCE_MODES.map((value) => {
            const item = MODE_COPY[value];
            const Icon = item.icon;
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn("appearance-mode-card", selected && "appearance-mode-card--selected")}
                onClick={() => setMode(value)}
              >
                <span className="appearance-mode-card__icon"><Icon className="size-5" /></span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                {selected ? <Check className="appearance-mode-card__check size-4" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section className="appearance-settings__section" aria-labelledby="appearance-accent-title">
        <div className="appearance-settings__heading">
          <div>
            <p className="appearance-settings__eyebrow">Color principal</p>
            <h2 id="appearance-accent-title">Acento de la interfaz</h2>
            <p>Se aplica a botones, navegación, focos, gráficos y elementos activos.</p>
          </div>
        </div>

        <div className="accent-grid" role="radiogroup" aria-label="Color de acento">
          {ACCENT_COLORS.map((value) => {
            const item = ACCENT_COPY[value];
            const selected = accent === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={cn("accent-card", selected && "accent-card--selected")}
                onClick={() => setAccent(value)}
              >
                <span className="accent-card__swatch" style={{ backgroundColor: item.color }} aria-hidden="true">
                  {selected ? <Check className="size-4" /> : null}
                </span>
                <span><strong>{item.label}</strong><small>{value === "violet" ? "Predeterminado" : "Acento alternativo"}</small></span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="appearance-preview" aria-label="Previsualización del tema">
        <div className="appearance-preview__top">
          <div><p>Vista previa</p><strong>Resumen del análisis</strong></div>
          <span>Actualizado ahora</span>
        </div>
        <div className="appearance-preview__metrics">
          {["Personas", "Cuadradas", "Revisar"].map((label, index) => (
            <motion.div key={label} initial={reduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .04 }}>
              <small>{label}</small><strong>{["—", "—", "—"][index]}</strong>
            </motion.div>
          ))}
        </div>
        <div className="appearance-preview__action"><span /><span /><button type="button">Acción principal</button></div>
      </section>

      <div className="appearance-settings__footer">
        <p>La apariencia no modifica los datos ni vuelve a ejecutar el análisis.</p>
        <button type="button" className="btn-secondary" onClick={resetTheme}><RotateCcw className="size-4" />Restablecer apariencia</button>
      </div>
    </div>
  );
}
