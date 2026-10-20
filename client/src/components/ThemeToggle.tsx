import { useTheme } from '../hooks/useTheme';
import { THEME_LABELS } from '../lib/theme';

const ICONS = { system: '◐', light: '☀', dark: '☾' } as const;

/** Cycles system → light → dark. */
export function ThemeToggle() {
  const [pref, cycle] = useTheme();
  return (
    <button className="iconbtn" onClick={cycle} title={`${THEME_LABELS[pref]} (click to change)`} aria-label={THEME_LABELS[pref]}>
      {ICONS[pref]}
    </button>
  );
}
