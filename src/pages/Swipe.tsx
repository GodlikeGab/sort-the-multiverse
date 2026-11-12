import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, DECISION_META, type Card, type Decision, type Project, type ProjectState } from '../api';
import { CATEGORIES, categoryOf } from '../cards';
import { CardModal } from '../components/CardModal';
import { CardList, ExportBox, MoveButtons, targetMessage } from '../components/Shared';
import { SwipeDeck, type SwipeDeckHandle } from '../components/SwipeDeck';

type Phase = 'swipe' | 'maybe' | 'summary';
const phaseOf = (s: ProjectState): Phase => (s.remaining > 0 ? 'swipe' : s.maybe > 0 ? 'maybe' : 'summary');

/** Local prediction of the state after a decision, so counters update instantly. */
function applyLocal(s: ProjectState, card: Card, from: Decision | null, to: Decision): ProjectState {
  const n = { ...s };
  if (from) n[from]--;
  else {
    n.remaining--;
    n.reviewed++;
    const cat = categoryOf(card.typeLine);
    const t = n.byType[cat];
    if (t) n.byType = { ...n.byType, [cat]: { ...t, reviewed: t.reviewed + 1 } };
  }
  n[to]++;
  n.toCut = n.keep - n.target;
  return n;
}

// Your shortcuts: Enter = keep, Space = cut, Down = maybe, Z = undo. Arrows and B fill in the rest.
const KEYS: Record<string, Decision> = {
  Enter: 'keep', ArrowRight: 'keep',
  ' ': 'cut', ArrowLeft: 'cut',
  ArrowDown: 'maybe', ArrowUp: 'maybe',
  b: 'bad', B: 'bad',
};

/**
 * Rough time left, from the median gap between your recent swipes. The pace is
 * remembered per project, so the estimate is there as soon as you come back.
 */
function etaText(times: number[], remaining: number, pid: string): string | null {
  if (remaining <= 0) return null;
  const key = `stm.pace.${pid}`;
  let median = 0;
  if (times.length >= 8) {
    const gaps = times.slice(-31).map((t, i, a) => (i ? t - a[i - 1] : 0)).slice(1).sort((a, b) => a - b);
    median = Math.min(gaps[Math.floor(gaps.length / 2)], 30000);
    try { localStorage.setItem(key, String(median)); } catch { /* ignore */ }
  } else {
    try { median = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
  }
  if (!median) return null;
  const min = (remaining * median) / 60000;
  if (min < 1) return 'under a minute';
  return min < 90 ? `about ${Math.round(min)} min` : `about ${(min / 60).toFixed(1)} h`;
}

const filterKey = (pid: string) => `stm.typeFilter.${pid}`;
function savedFilter(pid: string): string | null {
  try { return localStorage.getItem(filterKey(pid)); } catch { return null; }
}

export default function Swipe() {
  const { id } = useParams();
  const pid = id!;
  const [project, setProject] = useState<Project | null>(null);
  const [st, setSt] = useState<ProjectState | null>(null);
  const [queue, setQueue] = useState<Card[]>([]);
  const [cat, setCatState] = useState<string | null>(() => savedFilter(pid));
  const [loaded, setLoaded] = useState<{ phase: Phase; cat: string | null } | null>(null);
  const [info, setInfo] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const [showCuts, setShowCuts] = useState(false);
  const [starting, setStarting] = useState(false);
  const times = useRef<number[]>([]); // when each swipe of this session happened
  const deck = useRef<SwipeDeckHandle>(null);

  const setCat = (c: string | null) => {
    setCatState(c);
    try { c ? localStorage.setItem(filterKey(pid), c) : localStorage.removeItem(filterKey(pid)); } catch { /* ignore */ }
  };

  // All writes go through one chain so they are saved in order.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const done = useRef(new Set<string>()); // decided locally; never re-queue these
  const run = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    pending.current++;
    const p = chain.current.then(fn);
    chain.current = p.catch(() => {});
    return p
      .catch((e: Error) => { setError(e.message); throw e; })
      .finally(() => { pending.current--; });
  }, []);
  /** Only trust saved counters once nothing else is in flight. */
  const settle = useCallback((s: ProjectState) => { if (pending.current <= 0) setSt(s); }, []);

  const loadQueue = useCallback((phase: Phase, c: string | null) => {
    if (phase === 'summary') { setQueue([]); setLoaded({ phase, cat: c }); return Promise.resolve(); }
    return run(() => api.queue(pid, phase, 10, c)).then((r) => {
      done.current.clear();
      setQueue(r.cards);
      setLoaded({ phase, cat: c });
      settle(r.state);
    }).catch(() => {});
  }, [pid, run, settle]);

  useEffect(() => {
    api.project(pid).then((p) => {
      setProject(p);
      if (p.state) setSt(p.state);
    }).catch((e) => setError(e.message));
  }, [pid]);

  const phase = st ? phaseOf(st) : null;

  // Entering a phase, or changing the type filter, loads the matching cards.
  useEffect(() => {
    if (phase && (!loaded || loaded.phase !== phase || loaded.cat !== cat)) void loadQueue(phase, cat);
  }, [phase, cat, loaded, loadQueue]);

  const decide = useCallback((card: Card, d: Decision) => {
    const from: Decision | null = phase === 'maybe' ? 'maybe' : null;
    setSt((s) => s && applyLocal(s, card, from, d));
    done.current.add(card.id);
    if (!from) times.current.push(Date.now());
    const left = queue.length - 1;
    setQueue((q) => q.filter((c) => c.id !== card.id));
    run(() => api.swipe(pid, card.id, d)).then((r) => settle(r.state)).catch(() => {});
    // Top up the queue in the background.
    if (phase && phase !== 'summary' && left < 5) {
      const mode = phase;
      run(() => api.queue(pid, mode, 12, cat)).then((r) => {
        setQueue((q) => {
          if (q.length >= 8) return q;
          const have = new Set(q.map((c) => c.id));
          return [...q, ...r.cards.filter((c) => !have.has(c.id) && !done.current.has(c.id))];
        });
        settle(r.state);
      }).catch(() => {});
    }
  }, [phase, pid, cat, queue.length, run, settle]);

  const undo = useCallback(() => {
    run(async () => {
      const r = await api.undo(pid);
      const next = phaseOf(r.state);
      const q = next === 'summary' ? { cards: [] } : await api.queue(pid, next, 10, cat);
      return { r, next, cards: q.cards };
    }).then(({ r, next, cards }) => {
      done.current.clear();
      // Bring the undone card back on top even if the type filter would hide it.
      const back = r.undone?.to === null && next === 'swipe' ? r.undone.card : null;
      setSt(r.state);
      setQueue(back ? [back, ...cards.filter((c) => c.id !== back.id)] : cards);
      setLoaded({ phase: next, cat });
      setListVersion((v) => v + 1);
    }).catch(() => {});
  }, [pid, cat, run]);

  const move = (card: Card, d: Decision, close: () => void) => {
    run(() => api.swipe(pid, card.id, d)).then((r) => {
      setSt(r.state);
      setListVersion((v) => v + 1);
      close();
    }).catch(() => {});
  };

  const nextRound = () => {
    setStarting(true);
    run(() => api.nextRound(pid)).then((p) => {
      setProject(p);
      setShowCuts(false);
      setLoaded(null);
      if (p.state) setSt(p.state);
    }).catch(() => {}).finally(() => setStarting(false));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (info) return; // the dialog handles its own keys
      const d = KEYS[e.key];
      if (d) {
        e.preventDefault();
        // Enter and Space would also "click" whichever button was tapped last.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        deck.current?.swipe(d);
      }
      else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') { e.preventDefault(); undo(); }
      else if (e.key === 'f' || e.key === 'F') deck.current?.flip();
      else if (e.key === 'i' || e.key === 'I') { if (queue[0]) setInfo(queue[0]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, info, queue]);

  if (error && !st) return <main className="page"><p className="error">{error}</p><Link to="/">Back to projects</Link></main>;
  if (!project || !st || !phase) return <main className="page"><div className="spinner" /></main>;

  const allowed: Decision[] = phase === 'maybe' ? ['keep', 'cut'] : ['keep', 'cut', 'maybe', 'bad'];
  const pct = st.total ? (st.reviewed / st.total) * 100 : 0;
  const msg = targetMessage(st);
  const canUndo = st.reviewed > 0;
  const types = CATEGORIES.filter((c) => st.byType[c]);
  const ready = loaded?.phase === phase && loaded.cat === cat;
  const eta = phase === 'swipe' ? etaText(times.current, st.remaining, pid) : null;
  const typeDone = phase === 'swipe' && ready && !!cat && queue.length === 0;

  const header = (
    <div className="swipe-head">
      <div className="top">
        <Link to={`/projects/${pid}`} className="back" aria-label="Project page">‹</Link>
        <span className="name">{project.name}</span>
        <span className="round-pill">Round {st.round}</span>
      </div>
      <div className="progress" aria-hidden><span style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
      <div className="stats">
        <span><strong>{st.reviewed.toLocaleString()}</strong> of {st.total.toLocaleString()} reviewed</span>
        <span><strong>{st.remaining.toLocaleString()}</strong> left</span>
        <span style={{ color: 'var(--keep)' }}><strong>{st.keep.toLocaleString()}</strong> kept</span>
        <span>target <strong>{st.target}</strong></span>
        {st.maybe > 0 && <span style={{ color: 'var(--maybe)' }}>{st.maybe} maybe</span>}
        {eta && <span className="eta">{eta} left at your pace</span>}
      </div>
    </div>
  );

  if (phase === 'summary') {
    return (
      <main className="page" style={{ maxWidth: 760 }}>
        {header}
        <div className="panel stack summary">
          <div>
            <div className="label">Round {st.round} finished</div>
            <div className="flow">
              <span>{st.total.toLocaleString()}</span>
              <span className="arrow">→</span>
              <span style={{ color: 'var(--keep)' }}>{st.keep.toLocaleString()}</span>
              <span className="cap">pool → kept</span>
            </div>
            <div className={`verdict ${msg.tone}`}>{msg.text}</div>
          </div>
          <div className="pile-counts">
            <span><span className="dot" style={{ background: 'var(--keep)' }} />Kept {st.keep}</span>
            <span><span className="dot" style={{ background: 'var(--cut)' }} />Cut {st.cut}</span>
            <span><span className="dot" style={{ background: 'var(--bad)' }} />Bad {st.bad}</span>
            {st.hidden > 0 && <span className="faint">{st.hidden} hidden by the bad list</span>}
          </div>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            {st.complete && <Link className="btn primary" to={`/projects/${pid}`}>Finish · export</Link>}
            <button className={st.complete ? 'btn' : 'btn primary'} disabled={st.keep === 0 || starting} onClick={nextRound}>
              {st.complete ? `Trim further in round ${st.round + 1}` : `Start round ${st.round + 1} with ${st.keep.toLocaleString()} cards`}
            </button>
            <button className="btn" onClick={undo} disabled={!canUndo}>↶ Undo</button>
            <Link className="btn ghost" to={`/projects/${pid}/rounds/${st.round}`}>Review all lists</Link>
          </div>
          {st.keep === 0 && <p className="muted small">Nothing was kept. Move cards back from the cut list below, or undo.</p>}
        </div>

        {st.complete && (
          <div className="panel" style={{ marginTop: 14 }}>
            <h2 style={{ marginBottom: 10 }}>Decklist</h2>
            <ExportBox projectId={pid} version={`${st.keep}-${st.round}-${st.complete}`} />
          </div>
        )}

        <div className="panel" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>Cut this round <span className="muted">({st.cut})</span></h2>
            {st.cut > 0 && (
              <button className="btn sm" onClick={() => setShowCuts((s) => !s)}>{showCuts ? 'Hide' : 'Review & rescue'}</button>
            )}
          </div>
          {showCuts && (
            <div style={{ marginTop: 14 }}>
              <CardList projectId={pid} round={st.round} list="cut" version={listVersion}
                action={(card, close) => <MoveButtons current="cut" onMove={(d) => move(card, d, close)} />} />
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="swipe-page">
      {header}
      {phase === 'swipe' && types.length > 1 && (
        <div className="type-row">
        <div className="type-bar" role="tablist" aria-label="Filter by card type">
          <button className={`type-chip ${!cat ? 'on' : ''}`} onClick={() => setCat(null)}>
            All <span>{st.reviewed}/{st.total}</span>
          </button>
          {types.map((c) => (
            <button key={c} className={`type-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(cat === c ? null : c)}>
              {c} <span>{st.byType[c].reviewed}/{st.byType[c].total}</span>
            </button>
          ))}
        </div>
        </div>
      )}
      {phase === 'maybe' && (
        <div className="banner">Resolve your maybes: <strong>{st.maybe}</strong> left. Keep or cut each one.</div>
      )}
      <div className="stage">
        {queue.length ? (
          <SwipeDeck ref={deck} cards={queue} allowed={allowed} onDecide={decide} onInfo={setInfo} />
        ) : typeDone ? (
          <div className="empty" style={{ border: 0 }}>
            <h2>All {cat} reviewed</h2>
            <p>{st.remaining.toLocaleString()} cards of other types are left this round.</p>
            <button className="btn primary" onClick={() => setCat(null)}>Show all types</button>
          </div>
        ) : (
          <div className="spinner" />
        )}
      </div>
      {error && <p className="error small" style={{ margin: '4px 0' }}>{error}</p>}
      {/* Reminders of what each swipe direction means. They react to a mouse click
          (for a computer) but not to touch, so a stray thumb cannot decide a card. */}
      <div className="legend">
        {(['cut', 'bad', 'maybe', 'keep'] as Decision[]).filter((d) => allowed.includes(d)).map((d) => (
          <button key={d} className={`dir ${d}`} tabIndex={-1} onClick={() => deck.current?.swipe(d)} disabled={!queue.length}>
            <span className="arrow">{DECISION_META[d].arrow}</span>{DECISION_META[d].label}
          </button>
        ))}
      </div>
      <div className="undo-row">
        <button className="undo-bar" onClick={undo} disabled={!canUndo} title="Undo (Z)">
          <svg className="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
          Undo
        </button>
        <button className="info-btn" onClick={() => queue[0] && setInfo(queue[0])} disabled={!queue.length}
          aria-label="Card details" title="Oracle text (I)">
          <svg className="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="0.6" fill="currentColor" /><path d="M12 11v7" /></svg>
        </button>
      </div>
      <div className="kbd-hint">
        <span className="kbd">Enter</span>keep <span className="kbd">Space</span>cut
        {phase === 'swipe' && <> <span className="kbd">↓</span>maybe <span className="kbd">B</span>bad</>}
        {' '}<span className="kbd">Z</span>undo <span className="kbd">F</span>flip <span className="kbd">I</span>details
      </div>
      {info && <CardModal card={info} onClose={() => setInfo(null)} />}
    </main>
  );
}
