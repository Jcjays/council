import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { defaultBranch, diffStat } from '../src/worktrees/git.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo(branch = 'main'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-git-'));
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(dir, 'README.md'), 'line one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

test('diffStat lists modified, staged and new files in a checkout', async () => {
  const repo = makeRepo();
  fs.appendFileSync(path.join(repo, 'README.md'), 'changed\n');
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'x');
  git(repo, 'add', 'staged.txt');
  fs.writeFileSync(path.join(repo, 'new.txt'), 'x');
  const stat = await diffStat(repo);
  expect(stat).toContain('README.md');
  expect(stat).toContain('staged.txt');
  expect(stat).toContain('new.txt');
});

test('diffStat is empty for a clean checkout and tolerant of non-git folders', async () => {
  expect(await diffStat(makeRepo())).toBe('');
  expect(await diffStat(fs.mkdtempSync(path.join(os.tmpdir(), 'council-nogit-')))).toBe('');
});

test('defaultBranch reflects the repository', async () => {
  expect(await defaultBranch(makeRepo('master'))).toBe('master');
  expect(await defaultBranch(makeRepo('main'))).toBe('main');
});
