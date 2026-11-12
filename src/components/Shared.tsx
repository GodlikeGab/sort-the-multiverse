import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, BASICS, DECISION_META, SNOW_BASICS, type Card, type Decision, type Project, type ProjectState } from '../api';
import { categoryOf } from '../cards';
import { copyText, useDebounced } from '../hooks';
import { download } from '../store';
import { CardModal, CardTile } from './CardModal';

/** Buttons that move a reviewed card to another list. */
export function MoveButtons({ current, onMove }: { current: string; onMove: (d: Decision) => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">Move to</span>
      <div className="row">
        {(['keep', 'maybe', 'cut'] as Decision[]).filter((d) => d !== current).map((d) => (
          <button key={d} className={`btn tint ${d}`} onClick={() => onMove(d)}>{DECISION_META[d].label}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * One list of a round (keep / cut / maybe / bad), grouped by card type and
 * sorted A–Z inside each type. `action` adds controls to the card dialog.
 */
export function CardList({ projectId, round, list, action, version = 0, search = '' }: {
  projectId: number | string;
  round: number;
  list: string;
  action?: (card: Card, close: () => void) => ReactNode;
  version?: number; // bump to reload
  search?: string; // name filter
}) {
  const q = useDebounced(search, 250);
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [open, setOpen] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api.roundCards(projectId, round, list, 0, q)
      .then((r) => { if (!cancelled) { setCards(r.cards); setTotal(r.total); } })
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [projectId, round, list, version, q]);

  const more = () => {
    setBusy(true);
    api.roundCards(projectId, round, list, cards.length, q)
      .then((r) => setCards((c) => [...c, ...r.cards]))
      .finally(() => setBusy(false));
  };

  return (
    <>
      {total === 0 && <p className="muted">{q ? 'No card with that name in this list.' : 'No cards in this list.'}</p>}
      <div className="grid">
        {cards.map((c, i) => {
          const cat = categoryOf(c.typeLine);
          const first = i === 0 || categoryOf(cards[i - 1].typeLine) !== cat;
          return (
            <Fragment key={c.id}>
              {first && <h3 className="group-head">{cat}</h3>}
              <CardTile card={c} onClick={() => setOpen(c)} />
            </Fragment>
          );
        })}
      </div>
      {busy && <div className="spinner" />}
      {!busy && total != null && cards.length < total && (
        <div className="row center" style={{ marginTop: 16 }}>
          <button className="btn" onClick={more}>Load more ({(total - cards.length).toLocaleString()} left)</button>
        </div>
      )}
      {open && (
        <CardModal card={open} onClose={() => setOpen(null)} actions={action?.(open, () => setOpen(null))} />
      )}
    </>
  );
}

/** Deck size − basics − commander = non-basic target. */
export function TargetMath({ s }: { s: ProjectState }) {
  return (
    <div className="math">
      <div><span className="big">{s.deckSize}</span><span className="cap">deck size</span></div>
      <span className="sym">−</span>
      <div><span className="big">{s.basicsTotal}</span><span className="cap">basics</span></div>
      {s.commanderCount > 0 && <>
        <span className="sym">−</span>
        <div><span className="big">{s.commanderCount}</span><span className="cap">commander</span></div>
      </>}
      <span className="sym">=</span>
      <div className="result"><span className="big">{s.target}</span><span className="cap">non-basic target</span></div>
    </div>
  );
}

/** One line describing how the kept cards compare to the target. */
export function targetMessage(s: ProjectState): { text: string; tone: 'ok' | 'warn' | 'info' } {
  if (s.complete) return { text: 'Deck complete', tone: 'ok' };
  if (s.target < 0) return { text: `Basics and commander exceed the deck size by ${-s.target}`, tone: 'warn' };
  if (s.toCut > 0) {
    const basics = s.basicsTotal ? ` (with ${s.basicsTotal} basic${s.basicsTotal === 1 ? '' : 's'})` : ' (before any basic lands)';
    return { text: `${s.toCut} over the deck size${basics} — cut more`, tone: 'info' };
  }
  if (s.toCut < 0) {
    const n = -s.toCut;
    return { text: `${n} open slot${n === 1 ? '' : 's'} — fill ${n === 1 ? 'it' : 'them'} with basic lands, or keep more cards`, tone: 'info' };
  }
  return { text: `Exactly ${s.target} kept`, tone: 'ok' };
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="stepper">
      <span className="name">{label}</span>
      <button type="button" className="btn sm" onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label={`Fewer ${label}`}>−</button>
      <input className="input" inputMode="numeric" value={value} aria-label={label}
        onChange={(e) => onChange(Math.max(0, Math.min(999, Math.floor(Number(e.target.value.replace(/\D/g, '')) || 0))))} />
      <button type="button" className="btn sm" onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>＋</button>
    </div>
  );
}

/** Basic land counts. Saves on every change and reports the updated project. */
export function BasicsEditor({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [basics, setBasics] = useState(project.basics);
  const current = useRef(basics);
  const latest = useRef(0);
  const change = (name: string, n: number) => {
    const next = { ...current.current, [name]: n };
    current.current = next;
    setBasics(next);
    const ticket = ++latest.current;
    api.updateProject(project.id, { basics: next }).then((p) => ticket === latest.current && onSaved(p));
  };
  const hasSnow = SNOW_BASICS.some((b) => basics[b] > 0);
  const s = project.state;
  const openSlots = s && s.resolved ? -s.toCut : 0; // only meaningful once the round is decided
  const fill = () =>
    api.fillBasics(project.id).then((p) => {
      latest.current++;
      current.current = p.basics;
      setBasics(p.basics);
      onSaved(p);
    });
  return (
    <div className="stack" style={{ gap: 10 }}>
      {openSlots > 0 && (
        <div className="reminder" style={{ marginBottom: 0 }}>
          <span style={{ flex: 1, minWidth: 160 }}>
            <strong>{openSlots}</strong> open slot{openSlots === 1 ? '' : 's'} in the deck.
          </span>
          <button type="button" className="btn sm primary" onClick={fill}>Fill with basics</button>
        </div>
      )}
      <div className="steppers">
        {BASICS.map((b) => <Stepper key={b} label={b} value={basics[b] ?? 0} onChange={(n) => change(b, n)} />)}
      </div>
      <details open={hasSnow || undefined}>
        <summary className="muted small" style={{ cursor: 'pointer' }}>Snow basics</summary>
        <div className="steppers" style={{ marginTop: 10 }}>
          {SNOW_BASICS.map((b) => <Stepper key={b} label={b} value={basics[b] ?? 0} onChange={(n) => change(b, n)} />)}
        </div>
      </details>
    </div>
  );
}

const CURVE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

/** Numbers about the kept cards: counts by type and mana curve. */
export function DeckStats({ projectId, version }: { projectId: number | string; version: unknown }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof api.deckStats>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.deckStats(projectId).then((x) => !cancelled && setD(x)).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, version]);

  if (!d) return null;
  if (!d.count) return <p className="muted" style={{ margin: 0 }}>Nothing kept yet this round.</p>;
  const maxCurve = Math.max(1, ...d.curve);
  const maxType = Math.max(1, ...d.byType.map((t) => t.count));
  return (
    <div className="stack">
      <div className="stat-tiles">
        <div className="stat-tile"><span className="big">{d.count.toLocaleString()}</span><span className="cap">kept cards</span></div>
        <div className="stat-tile"><span className="big">{d.lands}</span><span className="cap">lands incl. {d.basics} basics</span></div>
        <div className="stat-tile"><span className="big">{d.avgMv.toFixed(2)}</span><span className="cap">avg mana value</span></div>
      </div>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>Mana curve (non-land cards)</div>
        <div className="curve" role="img" aria-label={`Mana curve: ${d.curve.map((n, i) => `${n} at ${CURVE_LABELS[i]}`).join(', ')}`}>
          {d.curve.map((n, i) => (
            <div className="col" key={i} title={`Mana value ${CURVE_LABELS[i]}: ${n} card${n === 1 ? '' : 's'}`}>
              <span className="n">{n || ''}</span>
              <span className="bar" style={{ height: `${(n / maxCurve) * 82}%` }} />
            </div>
          ))}
        </div>
        <div className="curve-axis">{CURVE_LABELS.map((l) => <span key={l}>{l}</span>)}</div>
      </div>

      <div>
        <div className="label" style={{ marginBottom: 8 }}>By card type</div>
        <div className="type-rows">
          {d.byType.map((t) => (
            <Fragment key={t.type}>
              <span>{t.type}</span>
              <span className="track"><span className="fill" style={{ width: `${(t.count / maxType) * 100}%` }} /></span>
              <span className="v">{t.count}</span>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ManaBox-style decklist with download and copy buttons. `version` reloads it. */
export function ExportBox({ projectId, version }: { projectId: number | string; version: unknown }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.exportDeck>> | null>(null);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.exportDeck(projectId).then((d) => !cancelled && setData(d)).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId, version]);

  const copy = useCallback(async () => {
    if (!data) return;
    if (await copyText(data.text, area.current)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }, [data]);

  if (!data) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="muted small">
        {data.count} of {data.deckSize} cards{data.complete ? ' · complete' : ' · current kept list'}
      </span>
      <div className="row">
        <button className="btn primary" disabled={!data.text}
          onClick={() => download(data.fileName, data.text, 'text/plain')}>
          Export to ManaBox (.txt)
        </button>
        <button className="btn" onClick={copy} disabled={!data.text}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <textarea ref={area} className="input export" readOnly value={data.text} rows={Math.min(14, Math.max(4, data.text.split('\n').length))}
        placeholder="Nothing kept yet." onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}
