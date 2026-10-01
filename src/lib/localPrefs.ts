/**
 * Preferencias del navegador (sesión, tema, columnas). Prefijo propio del producto: "bos.".
 * Migración: versiones anteriores usaban otro prefijo; se leen una vez, se copian y se borran.
 */
const PREFIX = "bos.";
const LEGACY_PREFIX = "prfmn."; // solo migración de datos locales previos al cambio de nombre (2026-10-01)

export function getPref(key: string): string | null {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v !== null) return v;
    const legacy = localStorage.getItem(LEGACY_PREFIX + key);
    if (legacy !== null) {
      localStorage.setItem(PREFIX + key, legacy);
      localStorage.removeItem(LEGACY_PREFIX + key);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* modo privado / almacenamiento bloqueado */
  }
}
