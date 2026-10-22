import type { ModelCatalog, ModelPrice, Provider } from '../types';

export interface Pick {
  provider: Provider;
  model: string | null;
}

/** USD per million tokens: "$0.10", "$2", "$1.25", "$0.025". */
export function perMillion(n: number): string {
  if (Number.isInteger(n)) return `$${n}`;
  if (n >= 0.1) return `$${n.toFixed(2)}`;
  return `$${Number(n.toPrecision(2))}`;
}

/** "$2 / $10": input and output per million tokens. */
export function priceBadge(price: ModelPrice | undefined): string {
  return price ? `${perMillion(price.inputPerM)} / ${perMillion(price.outputPerM)}` : '';
}

export function priceTitle(price: ModelPrice): string {
  return `Per million tokens: ${perMillion(price.inputPerM)} input, ${perMillion(price.cachedInputPerM)} cached input, ${perMillion(price.outputPerM)} output`;
}

/** The catalog's label for a model, else its id; `null` is the CLI's own default. */
export function modelLabel(catalog: ModelCatalog | null, provider: Provider, model: string | null): string {
  if (!model) return 'CLI default';
  return catalog?.[provider]?.find((m) => m.id === model)?.label ?? model;
}

export function sameWorker(a: Pick, b: Pick): boolean {
  return a.provider === b.provider && (a.model || null) === (b.model || null);
}
