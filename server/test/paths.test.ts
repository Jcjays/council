import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { councilHome, paths } from '../src/config/paths.js';

const original = process.env.COUNCIL_HOME;
afterEach(() => {
  if (original === undefined) delete process.env.COUNCIL_HOME;
  else process.env.COUNCIL_HOME = original;
});

test('councilHome prefers COUNCIL_HOME', () => {
  process.env.COUNCIL_HOME = 'C:/tmp/ch';
  expect(councilHome()).toBe('C:/tmp/ch');
});

test('councilHome falls back to ~/.council', () => {
  delete process.env.COUNCIL_HOME;
  expect(councilHome()).toMatch(/[\\/]\.council$/);
});

test('paths derive files from home', () => {
  const p = paths('/x');
  expect(p.home).toBe('/x');
  expect(p.settings).toBe(path.join('/x', 'settings.json'));
  expect(p.pricing).toBe(path.join('/x', 'pricing.json'));
  expect(p.ledger).toBe(path.join('/x', 'ledger.jsonl'));
  expect(p.projects).toBe(path.join('/x', 'projects'));
});
