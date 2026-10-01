import { getPref, setPref } from "@/lib/localPrefs";

export type ThemePref = "light" | "dark" | "system";

export function getThemePref(): ThemePref {
  return (getPref("theme") as ThemePref) || "light";
}

export function applyTheme(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  setPref("theme", pref);
}
