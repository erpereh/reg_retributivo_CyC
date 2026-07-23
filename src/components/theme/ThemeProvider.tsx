"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_THEME_PREFERENCES,
  readThemePreferences,
  resolveEffectiveTheme,
  writeThemePreferences,
  type AccentColor,
  type AppearanceMode,
  type EffectiveTheme,
  type ThemePreferences,
} from "@/lib/theme/themePreferences";

export interface ThemeContextValue extends ThemePreferences {
  readonly effectiveTheme: EffectiveTheme;
  readonly setMode: (mode: AppearanceMode) => void;
  readonly setAccent: (accent: AccentColor) => void;
  readonly cycleTheme: () => void;
  readonly resetTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function currentSystemDark(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
}

function applyTheme(theme: EffectiveTheme, accent: AccentColor): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  root.style.colorScheme = theme;
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preferences, setPreferences] = useState<ThemePreferences>(() => readThemePreferences());
  const [systemDark, setSystemDark] = useState(currentSystemDark);
  const effectiveTheme = resolveEffectiveTheme(preferences.mode, systemDark);

  useEffect(() => {
    if (preferences.mode !== "system" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = () => setSystemDark(media.matches);
    updateSystemTheme();
    media.addEventListener?.("change", updateSystemTheme);
    return () => media.removeEventListener?.("change", updateSystemTheme);
  }, [preferences.mode]);

  useEffect(() => {
    applyTheme(effectiveTheme, preferences.accent);
    writeThemePreferences(preferences);
  }, [effectiveTheme, preferences]);

  const update = useCallback((patch: Partial<ThemePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const setMode = useCallback((mode: AppearanceMode) => update({ mode }), [update]);
  const setAccent = useCallback((accent: AccentColor) => update({ accent }), [update]);
  const resetTheme = useCallback(() => setPreferences(DEFAULT_THEME_PREFERENCES), []);
  const cycleTheme = useCallback(
    () => setMode(effectiveTheme === "dark" ? "light" : "dark"),
    [effectiveTheme, setMode],
  );

  const value = useMemo<ThemeContextValue>(() => ({
    ...preferences,
    effectiveTheme,
    setMode,
    setAccent,
    cycleTheme,
    resetTheme,
  }), [cycleTheme, effectiveTheme, preferences, resetTheme, setAccent, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme debe usarse dentro de ThemeProvider");
  return value;
}
