import { expect, test } from 'vitest';
import { PROVIDERS } from '../src/adapters/types.js';
import { MODEL_LADDER, modelCatalog } from '../src/config/models.js';
import { DEFAULT_SETTINGS } from '../src/config/settings.js';
import { DEFAULT_PRICING, lookupPrice } from '../src/ledger/pricing.js';

test('each ladder runs cheapest to strongest by price', () => {
  for (const p of PROVIDERS) {
    const outputPrices = MODEL_LADDER[p].map((m) => lookupPrice(p, m.id, DEFAULT_PRICING)?.outputPerM ?? NaN);
    expect(outputPrices.every((x) => Number.isFinite(x)), p).toBe(true);
    expect([...outputPrices].sort((a, b) => a - b), p).toEqual(outputPrices);
  }
});

test('the default model lists are the curated ladders', () => {
  for (const p of PROVIDERS) expect(DEFAULT_SETTINGS.models[p]).toEqual(MODEL_LADDER[p].map((m) => m.id));
});

test('the catalog labels and prices each model in the ladder order', () => {
  const catalog = modelCatalog(DEFAULT_SETTINGS.models, DEFAULT_PRICING);
  expect(catalog.claude.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1']);
  expect(catalog.claude[0]).toMatchObject({ id: 'claude-haiku-5-5', label: 'Haiku 5.5', price: DEFAULT_PRICING['claude-haiku-5-5'] });
  expect(catalog.gemini.find((m) => m.id === 'flash')).toMatchObject({ label: 'Flash', resolves: 'gemini-2.5-flash' });
});

test('a model that is not in the curated ladder still appears, labelled by its id', () => {
  const catalog = modelCatalog({ ...DEFAULT_SETTINGS.models, codex: ['gpt-5.1-codex-mini', 'gpt-6-preview'] }, DEFAULT_PRICING);
  expect(catalog.codex.map((m) => m.id)).toEqual(['gpt-5.1-codex-mini', 'gpt-6-preview']);
  expect(catalog.codex[1]).toMatchObject({ id: 'gpt-6-preview', label: 'gpt-6-preview' });
  expect(catalog.codex[1]?.price).toBeUndefined();
});
