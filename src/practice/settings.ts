// Per-device editor settings in localStorage. See specs/practice-editor.md, "Settings".
import { useCallback, useState } from "react";
import { applyTheme, readThemeSetting, type ThemeSetting } from "../app/theme.ts";
import { useMediaQuery } from "../shared/useMediaQuery.ts";

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 24;
const DEFAULT_FONT_SIZE = 14;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Settings just won't persist.
  }
};

const readFontSize = (): number => {
  const stored = Number(read("minji:fontSize"));
  return Number.isInteger(stored) && stored >= MIN_FONT_SIZE && stored <= MAX_FONT_SIZE
    ? stored
    : DEFAULT_FONT_SIZE;
};

export interface EditorSettings {
  fontSize: number;
  setFontSize: (size: number) => void;
  formatOnSave: boolean;
  setFormatOnSave: (enabled: boolean) => void;
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
  /** The theme in effect after resolving "system". */
  resolvedTheme: "light" | "dark";
}

export const useEditorSettings = (): EditorSettings => {
  const [fontSize, setFontSizeState] = useState(readFontSize);
  const [formatOnSave, setFormatOnSaveState] = useState(
    () => read("minji:formatOnSave") !== "false",
  );
  const [theme, setThemeState] = useState(readThemeSetting);
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  const setFontSize = useCallback((size: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
    setFontSizeState(clamped);
    write("minji:fontSize", String(clamped));
  }, []);

  const setFormatOnSave = useCallback((enabled: boolean) => {
    setFormatOnSaveState(enabled);
    write("minji:formatOnSave", String(enabled));
  }, []);

  const setTheme = useCallback((next: ThemeSetting) => {
    setThemeState(next);
    write("minji:theme", next);
    applyTheme(next);
  }, []);

  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  return {
    fontSize,
    setFontSize,
    formatOnSave,
    setFormatOnSave,
    theme,
    setTheme,
    resolvedTheme,
  };
};

export const rememberLanguage = (language: string): void => write("minji:lastLanguage", language);
