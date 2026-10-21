import { useCallback, useEffect, useState } from 'react';
import { applyTheme, isThemePref, nextTheme, readTheme, writeTheme, type ThemePref } from '../lib/theme';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A `?theme=light|dark|system` query parameter wins over the stored preference for this page load. */
function queryTheme(): ThemePref | null {
  try {
    const v = new URLSearchParams(location.search).get('theme');
    return isThemePref(v) ? v : null;
  } catch {
    return null;
  }
}

/** The theme preference (system / light / dark), applied to <html data-theme> and kept in localStorage. */
export function useTheme(): [ThemePref, () => void] {
  const [pref, setPref] = useState<ThemePref>(() => queryTheme() ?? readTheme(storage()));
  useEffect(() => applyTheme(document.documentElement, pref), [pref]);
  const cycle = useCallback(() => {
    setPref((p) => {
      const n = nextTheme(p);
      writeTheme(storage(), n);
      return n;
    });
  }, []);
  return [pref, cycle];
}
