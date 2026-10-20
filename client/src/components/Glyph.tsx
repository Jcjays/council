import { PROVIDER_GLYPHS, PROVIDER_NAMES } from '../lib/format';
import type { Provider } from '../types';

/** The provider's glyph in its brand colour: the worker "icon" used wherever a worker is named. */
export function Glyph({ provider, large }: { provider: Provider; large?: boolean }) {
  return (
    <span className={`glyph g-${provider}${large ? ' lg' : ''}`} title={PROVIDER_NAMES[provider]} aria-label={PROVIDER_NAMES[provider]} role="img">
      {PROVIDER_GLYPHS[provider]}
    </span>
  );
}
