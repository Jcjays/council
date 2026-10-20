import { useState } from 'react';
import { formatUsd, PROVIDER_NAMES, workerLabel } from '../lib/format';
import { PROVIDERS, type Provider, type Settings, type Tab } from '../types';

interface Props {
  tab: Tab;
  settings: Settings;
  onStart: (pick?: { provider: Provider; model: string | null }) => Promise<void>;
}

export function VoteCard({ tab, settings, onStart }: Props) {
  const vote = tab.vote;
  const [provider, setProvider] = useState<Provider>(tab.worker?.provider ?? 'gemini');
  const [model, setModel] = useState<string>(tab.worker?.model ?? '');
  const [busy, setBusy] = useState(false);
  if (!vote) return null;

  const overridden = tab.worker && (provider !== tab.worker.provider || (model || null) !== tab.worker.model);

  return (
    <section className="card vote-card">
      <header className="card-title">
        <span>Council vote</span>
        <span className={`tier tier-${vote.decision}`}>{vote.decision}</span>
        {vote.tie && <span className="muted small">tie broken</span>}
      </header>
      <table className="seats">
        <tbody>
          {vote.seats.map((s, i) => (
            <tr key={i} className={s.vote ? '' : 'muted'}>
              <td>{workerLabel({ provider: s.seat.provider, model: s.seat.model })}</td>
              <td>{s.vote ? <span className={`tier tier-${s.vote.tier}`}>{s.vote.tier}</span> : <span className="tier tier-none">no vote</span>}</td>
              <td className="small">{s.vote ? `${Math.round(s.vote.confidence * 100)}%` : ''}</td>
              <td className="small reason">{s.vote?.reason ?? s.error ?? ''}</td>
              <td className={`small ${s.overCeiling ? 'warn-text' : 'muted'}`} title={s.overCeiling ? 'above the per-vote cost ceiling' : ''}>
                {formatUsd(s.costUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tab.routing?.reason && <div className="note">{tab.routing.reason}</div>}
      <div className="row wrap">
        <span>
          Routed to <strong>{workerLabel(tab.worker)}</strong>
          {tab.tier && tab.tier !== vote.decision ? ` (${tab.tier})` : ''}
        </span>
        {tab.status === 'awaiting-start' && (
          <>
            <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)} aria-label="Worker provider">
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_NAMES[p]}
                </option>
              ))}
            </select>
            <input list={`models-${provider}`} value={model} onChange={(e) => setModel(e.target.value)} placeholder="default model" aria-label="Worker model" />
            <datalist id={`models-${provider}`}>
              {settings.models[provider].map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onStart(overridden ? { provider, model: model || null } : undefined);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {overridden ? `Start with ${PROVIDER_NAMES[provider]}` : 'Start'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
