import { useEffect, useState } from 'react';
import { costSource, formatUsd, PROVIDER_NAMES } from '../lib/format';
import { PROVIDERS, type CouncilResult, type Provider, type Settings, type Tab } from '../types';
import { Glyph } from './Glyph';

interface Props {
  tab: Tab;
  settings: Settings;
  onStart: (pick?: { provider: Provider; model: string | null }) => Promise<void>;
}

/** "2–1" from the vote counts, largest first. */
export function tally(vote: CouncilResult): string {
  return Object.values(vote.counts)
    .filter((n) => n > 0)
    .sort((a, b) => b - a)
    .join('–');
}

/** The council's vote: expanded until the developer starts the worker, then a one-line summary that opens on click. */
export function VoteCard({ tab, settings, onStart }: Props) {
  const vote = tab.vote;
  const [provider, setProvider] = useState<Provider>(tab.worker?.provider ?? 'gemini');
  const [model, setModel] = useState<string>(tab.worker?.model ?? '');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<boolean | null>(null);
  // The council's pick arrives after this card first renders; follow it until the developer starts the tab.
  useEffect(() => {
    if (tab.status === 'awaiting-start' && tab.worker) {
      setProvider(tab.worker.provider);
      setModel(tab.worker.model ?? '');
    }
  }, [tab.status, tab.worker?.provider, tab.worker?.model]);
  if (!vote) return null;

  const awaiting = tab.status === 'awaiting-start';
  const open = manual ?? awaiting;
  const overridden = tab.worker && (provider !== tab.worker.provider || (model || null) !== tab.worker.model);
  const voteCost = vote.seats.reduce((s, x) => s + x.costUsd, 0);

  return (
    <section className="card vote-card" aria-label="Council vote">
      <button className="vote-summary" onClick={() => setManual(!open)} aria-expanded={open}>
        <b>Council voted</b>
        <span className={`tier tier-${vote.decision}`}>{vote.decision}</span>
        <span>{tally(vote)}</span>
        {vote.tie && <span className="muted">tie broken</span>}
        {!open && (
          <>
            <span className="muted">·</span>
            {vote.seats.map((s, i) => (
              <span key={i} className="row gap-sm" title={s.vote?.reason ?? s.error ?? 'no vote'}>
                <Glyph provider={s.seat.provider} />
                {s.vote ? `${s.vote.tier} ${Math.round(s.vote.confidence * 100)}%` : 'no vote'}
              </span>
            ))}
          </>
        )}
        <span className="muted">·</span>
        <span title="What the council seats cost">{formatUsd(voteCost)}</span>
        <span className="caret">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <>
          <div className="seats">
            {vote.seats.map((s, i) => (
              <div key={i} className={`seat${s.vote ? '' : ' novote'}`}>
                <div className="who">
                  <Glyph provider={s.seat.provider} />
                  <span>{PROVIDER_NAMES[s.seat.provider]}</span>
                  <span className="model" title={s.seat.model ?? 'default model'}>
                    {s.seat.model ?? 'default'}
                  </span>
                  <span className="grow" />
                  {s.vote ? <span className={`tier tier-${s.vote.tier}`}>{s.vote.tier}</span> : <span className="tier tier-none">no vote</span>}
                </div>
                {s.vote && (
                  <div className="conf" title={`${Math.round(s.vote.confidence * 100)}% confident`} role="progressbar" aria-valuenow={Math.round(s.vote.confidence * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ width: `${Math.round(s.vote.confidence * 100)}%` }} />
                  </div>
                )}
                <div className="reason">{s.vote?.reason ?? s.error ?? ''}</div>
                <div className={`cost${s.overCeiling ? ' warn-text' : ''}`} title={s.overCeiling ? 'Above the per-vote cost ceiling' : costSource(s.seat.provider)}>
                  {formatUsd(s.costUsd)}
                  {s.vote ? ` · ${Math.round(s.vote.confidence * 100)}%` : ''}
                </div>
              </div>
            ))}
          </div>
          {tab.routing?.reason && <div className="note">{tab.routing.reason}</div>}
          <div className="vote-start">
            <span className="row gap-sm">
              Routed to
              {tab.worker ? (
                <>
                  <Glyph provider={tab.worker.provider} />
                  <strong>
                    {PROVIDER_NAMES[tab.worker.provider]} · {tab.worker.model ?? 'default model'}
                  </strong>
                </>
              ) : (
                <strong>no worker yet</strong>
              )}
              {tab.tier && tab.tier !== vote.decision ? <span className="muted">({tab.tier} tier)</span> : null}
            </span>
            {awaiting && (
              <>
                <span className="grow" />
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
        </>
      )}
    </section>
  );
}
