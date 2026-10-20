import { expect, test } from 'vitest';
import { shortcutAction, type KeyLike } from './shortcuts';

function key(over: Partial<KeyLike>): KeyLike {
  return { key: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over };
}

test('Escape maps regardless of modifiers', () => {
  expect(shortcutAction(key({ key: 'Escape' }))).toEqual({ type: 'escape' });
  expect(shortcutAction(key({ key: 'Escape', ctrlKey: true }))).toEqual({ type: 'escape' });
});

test('Alt combinations map to app actions', () => {
  expect(shortcutAction(key({ key: 'n', code: 'KeyN', altKey: true }))).toEqual({ type: 'new-tab' });
  expect(shortcutAction(key({ key: 's', code: 'KeyS', altKey: true }))).toEqual({ type: 'settings' });
  expect(shortcutAction(key({ key: 'i', code: 'KeyI', altKey: true }))).toEqual({ type: 'toggle-details' });
  expect(shortcutAction(key({ key: '/', code: 'Slash', altKey: true }))).toEqual({ type: 'help' });
  expect(shortcutAction(key({ key: 'ArrowDown', altKey: true }))).toEqual({ type: 'next-tab' });
  expect(shortcutAction(key({ key: 'ArrowUp', altKey: true }))).toEqual({ type: 'prev-tab' });
  expect(shortcutAction(key({ key: 'ArrowDown', altKey: true, shiftKey: true }))).toEqual({ type: 'next-attention' });
  expect(shortcutAction(key({ key: 'ArrowUp', altKey: true, shiftKey: true }))).toEqual({ type: 'prev-attention' });
});

test('Alt plus a digit jumps by index, by code when the key is dead', () => {
  expect(shortcutAction(key({ key: '3', code: 'Digit3', altKey: true }))).toEqual({ type: 'jump', index: 2 });
  expect(shortcutAction(key({ key: 'Dead', code: 'Digit1', altKey: true }))).toEqual({ type: 'jump', index: 0 });
  expect(shortcutAction(key({ key: '0', code: 'Digit0', altKey: true }))).toBeNull();
});

test('plain keys and Ctrl or Meta chords are left to the browser', () => {
  expect(shortcutAction(key({ key: 'n' }))).toBeNull();
  expect(shortcutAction(key({ key: 'n', ctrlKey: true }))).toBeNull();
  expect(shortcutAction(key({ key: 'n', altKey: true, metaKey: true }))).toBeNull();
  expect(shortcutAction(key({ key: 'x', altKey: true }))).toBeNull();
  expect(shortcutAction(key({ key: 'n', altKey: true, shiftKey: true }))).toBeNull();
});
