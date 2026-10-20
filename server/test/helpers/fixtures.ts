import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseObjectLine, type JsonObject } from '../../src/adapters/jsonl.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '..', 'fixtures');

export function fixtureText(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

/** Every JSON object line of a recorded JSONL fixture. */
export function fixtureLines(name: string): JsonObject[] {
  return fixtureText(name)
    .split('\n')
    .map(parseObjectLine)
    .filter((o): o is JsonObject => o !== null);
}

export function fixtureJson(name: string): JsonObject {
  return JSON.parse(fixtureText(name)) as JsonObject;
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
