import { useEffect, useState } from 'react';
import { api, type Card } from '../api';
import { CardModal, CardTile } from '../components/CardModal';

export default function BadPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [open, setOpen] = useState<Card | null>(null);

  useEffect(() => {
    api.bad().then((r) => { setCards(r.cards); setTotal(r.total); });
  }, []);

  const remove = async (c: Card) => {
    await api.removeBad(c.id);
    setCards((cs) => cs.filter((x) => x.id !== c.id));
    setTotal((t) => (t ?? 1) - 1);
    setOpen(null);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Bad cards</h1>
          <div className="muted small">
            Cards you swiped down. They are hidden from every project unless the project ignores this list.
          </div>
        </div>
      </div>
      {total === null && <div className="spinner" />}
      {total === 0 && <div className="empty"><h2>Nothing here yet</h2><p>Swipe a card down to add it.</p></div>}
      <div className="grid">
        {cards.map((c) => <CardTile key={c.id} card={c} onClick={() => setOpen(c)} />)}
      </div>
      {total != null && cards.length < total && (
        <div className="row center" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => api.bad(cards.length).then((r) => setCards((c) => [...c, ...r.cards]))}>Load more</button>
        </div>
      )}
      {open && (
        <CardModal card={open} onClose={() => setOpen(null)}
          actions={<button className="btn" onClick={() => remove(open)}>Remove from bad list</button>} />
      )}
    </main>
  );
}
