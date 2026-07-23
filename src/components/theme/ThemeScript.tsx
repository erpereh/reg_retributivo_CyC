import { ACCENT_COLORS, APPEARANCE_MODES, DEFAULT_THEME_PREFERENCES, THEME_STORAGE_KEY } from "@/lib/theme/themePreferences";

export function ThemeScript() {
  const script = `(() => {
    const defaults = ${JSON.stringify(DEFAULT_THEME_PREFERENCES)};
    const modes = ${JSON.stringify(APPEARANCE_MODES)};
    const accents = ${JSON.stringify(ACCENT_COLORS)};
    let value = defaults;
    try {
      const parsed = JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) || "null") || {};
      value = {
        mode: modes.includes(parsed.mode) ? parsed.mode : defaults.mode,
        accent: accents.includes(parsed.accent) ? parsed.accent : defaults.accent,
      };
    } catch {}
    const dark = value.mode === "dark" || (value.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.accent = value.accent;
    root.style.colorScheme = dark ? "dark" : "light";
  })();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
