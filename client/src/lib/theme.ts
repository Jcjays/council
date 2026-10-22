export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'council.theme';
const ORDER: ThemePref[] = ['system', 'light', 'dark'];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** The stored preference, or "system" when nothing valid is stored or storage is unavailable. */
export function readTheme(storage: StorageLike | null | undefined): ThemePref {
  try {
    const v = storage?.getItem(THEME_KEY);
    return isThemePref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function writeTheme(storage: StorageLike | null | undefined, pref: ThemePref): void {
  try {
    if (pref === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, pref);
  } catch {
    /* private mode or blocked storage: the preference lives for this page only */
  }
}

/** The preference after one press of the toggle: system → light → dark → system. */
export function nextTheme(pref: ThemePref): ThemePref {
  return ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length] ?? 'system';
}

/** What a preference resolves to, given whether the OS prefers dark. */
export function resolveTheme(pref: ThemePref, osDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return osDark ? 'dark' : 'light';
  return pref;
}

export const THEME_LABELS: Record<ThemePref, string> = { system: 'Theme: follows the system', light: 'Theme: light', dark: 'Theme: dark' };

/** Sets or clears data-theme on the document root; the stylesheet resolves the rest with light-dark(). */
export function applyTheme(root: { dataset: DOMStringMap } | null | undefined, pref: ThemePref): void {
  if (!root) return;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}
