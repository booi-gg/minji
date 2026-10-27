export type ThemeSetting = "system" | "light" | "dark";

const THEME_KEY = "minji:theme";

export const readThemeSetting = (): ThemeSetting => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
};

/** Sets data-theme on <html>; "system" removes it so the media query decides. */
export const applyTheme = (setting: ThemeSetting): void => {
  if (setting === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = setting;
};

export const applyStoredTheme = (): void => applyTheme(readThemeSetting());
