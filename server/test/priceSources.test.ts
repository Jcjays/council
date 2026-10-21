import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { fetchPrices, fromLiteLLM, fromOpenRouter, LITELLM_URL, OPENROUTER_URL, withAliases } from '../src/ledger/priceSources.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const litellm: unknown = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'litellm-prices.json'), 'utf8'));
const openrouter: unknown = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'openrouter-models.json'), 'utf8'));

describe('LiteLLM price list', () => {
  const table = fromLiteLLM(litellm);

  test('maps per-token costs to USD per million tokens, cached input included', () => {
    expect(table['claude-haiku-5-5']).toEqual({ inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 });
    expect(table['claude-fable-5-1']).toEqual({ inputPerM: 10, cachedInputPerM: 0.25, outputPerM: 50 });
    expect(table['gpt-5.1-codex-mini']).toEqual({ inputPerM: 0.25, cachedInputPerM: 0.025, outputPerM: 2 });
  });

  test('a model without a cached price is charged the input price for cached tokens', () => {
    expect(table['gpt-5.5-pro']).toEqual({ inputPerM: 30, cachedInputPerM: 30, outputPerM: 180 });
  });

  test('Gemini API rows are stored under the bare model name', () => {
    expect(table['gemini-2.5-flash']).toEqual({ inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 });
    expect(table['gemini-3.5-flash']).toEqual({ inputPerM: 1.5, cachedInputPerM: 0.15, outputPerM: 9 });
  });

  test('keeps only chat models of the three providers, sold directly', () => {
    for (const key of ['sample_spec', 'azure/gpt-5.5', 'chatgpt/gpt-5.5', 'claude-sonnet-4-5-20250929-v1:0', 'gemini-2.5-flash-image', 'gemini-2.5-flash-preview-tts', 'text-embedding-3-small', 'mistral/mistral-large-latest', 'mistral-large-latest']) {
      expect(table[key], key).toBeUndefined();
    }
    expect(Object.keys(table).every((k) => !k.includes('/'))).toBe(true);
  });

  test('anything that is not a price list maps to an empty table', () => {
    expect(fromLiteLLM(null)).toEqual({});
    expect(fromLiteLLM([1, 2])).toEqual({});
    expect(fromLiteLLM({ 'gpt-5': 'cheap' })).toEqual({});
  });
});

describe('OpenRouter model list', () => {
  const table = fromOpenRouter(openrouter);

  test('maps vendor-prefixed ids to the names the CLIs use', () => {
    expect(table['claude-haiku-5-5']).toEqual({ inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 });
    expect(table['claude-fable-5-1']).toEqual({ inputPerM: 10, cachedInputPerM: 0.25, outputPerM: 50 });
    expect(table['gpt-5.1-codex']).toEqual({ inputPerM: 1.25, cachedInputPerM: 0.13, outputPerM: 10 });
    expect(table['gemini-2.5-pro']).toEqual({ inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 });
  });

  test('ignores batch and free variants and other vendors', () => {
    expect(Object.keys(table).some((k) => k.includes(':') || k.includes('/'))).toBe(false);
    expect(Object.keys(table).some((k) => k.includes('minimax') || k.includes('llama'))).toBe(false);
  });

  test('anything that is not a model list maps to an empty table', () => {
    expect(fromOpenRouter({})).toEqual({});
    expect(fromOpenRouter({ data: [{ id: 'openai/gpt-5', pricing: { prompt: 'n/a' } }] })).toEqual({});
  });
});

describe('aliases', () => {
  test("Council's short names and provider defaults resolve to real model rows", () => {
    const table = withAliases(fromLiteLLM(litellm));
    expect(table.flash).toEqual(table['gemini-2.5-flash']);
    expect(table['flash-lite']).toEqual(table['gemini-2.5-flash-lite']);
    expect(table.pro).toEqual(table['gemini-2.5-pro']);
    expect(table['gemini:default']).toEqual(table['gemini-2.5-flash']);
    expect(table['codex:default']).toEqual(table['gpt-5.1-codex']);
    expect(table['codex-mini']).toEqual(table['gpt-5.1-codex-mini']);
  });

  test('an alias whose model is missing is left alone', () => {
    const table = withAliases({ flash: { inputPerM: 9, cachedInputPerM: 9, outputPerM: 9 } });
    expect(table.flash).toEqual({ inputPerM: 9, cachedInputPerM: 9, outputPerM: 9 });
    expect(table.pro).toBeUndefined();
  });
});

function fakeFetch(responses: Record<string, unknown | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const r = responses[url];
    if (r === undefined || r instanceof Error) throw r ?? new Error(`unexpected ${url}`);
    return new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('fetchPrices', () => {
  test('combines both sources; LiteLLM wins where both list a model', async () => {
    const r = await fetchPrices(fakeFetch({ [LITELLM_URL]: litellm, [OPENROUTER_URL]: openrouter }));
    expect(r.source).toBe('LiteLLM + OpenRouter');
    expect(r.errors).toEqual([]);
    expect(r.table['gpt-5.1-codex']?.cachedInputPerM).toBe(0.125);
    expect(r.table.flash).toEqual(r.table['gemini-2.5-flash']);
  });

  test('one source down still yields prices from the other', async () => {
    const r = await fetchPrices(fakeFetch({ [LITELLM_URL]: new Error('offline'), [OPENROUTER_URL]: openrouter }));
    expect(r.source).toBe('OpenRouter');
    expect(r.errors).toEqual([expect.stringMatching(/LiteLLM.*offline/)]);
    expect(r.table['gpt-5.1-codex']?.cachedInputPerM).toBe(0.13);
  });

  test('a non-200 answer counts as a failed source', async () => {
    const failing = (async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    await expect(fetchPrices(failing)).rejects.toThrow(/LiteLLM.*503[\s\S]*OpenRouter.*503/);
  });
});
