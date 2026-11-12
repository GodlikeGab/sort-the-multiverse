import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatName, type Project, type RoundInfo, type SortKey } from '../api';
import { BasicsEditor, DeckStats, ExportBox, TargetMath, targetMessage } from '../components/Shared';

export default function ProjectPage() {
  const { id } = useParams();
  const pid = id!;
  const navigate = useNavigate();
  const [p, setP] = useState<Project | null>(null);
  const [rounds, setRounds] = useState<RoundInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deckSize, setDeckSize] = useState('');

  const load = useCallback(() => {
    api.project(pid).then((proj) => {
      setP(proj);
      setDeckSize((d) => d || String(proj.deckSize));
      if (proj.status === 'ready') api.rounds(pid).then(setRounds).catch(() => {});
    }).catch((e) => setError(e.message));
  }, [pid]);

  useEffect(load, [load]);

  // While Scryfall results are downloading, poll for progress.
  useEffect(() => {
    if (p?.status !== 'loading') return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [p?.status, load]);

  if (error) return <main className="page"><p className="error">{error}</p><Link to="/">Back to projects</Link></main>;
  if (!p) return <main className="page"><div className="spinner" /></main>;

  const remove = async () => {
    if (!confirm(`Delete “${p.name}” and all its progress? This cannot be undone.`)) return;
    await api.deleteProject(p.id);
    navigate('/', { replace: true });
  };

  const rename = () => {
    const name = prompt('Project name', p.name)?.trim();
    if (name && name !== p.name) api.updateProject(p.id, { name }).then(setP).catch(() => {});
  };
  const resort = (sort: SortKey) => api.reorder(p.id, sort).then(setP).catch((e) => setError(e.message));

  const head = (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        <Link to="/" className="small muted">‹ Projects</Link>
        <h1>{p.name} <button className="btn ghost sm" onClick={rename} aria-label="Rename project">✎</button></h1>
        <div className="muted small">
          {formatName(p.format)}{p.commander && <> · Commander: {p.commander.name}</>}
        </div>
      </div>
    </div>
  );

  if (p.status !== 'ready') {
    const pct = p.load.total ? (p.load.fetched / p.load.total) * 100 : 0;
    return (
      <main className="page" style={{ maxWidth: 760 }}>
        {head}
        <div className="panel stack">
          {p.status === 'loading' ? <>
            <h2>Fetching cards from Scryfall…</h2>
            <div className="progress"><span style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
            <span className="muted small">
              {p.load.total ? `${p.load.fetched.toLocaleString()} of ${p.load.total.toLocaleString()} cards` : 'Starting…'}
            </span>
          </> : <>
            <h2>Could not load the cards</h2>
            <p className="error">{p.load.error}</p>
            <div className="row">
              <button className="btn primary" onClick={() => api.retry(p.id).then(setP).catch((e) => setError(e.message))}>Retry</button>
              <button className="btn danger" onClick={remove}>Delete project</button>
            </div>
          </>}
          <code className="query wrap">{p.query}</code>
        </div>
      </main>
    );
  }

  const s = p.state!;
  const msg = targetMessage(s);
  const pct = s.total ? (s.reviewed / s.total) * 100 : 0;
  const saveDeckSize = (v: string) => {
    setDeckSize(v);
    const n = Math.floor(Number(v));
    if (n > 0 && n <= 1000) api.updateProject(p.id, { deckSize: n }).then(setP).catch(() => {});
  };

  return (
    <main className="page" style={{ maxWidth: 860 }}>
      {head}

      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="round-pill">Round {s.round}</span>
          {s.complete && <span className="complete-badge">✓ Deck complete</span>}
        </div>
        <div className="progress"><span style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
        <div className="stats">
          <span><strong>{s.reviewed.toLocaleString()}</strong> of {s.total.toLocaleString()} reviewed</span>
          <span style={{ color: 'var(--keep)' }}><strong>{s.keep.toLocaleString()}</strong> kept</span>
          <span>target <strong>{s.target}</strong></span>
          {s.maybe > 0 && <span style={{ color: 'var(--maybe)' }}>{s.maybe} maybe</span>}
        </div>
        {(s.resolved || s.complete) && <div className={`verdict ${msg.tone}`}>{msg.text}</div>}
        {p.load.warning && <div className="notice">{p.load.warning}</div>}
        <div className="row">
          <Link className="btn primary" to={`/projects/${p.id}/swipe`}>
            {s.remaining > 0 ? (s.reviewed ? 'Continue swiping' : 'Start swiping')
              : s.maybe > 0 ? 'Resolve maybes' : 'Round summary'}
          </Link>
          <Link className="btn" to={`/projects/${p.id}/rounds/${s.round}`}>This round's lists</Link>
        </div>
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Deck size and basic lands</h2>
        <TargetMath s={s} />
        <div className="field">
          <span className="label">Target deck size</span>
          <div className="row">
            <button type="button" className={`chip ${s.deckSize === 100 ? 'on' : ''}`} onClick={() => saveDeckSize('100')}>Commander 100</button>
            <button type="button" className={`chip ${s.deckSize === 60 ? 'on' : ''}`} onClick={() => saveDeckSize('60')}>Constructed 60</button>
            <input className="input" style={{ width: 84 }} type="number" min={1} max={1000} inputMode="numeric"
              aria-label="Custom deck size" value={deckSize} onChange={(e) => saveDeckSize(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <span className="label">Basic lands</span>
          <BasicsEditor key={`${s.round}-${s.keep}`} project={p} onSaved={setP} />
        </div>
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Bad cards</h2>
        <label className="check">
          <input type="checkbox" checked={p.ignoreBad}
            onChange={(e) => api.updateProject(p.id, { ignoreBad: e.target.checked }).then(setP)} />
          Ignore the global bad-cards list in this project
        </label>
        <span className="muted small">
          {p.ignoreBad
            ? 'Cards on your bad list are shown here like any other card.'
            : s.hidden > 0
              ? `${s.hidden} card${s.hidden === 1 ? ' is' : 's are'} hidden from this round because ${s.hidden === 1 ? 'it is' : 'they are'} on your bad list.`
              : 'Cards you swipe down anywhere are hidden from this project.'}{' '}
          <Link to="/bad">Manage the list</Link>
        </span>
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Kept cards</h2>
        <DeckStats projectId={p.id} version={`${s.keep}-${s.round}-${s.basicsTotal}`} />
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Rounds</h2>
        <div className="rounds">
          {rounds.map((r) => (
            <Link key={r.number} to={`/projects/${p.id}/rounds/${r.number}`} className="round-row">
              <span className="num">Round {r.number}</span>
              <span className="flow-sm">
                {(r.pool - r.hidden).toLocaleString()} <span className="muted">→</span>{' '}
                <span style={{ color: 'var(--keep)' }}>{r.keep.toLocaleString()}</span>
              </span>
              <span className="muted small">cut {r.cut} · bad {r.bad}{r.maybe ? ` · maybe ${r.maybe}` : ''}</span>
              <span className={`small ${r.status === 'active' ? '' : 'faint'}`} style={{ marginLeft: 'auto' }}>
                {r.status === 'active' ? 'in progress' : 'closed'} ›
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Decklist export</h2>
        <ExportBox projectId={p.id} version={`${s.keep}-${s.round}-${s.deckSize}-${s.complete}-${JSON.stringify(p.basics)}`} />
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Saved search</h2>
        <code className="query wrap">{p.query}</code>
        <div className="field">
          <label className="label" htmlFor="p-order">Order of the cards still to review</label>
          <select id="p-order" className="input" value={p.sort} onChange={(e) => resort(e.target.value as SortKey)}>
            <option value="type">Card type, then A–Z</option>
            <option value="name">Name</option>
            <option value="cmc">Mana value</option>
            <option value="color">Color</option>
            <option value="random">Random (reshuffle)</option>
          </select>
          <span className="hint">Takes effect immediately. Cards you already decided stay as they are.</span>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => navigate('/new', { state: { from: p } })}>New project from this search</button>
          <button className="btn danger sm" onClick={remove}>Delete project</button>
        </div>
      </div>
    </main>
  );
}
