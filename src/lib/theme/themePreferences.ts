export type AppearanceMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";
export type AccentColor = "violet" | "blue" | "emerald" | "orange" | "rose";

export interface ThemePreferences {
  readonly mode: AppearanceMode;
  readonly accent: AccentColor;
}

export const THEME_STORAGE_KEY = "retributivo.appearance.v1";
export const APPEARANCE_MODES: readonly AppearanceMode[] = ["system", "light", "dark"];
export const ACCENT_COLORS: readonly AccentColor[] = ["violet", "blue", "emerald", "orange", "rose"];
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = { mode: "system", accent: "violet" };

function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === "string" && APPEARANCE_MODES.includes(value as AppearanceMode);
}

function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && ACCENT_COLORS.includes(value as AccentColor);
}

export function normalizeThemePreferences(value: unknown): ThemePreferences {
  if (!value || typeof value !== "object") return DEFAULT_THEME_PREFERENCES;
  const candidate = value as Partial<ThemePreferences>;
  return {
    mode: isAppearanceMode(candidate.mode) ? candidate.mode : DEFAULT_THEME_PREFERENCES.mode,
    accent: isAccentColor(candidate.accent) ? candidate.accent : DEFAULT_THEME_PREFERENCES.accent,
  };
}

export function readThemePreferences(
  storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): ThemePreferences {
  if (!storage) return DEFAULT_THEME_PREFERENCES;
  try {
    return normalizeThemePreferences(JSON.parse(storage.getItem(THEME_STORAGE_KEY) ?? "null"));
  } catch {
    return DEFAULT_THEME_PREFERENCES;
  }
}

export function writeThemePreferences(
  value: ThemePreferences,
  storage: Storage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, JSON.stringify(normalizeThemePreferences(value)));
  } catch {
    // Appearance preferences are optional; storage failures must never block the app.
  }
}

export function resolveEffectiveTheme(mode: AppearanceMode, systemDark: boolean): EffectiveTheme {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}
