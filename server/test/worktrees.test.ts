import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { slugify, WorktreeManager } from '../src/worktrees/manager.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function makeRepo(branch = 'main', withCommit = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-wt-'));
  git(dir, 'init', '-q', '-b', branch);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'core.autocrlf', 'false');
  if (withCommit) {
    fs.writeFileSync(path.join(dir, 'README.md'), 'line one\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
  }
  return dir;
}

test('slugify makes a short, safe branch leaf', () => {
  expect(slugify('Fix: the Login/Bug 🚀')).toBe('fix-the-login-bug');
  expect(slugify('')).toBe('task');
  expect(slugify('   ')).toBe('task');
  expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(40);
  expect(slugify('Trailing dash-')).toBe('trailing-dash');
});

test('create makes a worktree on a council branch cut from the default branch', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p, branch } = await wt.create('AbC123xyz', 'Add login page');
  expect(branch).toBe('council/add-login-page-abc123');
  expect(p).toBe(path.join(repo, '.worktrees', 'add-login-page-abc123'));
  expect(fs.existsSync(path.join(p, 'README.md'))).toBe(true);
  expect(git(repo, 'worktree', 'list')).toContain('add-login-page-abc123');
  expect(() => git(repo, 'check-ref-format', '--branch', branch)).not.toThrow();
});

test('create handles a long title with spaces, slashes and emoji', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const title = `${'Réécrire le módulo de pagos 🚀 / ' .repeat(8)}end`;
  const { branch } = await wt.create('t1', title);
  expect(branch.length).toBeLessThanOrEqual('council/'.length + 40 + 1 + 6);
  expect(() => git(repo, 'check-ref-format', '--branch', branch)).not.toThrow();
});

test('create fails clearly on a repository with no commits', async () => {
  const repo = makeRepo('main', false);
  const wt = new WorktreeManager(repo);
  await expect(wt.create('t1', 'x')).rejects.toThrow(/no commits|unborn|not a valid/i);
});

test('ensureExcluded adds .worktrees/ to .git/info/exclude once', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  await wt.ensureExcluded();
  await wt.ensureExcluded();
  const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  expect(exclude.split('\n').filter((l) => l.trim() === '.worktrees/')).toHaveLength(1);
});

test('defaultBranch reflects the repository (master here)', async () => {
  const repo = makeRepo('master');
  expect(await new WorktreeManager(repo).defaultBranch()).toBe('master');
});

test('commitAll commits everything once and reports nothing to commit afterwards', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p } = await wt.create('t1', 'feature');
  fs.writeFileSync(path.join(p, 'new.txt'), 'hello');
  const first = await wt.commitAll(p, 'council(t1): feature');
  expect(first.committed).toBe(true);
  expect(first.sha).toMatch(/^[0-9a-f]{7,}$/);
  expect(git(p, 'log', '-1', '--format=%s')).toBe('council(t1): feature');
  expect(await wt.commitAll(p, 'again')).toEqual({ committed: false });
});

test('mainCheckoutState reports branch and dirty files', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  expect(await wt.mainCheckoutState()).toEqual({ branch: 'main', clean: true, dirtyFiles: [] });
  fs.appendFileSync(path.join(repo, 'README.md'), 'more\n');
  expect(await wt.mainCheckoutState()).toEqual({ branch: 'main', clean: false, dirtyFiles: ['README.md'] });
});

test('diffStat mentions changed and new files in the worktree', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p } = await wt.create('t1', 'feature');
  fs.appendFileSync(path.join(p, 'README.md'), 'changed\n');
  fs.writeFileSync(path.join(p, 'new.txt'), 'x');
  const stat = await wt.diffStat(p);
  expect(stat).toContain('README.md');
  expect(stat).toContain('new.txt');
});

test('mergeInto merges a committed branch into a clean main checkout', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p, branch } = await wt.create('t1', 'feature');
  fs.writeFileSync(path.join(p, 'new.txt'), 'hello');
  await wt.commitAll(p, 'council(t1): feature');
  expect(await wt.hasUnmergedCommits(branch, 'main')).toBe(true);
  const r = await wt.mergeInto(branch, 'main');
  expect(r.kind).toBe('merged');
  expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(true);
  expect(await wt.hasUnmergedCommits(branch, 'main')).toBe(false);
});

test('mergeInto is blocked by a dirty main checkout and names the files', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p, branch } = await wt.create('t1', 'feature');
  fs.writeFileSync(path.join(p, 'new.txt'), 'hello');
  await wt.commitAll(p, 'c');
  fs.appendFileSync(path.join(repo, 'README.md'), 'wip\n');
  const r = await wt.mergeInto(branch, 'main');
  expect(r).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/uncommitted/i), files: ['README.md'] });
});

test('mergeInto is blocked when the main checkout is on another branch', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p, branch } = await wt.create('t1', 'feature');
  fs.writeFileSync(path.join(p, 'new.txt'), 'hello');
  await wt.commitAll(p, 'c');
  git(repo, 'checkout', '-q', '-b', 'other');
  const r = await wt.mergeInto(branch, 'main');
  expect(r).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('other') });
});

test('mergeInto aborts on conflict, lists the files and leaves main clean', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const { path: p, branch } = await wt.create('t1', 'feature');
  fs.writeFileSync(path.join(p, 'README.md'), 'worktree version\n');
  await wt.commitAll(p, 'wt change');
  fs.writeFileSync(path.join(repo, 'README.md'), 'main version\n');
  git(repo, 'commit', '-q', '-am', 'main change');
  const r = await wt.mergeInto(branch, 'main');
  expect(r).toEqual({ kind: 'conflict', files: ['README.md'] });
  expect(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(false);
  expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8').replace(/\r\n/g, '\n')).toBe('main version\n');
  expect(await wt.mainCheckoutState()).toMatchObject({ clean: true });
});

test('remove deletes the worktree and keeps or deletes the branch as asked', async () => {
  const repo = makeRepo();
  const wt = new WorktreeManager(repo);
  const a = await wt.create('t1', 'keep');
  const b = await wt.create('t2', 'drop');
  await wt.remove(a.path, { keepBranch: true, branch: a.branch });
  await wt.remove(b.path, { keepBranch: false, branch: b.branch });
  expect(fs.existsSync(a.path)).toBe(false);
  expect(fs.existsSync(b.path)).toBe(false);
  const branches = git(repo, 'branch', '--list', 'council/*');
  expect(branches).toContain(a.branch);
  expect(branches).not.toContain(b.branch);
});
