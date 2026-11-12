import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, DECISION_META, type Decision, type RoundInfo } from '../api';
import { CardList, MoveButtons } from '../components/Shared';

const LISTS: Decision[] = ['keep', 'maybe', 'cut', 'bad'];

export default function RoundPage() {
  const { id, n } = useParams();
  const pid = id!;
  const number = Number(n);
  const [rounds, setRounds] = useState<RoundInfo[] | null>(null);
  const [list, setList] = useState<string>('keep');
  const [version, setVersion] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.rounds(pid).then(setRounds).catch((e) => setError(e.message));
  }, [pid]);
  useEffect(load, [load]);

  if (error) return <main className="page"><p className="error">{error}</p></main>;
  if (!rounds) return <main className="page"><div className="spinner" /></main>;
  const round = rounds.find((r) => r.number === number);
  if (!round) return <main className="page"><p>Round not found.</p><Link to={`/projects/${pid}`}>Back</Link></main>;
  const active = round.status === 'active';

  const move = (cardId: string, d: Decision, close: () => void) =>
    api.swipe(pid, cardId, d).then(() => { close(); setVersion((v) => v + 1); load(); });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Link to={`/projects/${pid}`} className="back-link">‹ Project</Link>
          <h1>Round {round.number}</h1>
          <div className="muted small">
            {(round.pool - round.hidden).toLocaleString()} cards → {round.keep.toLocaleString()} kept ·{' '}
            {active ? 'in progress — tap a card to move it to another list' : 'closed'}
          </div>
        </div>
        <span className="spacer" />
        {active && <Link className="btn primary" to={`/projects/${pid}/swipe`}>Back to swiping</Link>}
      </div>

      {rounds.length > 1 && (
        <div className="tabs">
          {rounds.map((r) => (
            <Link key={r.number} to={`/projects/${pid}/rounds/${r.number}`}
              className={`tab ${r.number === number ? 'on' : ''}`}>Round {r.number}</Link>
          ))}
        </div>
      )}
      <div className="tabs">
        {LISTS.map((l) => (
          <button key={l} className={`tab ${l} ${list === l ? 'on' : ''}`} onClick={() => setList(l)}>
            {DECISION_META[l].label} <span className="count">{round[l]}</span>
          </button>
        ))}
        {round.undecided + round.hidden > 0 && (
          <button className={`tab ${list === 'undecided' ? 'on' : ''}`} onClick={() => setList('undecided')}>
            Not reviewed <span className="count">{round.undecided + round.hidden}</span>
          </button>
        )}
      </div>

      <input className="input" style={{ marginBottom: 14 }} type="search" value={q} placeholder="Find a card by name in this list…"
        aria-label="Find a card by name" onChange={(e) => setQ(e.target.value)} />
      <CardList key={`${number}-${list}`} projectId={pid} round={number} list={list} version={version} search={q}
        action={active && list !== 'undecided'
          ? (card, close) => <MoveButtons current={list} onMove={(d) => move(card.id, d, close)} />
          : undefined} />
    </main>
  );
}
