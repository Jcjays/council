import { PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type CliHealth, type Provider } from '../types';
import { Glyph } from './Glyph';

const INSTALL_HINTS: Record<Provider, { install: string; auth: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', auth: 'set ANTHROPIC_API_KEY, or run `claude` once and sign in' },
  codex: { install: 'npm install -g @openai/codex', auth: 'set CODEX_API_KEY (or OPENAI_API_KEY), or run `codex login`' },
  gemini: { install: 'npm install -g @google/gemini-cli', auth: 'set GEMINI_API_KEY, or run `gemini` once and sign in' },
};

function authLabel(h: CliHealth): string {
  if (!h.authed) return 'not signed in';
  switch (h.authSource) {
    case 'api-key':
      return 'API key';
    case 'login':
      return 'signed in';
    default:
      return 'signed in';
  }
}

/** One card per CLI: installed, version, sign-in state, and what to do when something is missing. */
export function Health({ health, id }: { health: Record<Provider, CliHealth> | null; id?: string }) {
  return (
    <section className="card" id={id} aria-label="CLI health">
      <header className="card-title">
        CLI health
        <span className="muted sm" style={{ fontWeight: 400 }}>
          what Council can see of each CLI on this machine
        </span>
      </header>
      <div className="health-cards">
        {PROVIDERS.map((p) => {
          const h = health?.[p];
          const hint = h && !h.installed ? INSTALL_HINTS[p].install : h && !h.authed ? INSTALL_HINTS[p].auth : null;
          return (
            <div key={p} className={`hcard g-${p}`}>
              <div className="who">
                <Glyph provider={p} />
                <span>{PROVIDER_NAMES[p]}</span>
                {h?.version && <span className="ver">{h.version}</span>}
              </div>
              <div className="row wrap gap-sm">
                {!h ? (
                  <span className="chip tone-muted">checking…</span>
                ) : (
                  <>
                    <span className={`chip tone-${h.installed ? 'ok' : 'danger'}`}>{h.installed ? 'installed' : 'not installed'}</span>
                    {h.installed && <span className={`chip tone-${h.authed ? 'ok' : 'warn'}`}>{authLabel(h)}</span>}
                  </>
                )}
              </div>
              {hint && (
                <div className="hint" title={hint}>
                  <code>{hint}</code>
                  <button className="quiet sm" onClick={() => void navigator.clipboard?.writeText(hint)} title="Copy">
                    copy
                  </button>
                </div>
              )}
              {h?.error && <div className="muted xs ellipsis" title={h.error}>{h.error.split('\n')[0]}</div>}
              {h && h.installed && h.authed && <div className="muted xs">Ready to vote and work.</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
