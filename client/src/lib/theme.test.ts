import { expect, test } from 'vitest';
import { applyTheme, nextTheme, readTheme, resolveTheme, THEME_KEY, writeTheme } from './theme';

function memoryStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

test('readTheme falls back to system for missing, invalid or throwing storage', () => {
  expect(readTheme(null)).toBe('system');
  expect(readTheme(memoryStorage({ [THEME_KEY]: 'purple' }))).toBe('system');
  expect(readTheme(memoryStorage({ [THEME_KEY]: 'dark' }))).toBe('dark');
  const throwing = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
    removeItem: () => {},
  };
  expect(readTheme(throwing)).toBe('system');
});

test('writeTheme stores light and dark and clears system', () => {
  const s = memoryStorage();
  writeTheme(s, 'dark');
  expect(s.map.get(THEME_KEY)).toBe('dark');
  writeTheme(s, 'system');
  expect(s.map.has(THEME_KEY)).toBe(false);
});

test('nextTheme cycles system → light → dark → system', () => {
  expect(nextTheme('system')).toBe('light');
  expect(nextTheme('light')).toBe('dark');
  expect(nextTheme('dark')).toBe('system');
});

test('resolveTheme follows the OS only for system', () => {
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
  expect(resolveTheme('light', true)).toBe('light');
});

test('applyTheme sets and clears the data attribute', () => {
  const root = { dataset: {} as DOMStringMap };
  applyTheme(root, 'dark');
  expect(root.dataset.theme).toBe('dark');
  applyTheme(root, 'system');
  expect(root.dataset.theme).toBeUndefined();
  applyTheme(null, 'light');
});
