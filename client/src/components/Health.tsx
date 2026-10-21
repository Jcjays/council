import { PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type CliHealth, type Provider } from '../types';

const INSTALL_HINTS: Record<Provider, { install: string; auth: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', auth: 'set ANTHROPIC_API_KEY, or run `claude` once and sign in' },
  codex: { install: 'npm install -g @openai/codex', auth: 'set CODEX_API_KEY (or OPENAI_API_KEY), or run `codex login`' },
  gemini: { install: 'npm install -g @google/gemini-cli', auth: 'set GEMINI_API_KEY, or run `gemini` once and sign in' },
};

export function Health({ health }: { health: Record<Provider, CliHealth> | null }) {
  return (
    <section className="card">
      <header className="card-title">CLI health</header>
      <table className="plain">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Installed</th>
            <th>Version</th>
            <th>Auth</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {PROVIDERS.map((p) => {
            const h = health?.[p];
            return (
              <tr key={p}>
                <td>{PROVIDER_NAMES[p]}</td>
                <td>{h ? (h.installed ? 'yes' : 'no') : '…'}</td>
                <td>{h?.version ?? ''}</td>
                <td>{h ? (h.authed ? h.authSource ?? 'yes' : 'not found') : ''}</td>
                <td className="small muted">
                  {h && !h.installed && (
                    <>
                      <code>{INSTALL_HINTS[p].install}</code>
                      {h.error ? ` — ${h.error.split('\n')[0]}` : ''}
                    </>
                  )}
                  {h && h.installed && !h.authed && INSTALL_HINTS[p].auth}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
