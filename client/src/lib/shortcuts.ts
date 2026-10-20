/**
 * Keyboard shortcuts. Alt is the app modifier because browsers reserve most
 * Ctrl combinations (Ctrl+N opens a window, Ctrl+Shift+I the devtools) and a
 * page cannot override them.
 */
export type ShortcutAction =
  | { type: 'new-tab' }
  | { type: 'settings' }
  | { type: 'help' }
  | { type: 'escape' }
  | { type: 'next-tab' }
  | { type: 'prev-tab' }
  | { type: 'next-attention' }
  | { type: 'prev-attention' }
  | { type: 'toggle-details' }
  | { type: 'jump'; index: number };

export interface KeyLike {
  key: string;
  code?: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Alt N', what: 'New tab' },
  { keys: 'Alt S', what: 'Settings (again to go back)' },
  { keys: 'Alt I', what: 'Show or hide the details pane' },
  { keys: 'Alt ↓ / Alt ↑', what: 'Next / previous tab' },
  { keys: 'Alt Shift ↓ / ↑', what: 'Next / previous tab that needs you' },
  { keys: 'Alt 1 … 9', what: 'Jump to the nth tab in the list' },
  { keys: 'Enter', what: 'Send (Shift Enter for a new line)' },
  { keys: 'Esc', what: 'Close this help or an open form' },
  { keys: 'Alt /', what: 'This help' },
];

/** The action a key event maps to, or null. */
export function shortcutAction(e: KeyLike): ShortcutAction | null {
  if (e.key === 'Escape') return { type: 'escape' };
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const code = e.code ?? '';
  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    if (key === 'arrowdown') return { type: 'next-attention' };
    if (key === 'arrowup') return { type: 'prev-attention' };
    return null;
  }
  if (key === 'arrowdown') return { type: 'next-tab' };
  if (key === 'arrowup') return { type: 'prev-tab' };
  if (code === 'KeyN' || key === 'n') return { type: 'new-tab' };
  if (code === 'KeyS' || key === 's') return { type: 'settings' };
  if (code === 'KeyI' || key === 'i') return { type: 'toggle-details' };
  if (code === 'Slash' || key === '/') return { type: 'help' };
  const digit = /^Digit([1-9])$/.exec(code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null);
  if (digit) return { type: 'jump', index: Number(digit) - 1 };
  return null;
}
