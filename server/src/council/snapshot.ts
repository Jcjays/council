import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.worktrees',
  '.superpowers',
  '.next',
  '.gradle',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
]);

export interface SnapshotOptions {
  /** Top-level entries to list before "… and N more". */
  maxEntries?: number;
  /** Stop counting files after this many. */
  maxFiles?: number;
  /** Extension buckets to show. */
  maxExtensions?: number;
}

async function walk(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0 && files.length < maxFiles) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(dir, entry.name));
        if (files.length >= maxFiles) break;
      }
    }
  }
  return files;
}

/**
 * A compact description of a checkout for the council: top-level entries and
 * file counts by extension. Never includes file contents.
 */
export async function repoSnapshot(cwd: string, opts: SnapshotOptions = {}): Promise<string> {
  const maxEntries = opts.maxEntries ?? 40;
  const maxFiles = opts.maxFiles ?? 5000;
  const maxExtensions = opts.maxExtensions ?? 15;

  const top = (await fs.readdir(cwd, { withFileTypes: true }))
    .filter((d) => !SKIP_DIRS.has(d.name))
    .map((d) => (d.isDirectory() ? `${d.name}/` : d.name))
    .sort((a, b) => a.localeCompare(b));
  const shown = top.slice(0, maxEntries);
  const more = top.length - shown.length;

  const files = await walk(cwd, maxFiles);
  const counts = new Map<string, number>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase() || '(no extension)';
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  const byType = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxExtensions)
    .map(([ext, n]) => `${ext}: ${n}`)
    .join(', ');

  const topLine = `Top-level: ${shown.join(', ')}${more > 0 ? `, … and ${more} more` : ''}`;
  const countLabel = files.length >= maxFiles ? `${maxFiles}+ files` : `${files.length} files`;
  return `${topLine}\nFiles by type (${countLabel}): ${byType || 'none'}`;
}
