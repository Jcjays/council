import { describe, expect, test } from 'vitest';
import type { ModelCatalog } from '../types';
import { modelLabel, perMillion, priceBadge, priceTitle, sameWorker } from './models';

const catalog: ModelCatalog = {
  claude: [
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: 'quick edits', price: { inputPerM: 0.1, cachedInputPerM: 0.01, outputPerM: 0.5 } },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', price: { inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 } },
  ],
  codex: [{ id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', price: { inputPerM: 1.25, cachedInputPerM: 0.125, outputPerM: 10 } }],
  gemini: [{ id: 'flash', label: 'Flash', resolves: 'gemini-2.5-flash' }],
};

describe('prices', () => {
  test('per-million amounts read naturally', () => {
    expect(perMillion(0.1)).toBe('$0.10');
    expect(perMillion(2)).toBe('$2');
    expect(perMillion(1.25)).toBe('$1.25');
    expect(perMillion(0.025)).toBe('$0.025');
    expect(perMillion(30)).toBe('$30');
  });

  test('the badge shows input and output per million tokens', () => {
    expect(priceBadge({ inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 })).toBe('$2 / $10');
    expect(priceBadge(undefined)).toBe('');
    expect(priceTitle({ inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 })).toBe('Per million tokens: $2 input, $0.10 cached input, $10 output');
  });
});

describe('model labels', () => {
  test('a known model shows its label; an unknown one its id; none the CLI default', () => {
    expect(modelLabel(catalog, 'claude', 'claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelLabel(catalog, 'codex', 'gpt-6-preview')).toBe('gpt-6-preview');
    expect(modelLabel(catalog, 'gemini', null)).toBe('CLI default');
    expect(modelLabel(null, 'claude', 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });

  test('sameWorker compares provider and model, treating empty as the default', () => {
    expect(sameWorker({ provider: 'claude', model: null }, { provider: 'claude', model: null })).toBe(true);
    expect(sameWorker({ provider: 'claude', model: 'x' }, { provider: 'claude', model: null })).toBe(false);
    expect(sameWorker({ provider: 'codex', model: null }, { provider: 'claude', model: null })).toBe(false);
  });
});
