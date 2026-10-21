import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withAliases, type FetchedPrices } from '../src/ledger/priceSources.js';
import { costFor, DEFAULT_PRICING, PricingStore, type PriceTable } from '../src/ledger/pricing.js';

const table: PriceTable = {
  'gemini-2.5-flash': { inputPerM: 0.3, cachedInputPerM: 0.075, outputPerM: 2.5 },
  'gemini-2.5-pro': { inputPerM: 1.25, cachedInputPerM: 0.31, outputPerM: 10 },
  'codex:default': { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 },
};

const M = 1_000_000;

test('exact model key prices each token class', () => {
  expect(costFor('gemini', 'gemini-2.5-flash', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(0.3);
  expect(costFor('gemini', 'gemini-2.5-flash', { inputTokens: M, cachedInputTokens: M, outputTokens: M }, table)).toBeCloseTo(2.875);
});

test('longest matching prefix wins for dated or suffixed model names', () => {
  expect(costFor('gemini', 'gemini-2.5-flash-preview-05-20', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(0.3);
  expect(costFor('gemini', 'gemini-2.5-pro-exp', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(1.25);
});

test('falls back to the provider default, then to zero', () => {
  expect(costFor('codex', 'gpt-something-new', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBeCloseTo(1.25);
  expect(costFor('codex', null, { inputTokens: 0, cachedInputTokens: 0, outputTokens: M }, table)).toBeCloseTo(10);
  expect(costFor('claude', 'claude-sonnet-5-5', { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 }, table)).toBe(0);
});

test('default table prices the Gemini aliases and the Codex default', () => {
  const usage = { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 };
  expect(costFor('gemini', 'flash', usage, DEFAULT_PRICING)).toBeGreaterThan(0);
  expect(costFor('gemini', 'pro', usage, DEFAULT_PRICING)).toBeGreaterThan(costFor('gemini', 'flash', usage, DEFAULT_PRICING));
  expect(costFor('codex', null, usage, DEFAULT_PRICING)).toBeGreaterThan(0);
});

describe('PricingStore', () => {
  const fetched: FetchedPrices = {
    table: withAliases({
      'gemini-2.5-flash': { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 },
      'claude-haiku-5-5': { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 },
    }),
    source: 'LiteLLM + OpenRouter',
    errors: [],
  };
  const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'council-pricing-')), 'pricing.json');

  test('before any fetch the seeded defaults are in force', async () => {
    const store = await PricingStore.open(tmpFile(), async () => fetched);
    const s = store.status();
    expect(s.source).toBe('built-in defaults');
    expect(s.fetchedAt).toBeNull();
    expect(s.table.flash).toEqual(DEFAULT_PRICING.flash);
    expect(store.isStale(new Date())).toBe(true);
  });

  test('refresh applies fetched prices, aliases follow, and the result is cached on disk', async () => {
    const file = tmpFile();
    const store = await PricingStore.open(file, async () => fetched);
    const s = await store.refresh(new Date('2026-10-21T10:00:00Z'));
    expect(s.source).toBe('LiteLLM + OpenRouter');
    expect(s.fetchedAt).toBe('2026-10-21T10:00:00.000Z');
    expect(store.get()['gemini-2.5-flash']?.cachedInputPerM).toBe(0.03);
    expect(store.get().flash).toEqual(store.get()['gemini-2.5-flash']);
    expect(store.get()['gpt-5.1-codex-mini']).toEqual(DEFAULT_PRICING['gpt-5.1-codex-mini']);

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved).toMatchObject({ fetchedAt: '2026-10-21T10:00:00.000Z', source: 'LiteLLM + OpenRouter' });
    const reopened = await PricingStore.open(file, async () => {
      throw new Error('must not fetch');
    });
    expect(reopened.get()['claude-haiku-5-5']).toEqual({ inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 });
    expect(reopened.isStale(new Date('2026-10-27T10:00:00Z'))).toBe(false);
    expect(reopened.isStale(new Date('2026-10-28T10:00:01Z'))).toBe(true);
  });

  test('offline: a failed refresh keeps the previous prices and reports why', async () => {
    const store = await PricingStore.open(tmpFile(), async () => {
      throw new Error('LiteLLM: fetch failed; OpenRouter: fetch failed');
    });
    const s = await store.refresh();
    expect(s.source).toBe('built-in defaults');
    expect(s.lastError).toMatch(/fetch failed/);
    expect(store.get().flash).toEqual(DEFAULT_PRICING.flash);
  });

  test('refreshIfStale fetches only when the cache is older than seven days', async () => {
    let calls = 0;
    const store = await PricingStore.open(tmpFile(), async () => {
      calls += 1;
      return fetched;
    });
    await store.refreshIfStale(new Date('2026-10-21T00:00:00Z'));
    await store.refreshIfStale(new Date('2026-10-25T00:00:00Z'));
    expect(calls).toBe(1);
    await store.refreshIfStale(new Date('2026-10-29T00:00:00Z'));
    expect(calls).toBe(2);
  });

  test('manual overrides beat fetched prices and survive a refresh', async () => {
    const file = tmpFile();
    const store = await PricingStore.open(file, async () => fetched);
    const mine = { inputPerM: 1, cachedInputPerM: 1, outputPerM: 1 };
    await store.setOverrides({ 'gemini-2.5-flash': mine });
    await store.refresh();
    expect(store.get()['gemini-2.5-flash']).toEqual(mine);
    expect(store.status().overrides).toEqual({ 'gemini-2.5-flash': mine });
    expect((await PricingStore.open(file)).get()['gemini-2.5-flash']).toEqual(mine);
  });

  test('a pricing.json from before automatic prices keeps only the rows the developer changed', async () => {
    const file = tmpFile();
    const edited = { ...DEFAULT_PRICING, flash: { inputPerM: 7, cachedInputPerM: 7, outputPerM: 7 } };
    fs.writeFileSync(file, JSON.stringify(edited));
    const store = await PricingStore.open(file);
    expect(store.status().overrides).toEqual({ flash: { inputPerM: 7, cachedInputPerM: 7, outputPerM: 7 } });
    expect(store.isStale(new Date())).toBe(true);
  });
});
