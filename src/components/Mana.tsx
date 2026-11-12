import { Fragment, useState } from 'react';

/** Scryfall hosts SVGs for every mana symbol, e.g. {W/U} → WU.svg. */
export const symbolUrl = (sym: string) =>
  `https://svgs.scryfall.io/card-symbols/${sym.replace(/\//g, '').toUpperCase()}.svg`;

function Symbol({ sym }: { sym: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="sym-text">{`{${sym}}`}</span>;
  return <img src={symbolUrl(sym)} alt={`{${sym}}`} title={`{${sym}}`} onError={() => setFailed(true)} />;
}

export function ManaCost({ cost }: { cost: string | null | undefined }) {
  if (!cost) return null;
  const halves = cost.split(' // ');
  return (
    <span className="mana">
      {halves.map((half, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="sym-text">&nbsp;//&nbsp;</span>}
          {[...half.matchAll(/\{([^}]+)\}/g)].map((m, j) => (
            <Symbol key={j} sym={m[1]} />
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/** Oracle text with inline mana symbols. */
export function OracleText({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\{[^}]+\}$/.test(p) ? (
          <span key={i} className="mana" style={{ verticalAlign: '-0.15em' }}>
            <Symbol sym={p.slice(1, -1)} />
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export const COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

export function ColorPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (c: string) =>
    onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <div className="color-row">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`pip ${value.includes(c) ? 'on' : ''}`}
          onClick={() => toggle(c)}
          aria-pressed={value.includes(c)}
          title={c}
        >
          <img src={symbolUrl(c)} alt={c} />
        </button>
      ))}
    </div>
  );
}
