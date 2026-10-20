import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { repoSnapshot } from '../src/council/snapshot.js';

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'council-snap-'));
}

test('lists top-level entries and extension counts, never file contents', async () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'SECRET_CONTENT_123');
  fs.writeFileSync(path.join(dir, 'src', 'b.ts'), 'export const b = 1;');
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme text body');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const s = await repoSnapshot(dir);
  expect(s).toContain('src/');
  expect(s).toContain('README.md');
  expect(s).toMatch(/\.ts: 2/);
  expect(s).toMatch(/\.md: 1/);
  expect(s).not.toContain('SECRET_CONTENT_123');
  expect(s).not.toContain('readme text body');
});

test('skips node_modules, .git and build output when walking', async () => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'y.js'), '');
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
  fs.writeFileSync(path.join(dir, 'main.py'), '');
  const s = await repoSnapshot(dir);
  expect(s).not.toMatch(/\.js/);
  expect(s).not.toContain('node_modules');
  expect(s).not.toContain('.git/');
  expect(s).toMatch(/\.py: 1/);
});

test('caps the top-level listing and says how many more there are', async () => {
  const dir = scratch();
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.txt`), '');
  const s = await repoSnapshot(dir, { maxEntries: 40 });
  expect(s).toContain('f00.txt');
  expect(s).toContain('and 20 more');
  expect(s).not.toContain('f59.txt');
});
