import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, FORMATS, formatName, type Card, type Project, type SortKey } from '../api';
import { ManaCost } from '../components/Mana';
import { SearchBuilder } from '../components/SearchBuilder';
import { useDebounced } from '../hooks';
import { buildQuery, emptyBuilder, type Builder } from '../query';

const SORTS: { v: SortKey; label: string }[] = [
  { v: 'type', label: 'Card type, then A–Z' },
  { v: 'name', label: 'Name' },
  { v: 'cmc', label: 'Mana value' },
  { v: 'color', label: 'Color' },
  { v: 'random', label: 'Random' },
];
const COMMANDER_FORMATS = ['commander', 'brawl', 'standardbrawl', 'duel', 'oathbreaker', 'paupercommander', 'predh'];

function CommanderPicker({ value, onChange }: { value: Card | null; onChange: (c: Card | null) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Card[] | null>(null);
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q.trim(), 400);

  useEffect(() => {
    if (dq.length < 2) { setResults(null); return; }
    let cancelled = false;
    setBusy(true);
    api.commanders(dq)
      .then((r) => !cancelled && setResults(r))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setBusy(false));
    return () => { cancelled = true; };
  }, [dq]);

  if (value) {
    return (
      <div className="cmd-chosen">
        {value.images.artCrop && <img src={value.images.artCrop} alt="" />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 650 }}>{value.name}</div>
          <div className="small muted">
            Pool limited to its color identity{' '}
            <ManaCost cost={value.colorIdentity.length ? value.colorIdentity.map((c) => `{${c}}`).join('') : '{C}'} />
          </div>
        </div>
        <button type="button" className="btn ghost sm" onClick={() => onChange(null)}>Remove</button>
      </div>
    );
  }
  return (
    <div className="suggest">
      <input className="input" value={q} placeholder="Search a commander by name…" autoCorrect="off"
        onChange={(e) => setQ(e.target.value)} />
      {dq.length >= 2 && (
        <ul>
          {busy && !results && <li className="muted small" style={{ padding: 8 }}>Searching…</li>}
          {results?.length === 0 && <li className="muted small" style={{ padding: 8 }}>No commander found</li>}
          {results?.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c); setQ(''); setResults(null); }}>
                {c.images.artCrop && <img src={c.images.artCrop} alt="" />}
                <span style={{ flex: 1 }}>{c.name}</span>
                <ManaCost cost={c.manaCost} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewProject() {
  const navigate = useNavigate();
  // "New project from this search" passes the project to copy.
  const from = (useLocation().state as { from?: Project } | null)?.from;
  const [name, setName] = useState(from ? `${from.name} (copy)` : '');
  const [format, setFormat] = useState<string>(from ? from.format ?? '' : 'commander');
  const [legalOnly, setLegalOnly] = useState(from?.format ? from.query.includes(`legal:${from.format}`) : true);
  const [deckSize, setDeckSize] = useState(from?.deckSize ?? 100);
  const [commander, setCommander] = useState<Card | null>(from?.commander ?? null);
  const [builder, setBuilder] = useState<Builder>(() => ({ ...emptyBuilder(), ...(from?.builder ?? {}) }));
  const [sort, setSort] = useState<SortKey>(from && SORTS.some((s) => s.v === from.sort) ? from.sort : 'type');
  const [preview, setPreview] = useState<{ total: number; warnings: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(
    () => buildQuery(builder, { format: format || null, legalOnly, commander }),
    [builder, format, legalOnly, commander],
  );
  const dQuery = useDebounced(query, 700);
  const stale = dQuery !== query;

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setPreviewError(null);
    api.preview(dQuery)
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => { if (!cancelled) { setPreview(null); setPreviewError(e.message); } })
      .finally(() => !cancelled && setChecking(false));
    return () => { cancelled = true; };
  }, [dQuery]);

  const pickFormat = (f: string) => {
    setFormat(f);
    setDeckSize(f === 'commander' || f === 'paupercommander' || f === 'predh' || f === 'duel' ? 100 : 60);
    if (!COMMANDER_FORMATS.includes(f)) setCommander(null);
  };

  const create = async () => {
    setError(null);
    if (!name.trim()) return setError('Give the project a name.');
    setSaving(true);
    try {
      const p = await api.createProject({
        name: name.trim(), query, builder, format: format || null, deckSize,
        commanderId: commander?.id ?? null, sort,
      });
      navigate(`/projects/${p.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const total = preview?.total ?? 0;
  const pages = Math.ceil(total / 175);
  const canCreate = !saving && !stale && !checking && !!preview && total > 0;

  return (
    <main className="page has-footer">
      <div className="page-head"><h1>New project</h1></div>

      <div className="panel stack">
        <div className="filters">
          <div className="field wide">
            <label className="label" htmlFor="p-name">Project name</label>
            <input id="p-name" className="input" value={name} placeholder="e.g. Atraxa superfriends"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="p-format">Format</label>
            <select id="p-format" className="input" value={format} onChange={(e) => pickFormat(e.target.value)}>
              <option value="">No format</option>
              {FORMATS.map((f) => <option key={f} value={f}>{formatName(f)}</option>)}
            </select>
            {format && (
              <label className="check small">
                <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} />
                Only cards legal in {formatName(format)}
              </label>
            )}
          </div>
          <div className="field">
            <span className="label">Target deck size</span>
            <div className="row">
              <button type="button" className={`chip ${deckSize === 100 ? 'on' : ''}`} onClick={() => setDeckSize(100)}>Commander 100</button>
              <button type="button" className={`chip ${deckSize === 60 ? 'on' : ''}`} onClick={() => setDeckSize(60)}>Constructed 60</button>
              <input className="input" style={{ width: 84 }} type="number" min={1} max={1000} inputMode="numeric"
                aria-label="Custom deck size" value={deckSize || ''}
                onChange={(e) => setDeckSize(Math.max(0, Math.floor(Number(e.target.value))))} />
            </div>
          </div>
          {(!format || COMMANDER_FORMATS.includes(format)) && (
            <div className="field wide">
              <span className="label">Commander (optional)</span>
              <CommanderPicker value={commander} onChange={setCommander} />
            </div>
          )}
        </div>
      </div>

      <h2 style={{ margin: '22px 0 10px' }}>Search</h2>
      <SearchBuilder value={builder} onChange={setBuilder} />

      <div className="panel" style={{ marginTop: 14 }}>
        <div className="field">
          <label className="label" htmlFor="p-sort">Swipe order</label>
          <select id="p-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="footer-bar">
        <div className="footer-inner">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="count-line">
              {previewError ? <span className="error">{previewError}</span>
                : stale || checking || !preview ? <span className="muted">Counting…</span>
                : <><strong>{total.toLocaleString()}</strong> card{total === 1 ? '' : 's'}
                    {pages > 8 && <span className="muted small"> · about {Math.ceil(pages * 0.6)} s to download</span>}</>}
            </div>
            <code className="query" title={query}>{query}</code>
            {preview?.warnings.map((w, i) => <div key={i} className="small" style={{ color: 'var(--maybe)' }}>{w}</div>)}
            {error && <div className="error small">{error}</div>}
          </div>
          <button className="btn primary" disabled={!canCreate} onClick={create}>
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </main>
  );
}
