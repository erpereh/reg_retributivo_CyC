import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCES,
  readThemePreferences,
  resolveEffectiveTheme,
  writeThemePreferences,
} from "@/lib/theme/themePreferences";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe("themePreferences", () => {
  it("uses system and violet by default", () => {
    expect(readThemePreferences(memoryStorage())).toEqual(DEFAULT_THEME_PREFERENCES);
  });

  it("rejects unsupported values and persists supported values", () => {
    const storage = memoryStorage();
    storage.setItem("retributivo.appearance.v1", JSON.stringify({ mode: "sepia", accent: "lime" }));
    expect(readThemePreferences(storage)).toEqual(DEFAULT_THEME_PREFERENCES);
    writeThemePreferences({ mode: "dark", accent: "emerald" }, storage);
    expect(readThemePreferences(storage)).toEqual({ mode: "dark", accent: "emerald" });
  });

  it("resolves system mode from the operating system", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });
});
