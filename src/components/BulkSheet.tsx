import { useEffect, useState } from 'react';
import { api, type BulkCriteria } from '../api';
import { useDebounced } from '../hooks';
import { Modal } from './CardModal';

const num = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

/**
 * Decide many undecided cards at once by card type and mana value, e.g. "cut
 * every remaining land". One undo reverts the whole batch.
 */
export function BulkSheet({ projectId, types, initialType, onApply, onClose }: {
  projectId: number | string;
  types: string[];
  initialType: string | null;
  onApply: (crit: BulkCriteria, decision: 'keep' | 'cut' | 'maybe') => Promise<unknown>;
  onClose: () => void;
}) {
  const [cat, setCat] = useState(initialType ?? '');
  const [mvMin, setMvMin] = useState('');
  const [mvMax, setMvMax] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const crit: BulkCriteria = {
    cat: cat || null, mvMin: num(mvMin), mvMax: num(mvMax),
  };
  const key = useDebounced(JSON.stringify(crit), 250);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    api.bulkCount(projectId, JSON.parse(key)).then((n) => !cancelled && setCount(n));
    return () => { cancelled = true; };
  }, [projectId, key]);

  const apply = async (d: 'keep' | 'cut' | 'maybe') => {
    setBusy(true);
    try {
      await onApply(JSON.parse(key), d);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const stale = key !== JSON.stringify(crit) || count === null;
  const off = busy || stale || !count;

  return (
    <Modal onClose={onClose} narrow>
      <div className="stack">
        <div>
          <h2>Bulk decide</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Applies to cards you have not reviewed yet this round. Leave a field empty for no limit.
          </p>
        </div>
        <div className="field">
          <label className="label" htmlFor="b-type">Card type</label>
          <select id="b-type" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="label">Mana value</span>
          <div className="pair">
            <input className="input" inputMode="numeric" placeholder="at least" aria-label="Mana value at least"
              value={mvMin} onChange={(e) => setMvMin(e.target.value)} />
            <input className="input" inputMode="numeric" placeholder="at most" aria-label="Mana value at most"
              value={mvMax} onChange={(e) => setMvMax(e.target.value)} />
          </div>
        </div>

        <div className="count-line">
          {stale ? <span className="muted">Counting…</span>
            : <><strong>{count!.toLocaleString()}</strong> card{count === 1 ? '' : 's'} match</>}
        </div>
        <div className="row">
          <button className="btn tint cut" disabled={off} onClick={() => apply('cut')}>Cut them</button>
          <button className="btn tint maybe" disabled={off} onClick={() => apply('maybe')}>Maybe</button>
          <button className="btn tint keep" disabled={off} onClick={() => apply('keep')}>Keep them</button>
        </div>
        <span className="hint">One Undo brings the whole batch back.</span>
      </div>
    </Modal>
  );
}
