import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { DECISION_META, type Card, type Decision } from '../api';
import { CardImage } from './CardModal';

const VEC: Record<Decision, { x: number; y: number }> = {
  keep: { x: 1, y: 0 },
  cut: { x: -1, y: 0 },
  maybe: { x: 0, y: -1 },
  bad: { x: 0, y: 1 },
};
const THRESHOLD = 90; // px of drag needed to commit
const LONG_PRESS_MS = 450;
const FLY_MS = 240;

export interface SwipeDeckHandle {
  /** Animate the top card away as if it was swiped (buttons, keyboard). */
  swipe: (d: Decision) => void;
  flip: () => void;
}

interface Props {
  cards: Card[]; // cards[0] is on top
  allowed: Decision[];
  onDecide: (card: Card, d: Decision) => void;
  onInfo: (card: Card) => void;
}

function directionOf(dx: number, dy: number): Decision {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'keep' : 'cut';
  return dy < 0 ? 'maybe' : 'bad';
}

export const SwipeDeck = forwardRef<SwipeDeckHandle, Props>(function SwipeDeck(
  { cards, allowed, onDecide, onInfo },
  ref,
) {
  const top = cards[0];
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [leaving, setLeaving] = useState<Decision | null>(null);
  const [flipped, setFlipped] = useState(false);
  const g = useRef({ x: 0, y: 0, active: false, moved: false, held: false, timer: 0 });
  const topId = top?.id;

  useEffect(() => {
    setFlipped(false);
    setDrag(null);
    setLeaving(null);
  }, [topId]);

  // Preload upcoming images so the next card is instant.
  useEffect(() => {
    for (const c of cards.slice(1, 6)) {
      const src = c.images.large ?? c.images.normal;
      if (src) new Image().src = src;
    }
  }, [cards]);

  const fly = (d: Decision) => {
    if (!top || leaving || !allowed.includes(d)) return;
    setLeaving(d);
    try { navigator.vibrate?.(8); } catch { /* not supported */ }
    window.setTimeout(() => {
      // One batched update: the parent drops the card and the deck resets.
      onDecide(top, d);
      setLeaving(null);
      setDrag(null);
      setFlipped(false);
    }, FLY_MS);
  };
  const flip = () => top?.backImages && setFlipped((f) => !f);
  useImperativeHandle(ref, () => ({ swipe: fly, flip }));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (leaving || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = g.current;
    Object.assign(s, { x: e.clientX, y: e.clientY, active: true, moved: false, held: false });
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => {
      if (s.active && !s.moved) {
        s.held = true;
        onInfo(top);
      }
    }, LONG_PRESS_MS);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s.active || s.held) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.moved && Math.hypot(dx, dy) < 8) return;
    s.moved = true;
    window.clearTimeout(s.timer);
    setDrag({ x: dx, y: dy });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s.active) return;
    s.active = false;
    window.clearTimeout(s.timer);
    if (s.held) return setDrag(null);
    if (!s.moved) {
      // Tap flips double-faced cards on touch screens; otherwise it opens the details.
      if (e.pointerType !== 'mouse' && top.backImages) flip();
      else onInfo(top);
      return;
    }
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const d = directionOf(dx, dy);
    if (Math.hypot(dx, dy) > THRESHOLD && allowed.includes(d)) fly(d);
    else setDrag(null);
  };
  const cancel = () => {
    g.current.active = false;
    window.clearTimeout(g.current.timer);
    setDrag(null);
  };

  if (!top) return null;

  let style: CSSProperties;
  if (leaving) {
    const v = VEC[leaving];
    const x = (drag?.x ?? 0) + v.x * window.innerWidth * 1.1;
    const y = (drag?.y ?? 0) + v.y * window.innerHeight * 1.1;
    style = { transform: `translate(${x}px, ${y}px) rotate(${v.x * 22}deg)`, transition: `transform ${FLY_MS}ms ease-in`, opacity: 0.9 };
  } else if (drag) {
    style = { transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * 0.05}deg)` };
  } else {
    style = { transition: 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2)' };
  }

  const hint = leaving ?? (drag ? directionOf(drag.x, drag.y) : null);
  const strength = leaving ? 1 : drag ? Math.min(Math.hypot(drag.x, drag.y) / THRESHOLD, 1) : 0;

  return (
    <div className="deck-stack">
      {cards[1] && (
        <div key={cards[1].id} className={`swipe-card under ${leaving ? 'rising' : ''}`}>
          <CardImage card={cards[1]} size="large" />
        </div>
      )}
      <div
        key={top.id}
        className={`swipe-card ${drag ? 'dragging' : ''}`}
        style={style}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <CardImage card={top} back={flipped} size="large" />
        {allowed.map((d) => (
          <span key={d} className={`stamp ${d}`} style={{ opacity: hint === d ? strength : 0 }}>
            {DECISION_META[d].label}
          </span>
        ))}
        {top.backImages && <span className="dfc-hint">↻ double-faced</span>}
      </div>
    </div>
  );
});
