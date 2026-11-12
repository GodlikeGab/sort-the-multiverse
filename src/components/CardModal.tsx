import { useEffect, useState, type ReactNode } from 'react';
import type { Card, CardFace } from '../api';
import { ManaCost, OracleText } from './Mana';

export function CardImage({ card, back, size = 'normal' }: { card: Card; back?: boolean; size?: 'normal' | 'large' }) {
  const src = back ? card.backImages?.[size] ?? card.backImages?.normal : card.images[size] ?? card.images.normal;
  if (!src) {
    return (
      <div className="card-img fallback-card">
        <strong>{card.name}</strong>
        <span className="muted small">{card.typeLine}</span>
        <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{card.oracleText}</span>
      </div>
    );
  }
  return <img className="card-img" src={src} alt={card.name} draggable={false} />;
}

function Face({ f }: { f: CardFace }) {
  const pt =
    f.power != null && f.toughness != null ? `${f.power}/${f.toughness}`
    : f.loyalty != null ? `Loyalty ${f.loyalty}` : null;
  return (
    <div className="face stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{f.name}</h2>
        <ManaCost cost={f.manaCost} />
      </div>
      <div className="muted small">{f.typeLine}</div>
      {f.oracleText && <div style={{ whiteSpace: 'pre-wrap' }}><OracleText text={f.oracleText} /></div>}
      {pt && <div className="small" style={{ fontWeight: 650 }}>{pt}</div>}
    </div>
  );
}

/** Oracle text for a card. Price and popularity are left out on purpose. */
export function CardDetails({ card }: { card: Card }) {
  const faces: CardFace[] = card.faces?.length ? card.faces : [card];
  return (
    <>
      {faces.map((f, i) => <Face key={i} f={f} />)}
      {card.scryfallUri && (
        <a className="small" href={card.scryfallUri} target="_blank" rel="noreferrer">View on Scryfall ↗</a>
      )}
    </>
  );
}

export function Modal({ onClose, children, narrow }: { onClose: () => void; children: ReactNode; narrow?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className={`modal ${narrow ? 'narrow' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="btn ghost sm close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

export function CardModal({ card, onClose, actions }: { card: Card; onClose: () => void; actions?: ReactNode }) {
  const [back, setBack] = useState(false);
  return (
    <Modal onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <CardImage card={card} back={back} size="large" />
        {card.backImages && (
          <button className="btn sm" onClick={() => setBack((b) => !b)}>↻ Show {back ? 'front' : 'back'}</button>
        )}
      </div>
      <div className="details">
        <CardDetails card={card} />
        {actions}
      </div>
    </Modal>
  );
}

export function CardTile({ card, onClick, badge }: { card: Card; onClick: () => void; badge?: ReactNode }) {
  return (
    <button className="tile" onClick={onClick} title={card.name}>
      {card.images.normal ? (
        <img src={card.images.normal} alt={card.name} loading="lazy" />
      ) : (
        <div className="fallback">{card.name}</div>
      )}
      {badge && <span className="badge">{badge}</span>}
    </button>
  );
}
