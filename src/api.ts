import type { Builder } from './query';

export type Decision = 'keep' | 'cut' | 'maybe' | 'bad';
/** Swipe orders. Price and popularity are deliberately not offered. */
export type SortKey = 'type' | 'name' | 'cmc' | 'color' | 'random';

export interface CardFace {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
}

export interface Card extends CardFace {
  id: string;
  cmc: number;
  colors: string[];
  colorIdentity: string[];
  rarity: string | null;
  setName: string | null;
  prices: { usd: number | null; eur: number | null };
  edhrecRank: number | null;
  images: { normal: string | null; large: string | null; artCrop: string | null };
  backImages: { normal: string | null; large: string | null } | null;
  faces: CardFace[] | null;
  scryfallUri: string | null;
  decision?: Decision | null;
}

export interface ProjectState {
  round: number;
  total: number; // cards to review this round
  reviewed: number;
  remaining: number;
  keep: number;
  cut: number;
  maybe: number;
  bad: number;
  hidden: number; // hidden by the global bad list
  deckSize: number;
  basicsTotal: number;
  commanderCount: number;
  target: number; // non-basic cards wanted
  toCut: number;
  resolved: boolean;
  complete: boolean;
  deckFromPool: boolean;
  /** Per card type this round: cards to review and how many are decided. */
  byType: Record<string, { total: number; reviewed: number }>;
}

export interface Project {
  id: number;
  name: string;
  query: string;
  builder: Partial<Builder>;
  format: string | null;
  deckSize: number;
  commander: Card | null;
  sort: SortKey;
  ignoreBad: boolean;
  basics: Record<string, number>;
  status: 'loading' | 'ready' | 'error';
  load: { fetched: number; total: number; error: string | null; warning?: string | null };
  createdAt: string;
  lastActivityAt: string | null;
  state: ProjectState | null;
}

export interface RoundInfo {
  number: number;
  status: 'active' | 'closed';
  startedAt: string;
  closedAt: string | null;
  pool: number;
  keep: number;
  cut: number;
  maybe: number;
  bad: number;
  hidden: number;
  undecided: number;
}

export interface NewProject {
  name: string;
  query: string;
  builder: Builder;
  format: string | null;
  deckSize: number;
  commanderId: string | null;
  sort: SortKey;
}

export { api } from './store';
export type { BulkCriteria } from './store';

export const DECISION_META: Record<Decision, { label: string; arrow: string; color: string }> = {
  keep: { label: 'Keep', arrow: '→', color: 'var(--keep)' },
  cut: { label: 'Cut', arrow: '←', color: 'var(--cut)' },
  maybe: { label: 'Maybe', arrow: '↑', color: 'var(--maybe)' },
  bad: { label: 'Bad', arrow: '↓', color: 'var(--bad)' },
};

export const FORMATS = [
  'commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'brawl',
  'standardbrawl', 'historic', 'timeless', 'alchemy', 'oathbreaker', 'paupercommander',
  'duel', 'premodern', 'oldschool', 'predh', 'penny', 'gladiator',
];
const FORMAT_NAMES: Record<string, string> = {
  standardbrawl: 'Standard Brawl',
  paupercommander: 'Pauper Commander',
  predh: 'PreDH',
  oldschool: 'Old School',
  duel: 'Duel Commander',
};
export const formatName = (f: string | null | undefined) =>
  !f ? 'No format' : FORMAT_NAMES[f] ?? f.charAt(0).toUpperCase() + f.slice(1);

export const BASICS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];
export const SNOW_BASICS = [
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest', 'Snow-Covered Wastes',
];

export const money = (n: number | null | undefined, sym = '$') =>
  n == null ? '—' : `${sym}${n.toFixed(2)}`;
