/**
 * The search builder's state and its translation into Scryfall search syntax
 * (https://scryfall.com/docs/syntax).
 */
export type Op = '=' | '<' | '>' | '<=' | '>=' | 'range';
export interface NumCrit {
  op: Op;
  a: string;
  b: string; // upper bound, only for "range"
}
export type ColorMode = 'exact' | 'including' | 'atmost';
export type AnyAll = 'any' | 'all';
export interface LegalityCrit {
  status: 'legal' | 'banned' | 'restricted';
  format: string;
}

export interface Builder {
  name: string;
  oracle: string;
  flavor: string;
  keywords: string;
  cardTypes: string[];
  cardTypeMode: AnyAll;
  supertypes: string[];
  subtypes: string;
  subtypeMode: AnyAll;
  colors: string[];
  colorMode: ColorMode;
  identity: string[];
  identityMode: ColorMode;
  mv: NumCrit;
  manaCost: string;
  produces: string[];
  power: NumCrit;
  toughness: NumCrit;
  loyalty: NumCrit;
  rarities: string[];
  sets: string;
  year: NumCrit;
  artist: string;
  legalities: LegalityCrit[];
  usd: NumCrit;
  eur: NumCrit;
  isCommander: boolean;
  games: string[];
  raw: string;
}

const num = (): NumCrit => ({ op: '=', a: '', b: '' });

export const emptyBuilder = (): Builder => ({
  name: '', oracle: '', flavor: '', keywords: '',
  cardTypes: [], cardTypeMode: 'any', supertypes: [], subtypes: '', subtypeMode: 'all',
  colors: [], colorMode: 'including', identity: [], identityMode: 'atmost',
  mv: num(), manaCost: '', produces: [],
  power: num(), toughness: num(), loyalty: num(),
  rarities: [], sets: '', year: num(), artist: '',
  legalities: [],
  usd: { op: '<=', a: '', b: '' }, eur: { op: '<=', a: '', b: '' },
  isCommander: false, games: [],
  raw: '',
});

const quote = (s: string) => `"${s.replace(/"/g, '').trim()}"`;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const group = (terms: string[], mode: AnyAll) =>
  terms.length <= 1 || mode === 'all' ? terms.join(' ') : `(${terms.join(' or ')})`;

function numTerm(key: string, c: NumCrit): string[] {
  const a = c.a.trim();
  const b = c.b.trim();
  if (c.op === 'range') {
    return [a && `${key}>=${a}`, b && `${key}<=${b}`].filter(Boolean) as string[];
  }
  return a ? [`${key}${c.op}${a}`] : [];
}

const COLOR_OPS: Record<ColorMode, string> = { exact: '=', including: '>=', atmost: '<=' };
function colorTerm(key: string, colors: string[], mode: ColorMode): string[] {
  if (!colors.length) return [];
  const real = colors.filter((c) => c !== 'C').join('').toLowerCase();
  if (!real) return [`${key}=c`]; // only "colorless" picked
  return [`${key}${COLOR_OPS[mode]}${real}`];
}

/** Builder state → list of Scryfall terms. */
export function builderTerms(b: Builder): string[] {
  const t: string[] = [];
  for (const w of b.name.split(/\s+/).filter(Boolean)) t.push(`name:${quote(w)}`);
  if (b.oracle.trim()) t.push(`o:${quote(b.oracle)}`);
  if (b.flavor.trim()) t.push(`ft:${quote(b.flavor)}`);
  for (const k of list(b.keywords)) t.push(`keyword:${quote(k)}`);

  if (b.cardTypes.length) t.push(group(b.cardTypes.map((x) => `t:${x.toLowerCase()}`), b.cardTypeMode));
  for (const s of b.supertypes) t.push(`t:${s.toLowerCase()}`);
  const subs = list(b.subtypes);
  if (subs.length) t.push(group(subs.map((x) => `t:${quote(x)}`), b.subtypeMode));

  t.push(...colorTerm('c', b.colors, b.colorMode));
  t.push(...colorTerm('id', b.identity, b.identityMode));

  t.push(...numTerm('mv', b.mv));
  if (b.manaCost.trim()) t.push(`m:${b.manaCost.replace(/\s+/g, '')}`);
  if (b.produces.length) t.push(`produces:${b.produces.join('').toLowerCase()}`);

  t.push(...numTerm('pow', b.power), ...numTerm('tou', b.toughness), ...numTerm('loy', b.loyalty));

  if (b.rarities.length) t.push(group(b.rarities.map((r) => `r:${r}`), 'any'));
  const sets = b.sets.split(/[\s,]+/).filter(Boolean);
  if (sets.length) t.push(group(sets.map((s) => `s:${s.toLowerCase()}`), 'any'));
  t.push(...numTerm('year', b.year));
  if (b.artist.trim()) t.push(`a:${quote(b.artist)}`);

  for (const l of b.legalities) if (l.format) t.push(`${l.status}:${l.format}`);

  t.push(...numTerm('usd', b.usd), ...numTerm('eur', b.eur));

  if (b.isCommander) t.push('is:commander');
  if (b.games.length) t.push(group(b.games.map((g) => `game:${g}`), 'any'));

  const raw = b.raw.trim();
  if (raw) t.push(/\bor\b/i.test(raw) ? `(${raw})` : raw);
  return t;
}

export interface ProjectContext {
  format: string | null;
  legalOnly: boolean;
  commander: { id: string; name: string; colorIdentity: string[] } | null;
}

/** The full query a project runs: builder + format + commander identity, minus basic lands. */
export function buildQuery(b: Builder, ctx: ProjectContext): string {
  const t = builderTerms(b);
  if (ctx.format && ctx.legalOnly) t.push(`legal:${ctx.format}`);
  if (ctx.commander) {
    const ci = ctx.commander.colorIdentity.join('').toLowerCase();
    t.push(ci ? `id<=${ci}` : 'id=c');
    // Excluded by id, not by name, so quotes or accents in the name can't break it.
    t.push(`-oracleid:${ctx.commander.id}`);
  }
  t.push('-t:basic'); // basics are added as counts in the project instead
  return t.join(' ');
}
