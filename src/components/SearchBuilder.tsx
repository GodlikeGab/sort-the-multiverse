import type { ReactNode } from 'react';
import { FORMATS, formatName } from '../api';
import type { AnyAll, Builder, ColorMode, LegalityCrit, NumCrit, Op } from '../query';
import { ColorPicker } from './Mana';

const CARD_TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Kindred'];
const SUPERTYPES = ['Legendary', 'Basic', 'Snow', 'World'];
const RARITIES = ['common', 'uncommon', 'rare', 'mythic'];
const GAMES = [['paper', 'Paper'], ['arena', 'Arena'], ['mtgo', 'MTGO']];
const OPS: { v: Op; label: string }[] = [
  { v: '=', label: '=' }, { v: '<', label: '<' }, { v: '>', label: '>' },
  { v: '<=', label: '≤' }, { v: '>=', label: '≥' }, { v: 'range', label: 'range' },
];
const COLOR_MODES: { v: ColorMode; label: string }[] = [
  { v: 'exact', label: 'Exactly' }, { v: 'including', label: 'Including' }, { v: 'atmost', label: 'At most' },
];

function Seg<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} type="button" className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}
const ANY_ALL: { v: AnyAll; label: string }[] = [{ v: 'any', label: 'Any of' }, { v: 'all', label: 'All of' }];

function Chips({ options, value, onChange }: {
  options: (string | string[])[]; value: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div className="row">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, o];
        const on = value.includes(v);
        return (
          <button key={v} type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <div className={`field ${wide ? 'wide' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input className="input" value={value} placeholder={placeholder} autoCapitalize="none" autoCorrect="off"
      spellCheck={false} onChange={(e) => onChange(e.target.value)} />
  );
}

function Num({ value, onChange, text, prefix }: {
  value: NumCrit; onChange: (v: NumCrit) => void; text?: boolean; prefix?: string;
}) {
  const input = (k: 'a' | 'b', ph: string) => (
    <input className="input" value={value[k]} placeholder={ph} inputMode={text ? 'text' : 'decimal'}
      onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
  );
  return (
    <div className="num">
      <select className="input op" value={value.op} aria-label="Comparison"
        onChange={(e) => onChange({ ...value, op: e.target.value as Op })}>
        {OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
      {prefix && <span className="muted">{prefix}</span>}
      {input('a', value.op === 'range' ? 'min' : 'any')}
      {value.op === 'range' && <>
        <span className="muted">–</span>
        {input('b', 'max')}
      </>}
    </div>
  );
}

function Section({ title, children, open, count }: { title: string; children: ReactNode; open?: boolean; count: number }) {
  return (
    <details className="section" open={open || count > 0 || undefined}>
      <summary>
        <span>{title}</span>
        {count > 0 && <span className="count on">{count}</span>}
      </summary>
      <div className="filters">{children}</div>
    </details>
  );
}

const n = (...xs: unknown[]) =>
  xs.filter((x) =>
    Array.isArray(x) ? x.length : typeof x === 'object' && x ? (x as NumCrit).a || (x as NumCrit).b : x,
  ).length;

export function SearchBuilder({ value: b, onChange }: { value: Builder; onChange: (b: Builder) => void }) {
  const set = <K extends keyof Builder>(k: K, v: Builder[K]) => onChange({ ...b, [k]: v });
  const setLegal = (i: number, patch: Partial<LegalityCrit>) =>
    set('legalities', b.legalities.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="builder">
      <Section title="Text" open count={n(b.name, b.oracle, b.flavor, b.keywords)}>
        <Field label="Name"><Text value={b.name} onChange={(v) => set('name', v)} placeholder="e.g. dragon" /></Field>
        <Field label="Keywords" hint="Comma-separated">
          <Text value={b.keywords} onChange={(v) => set('keywords', v)} placeholder="flying, lifelink" />
        </Field>
        <Field label="Oracle text" wide>
          <Text value={b.oracle} onChange={(v) => set('oracle', v)} placeholder="e.g. draw a card" />
        </Field>
        <Field label="Flavor text" wide>
          <Text value={b.flavor} onChange={(v) => set('flavor', v)} placeholder="e.g. Jaya Ballard" />
        </Field>
      </Section>

      <Section title="Type line" count={n(b.cardTypes, b.supertypes, b.subtypes)}>
        <Field label="Card types" wide>
          <Chips options={CARD_TYPES} value={b.cardTypes} onChange={(v) => set('cardTypes', v)} />
          {b.cardTypes.length > 1 && <Seg value={b.cardTypeMode} options={ANY_ALL} onChange={(v) => set('cardTypeMode', v)} />}
        </Field>
        <Field label="Supertypes" wide>
          <Chips options={SUPERTYPES} value={b.supertypes} onChange={(v) => set('supertypes', v)} />
        </Field>
        <Field label="Subtypes" wide hint="Comma-separated">
          <Text value={b.subtypes} onChange={(v) => set('subtypes', v)} placeholder="elf, warrior" />
          {b.subtypes.includes(',') && <Seg value={b.subtypeMode} options={ANY_ALL} onChange={(v) => set('subtypeMode', v)} />}
        </Field>
      </Section>

      <Section title="Colors" count={n(b.colors, b.identity)}>
        <Field label="Colors">
          <ColorPicker value={b.colors} onChange={(v) => set('colors', v)} />
          <Seg value={b.colorMode} options={COLOR_MODES} onChange={(v) => set('colorMode', v)} />
        </Field>
        <Field label="Color identity">
          <ColorPicker value={b.identity} onChange={(v) => set('identity', v)} />
          <Seg value={b.identityMode} options={COLOR_MODES} onChange={(v) => set('identityMode', v)} />
        </Field>
      </Section>

      <Section title="Mana" count={n(b.mv, b.manaCost, b.produces)}>
        <Field label="Mana value"><Num value={b.mv} onChange={(v) => set('mv', v)} /></Field>
        <Field label="Mana cost symbols" hint="Cost contains these symbols">
          <Text value={b.manaCost} onChange={(v) => set('manaCost', v)} placeholder="{2}{W}{W} or 2WW" />
        </Field>
        <Field label="Produces mana">
          <ColorPicker value={b.produces} onChange={(v) => set('produces', v)} />
        </Field>
      </Section>

      <Section title="Stats" count={n(b.power, b.toughness, b.loyalty)}>
        <Field label="Power"><Num value={b.power} onChange={(v) => set('power', v)} text /></Field>
        <Field label="Toughness"><Num value={b.toughness} onChange={(v) => set('toughness', v)} text /></Field>
        <Field label="Loyalty"><Num value={b.loyalty} onChange={(v) => set('loyalty', v)} text /></Field>
      </Section>

      <Section title="Printing" count={n(b.rarities, b.sets, b.year, b.artist)}>
        <Field label="Rarity" wide>
          <Chips options={RARITIES} value={b.rarities} onChange={(v) => set('rarities', v)} />
        </Field>
        <Field label="Set" hint="Set codes, comma-separated">
          <Text value={b.sets} onChange={(v) => set('sets', v)} placeholder="mh3, ltr" />
        </Field>
        <Field label="Release year"><Num value={b.year} onChange={(v) => set('year', v)} /></Field>
        <Field label="Artist"><Text value={b.artist} onChange={(v) => set('artist', v)} placeholder="e.g. Rebecca Guay" /></Field>
      </Section>

      <Section title="Format legality" count={b.legalities.filter((l) => l.format).length}>
        <div className="field wide">
          {b.legalities.map((l, i) => (
            <div className="num" key={i}>
              <select className="input" value={l.status} aria-label="Status"
                onChange={(e) => setLegal(i, { status: e.target.value as LegalityCrit['status'] })}>
                <option value="legal">Legal in</option>
                <option value="banned">Banned in</option>
                <option value="restricted">Restricted in</option>
              </select>
              <select className="input" value={l.format} aria-label="Format"
                onChange={(e) => setLegal(i, { format: e.target.value })}>
                <option value="">Choose format…</option>
                {FORMATS.map((f) => <option key={f} value={f}>{formatName(f)}</option>)}
              </select>
              <button type="button" className="btn ghost sm" aria-label="Remove"
                onClick={() => set('legalities', b.legalities.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div>
            <button type="button" className="btn sm"
              onClick={() => set('legalities', [...b.legalities, { status: 'legal', format: '' }])}>
              ＋ Add legality rule
            </button>
          </div>
        </div>
      </Section>

      <Section title="Price" count={n(b.usd, b.eur)}>
        <Field label="USD"><Num value={b.usd} onChange={(v) => set('usd', v)} prefix="$" /></Field>
        <Field label="EUR"><Num value={b.eur} onChange={(v) => set('eur', v)} prefix="€" /></Field>
        <span className="hint wide">Scryfall has no CAD prices, so only USD and EUR are available.</span>
      </Section>

      <Section title="Flags" count={n(b.isCommander, b.games)}>
        <Field label="Commander">
          <label className="check">
            <input type="checkbox" checked={b.isCommander} onChange={(e) => set('isCommander', e.target.checked)} />
            Can be a commander (<code>is:commander</code>)
          </label>
        </Field>
        <Field label="Available in">
          <Chips options={GAMES} value={b.games} onChange={(v) => set('games', v)} />
        </Field>
      </Section>

      <Section title="Raw Scryfall query" count={n(b.raw)}>
        <Field label="Added to the criteria above" wide hint="Any Scryfall syntax, e.g. otag:ramp or (o:treasure or o:clue)">
          <textarea className="input" rows={2} value={b.raw} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            placeholder="otag:removal -is:reserved" onChange={(e) => set('raw', e.target.value)} />
        </Field>
      </Section>
    </div>
  );
}
