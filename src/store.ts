/**
 * All app data, stored on this device in IndexedDB. Nothing leaves the phone
 * except the search requests sent to Scryfall.
 *
 * Stores:
 *   projects  one record per project (settings, rounds, cached progress)
 *   cards     every card a search has returned, by Scryfall oracle id
 *   rc        "round cards": one record per card per round, with its decision
 *   log       every decision change, so undo is unlimited and exact
 *   bad       the global bad-cards list
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  Card, Decision, NewProject, Project, ProjectState, RoundInfo, SortKey,
} from './api';
import { CATEGORIES, categoryOf, categoryRank } from './cards';
import type { Builder } from './query';
import { fetchByOracleIds, searchAll, searchFirstPage, toCard } from './scryfall';

const ALL_BASICS = [
  'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
  'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
  'Snow-Covered Mountain', 'Snow-Covered Forest', 'Snow-Covered Wastes',
];
const DECISIONS: Decision[] = ['keep', 'cut', 'maybe', 'bad'];

interface RoundMeta {
  number: number;
  status: 'active' | 'closed';
  startedAt: string;
  closedAt: string | null;
}
interface ProjectRec {
  id: number;
  name: string;
  query: string;
  builder: Partial<Builder>;
  format: string | null;
  deckSize: number;
  commanderId: string | null;
  sort: SortKey;
  ignoreBad: boolean;
  basics: Record<string, number>;
  currentRound: number;
  status: 'loading' | 'ready' | 'error';
  load: { fetched: number; total: number; error: string | null; warning?: string | null };
  createdAt: string;
  lastActivityAt: string | null;
  rounds: RoundMeta[];
  state: ProjectState | null; // cached so the home screen is instant
}
interface Rc {
  pid: number;
  round: number;
  cardId: string;
  name: string;
  cat: string; // card type category, for filtering and grouping
  pos: number; // swipe order
  d: Decision | null;
}
interface LogRec {
  seq?: number;
  pid: number;
  round: number;
  cardId: string;
  prev: Decision | null;
  d: Decision;
  badAdded: boolean; // this swipe put the card on the global bad list
  batch?: number; // set on bulk actions, so undo reverts them together
}

/** Which undecided cards a bulk action applies to. Empty fields mean "no limit". */
export interface BulkCriteria {
  cat?: string | null; // card type
  mvMin?: number | null;
  mvMax?: number | null;
}

const STORES = ['projects', 'cards', 'rc', 'log', 'bad'] as const;
const now = () => new Date().toISOString();
const fail = (msg: string): never => { throw new Error(msg); };

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb() {
  dbPromise ??= (async () => {
    // Version history: 1 = projects/cards/rc/log/bad, 2 = + snapshots (automatic local backups).
    const db = await openDB('sort-the-multiverse', 2, {
      upgrade(d, oldVersion) {
        if (oldVersion < 2) d.createObjectStore('snapshots', { keyPath: 'id' });
        if (oldVersion >= 1) return;
        d.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('cards', { keyPath: 'id' });
        d.createObjectStore('rc', { keyPath: ['pid', 'round', 'cardId'] });
        d.createObjectStore('log', { keyPath: 'seq', autoIncrement: true }).createIndex('pr', ['pid', 'round']);
        d.createObjectStore('bad', { keyPath: 'cardId' });
      },
    });
    // Ask the browser not to evict this data when the device runs low on space.
    void navigator.storage?.persist?.().catch(() => {});
    // A download that was running when the app was closed can't continue.
    for (const p of (await db.getAll('projects')) as ProjectRec[]) {
      if (p.status === 'loading') {
        p.status = 'error';
        p.load.error = 'The download was interrupted. Retry to fetch the cards again.';
        await db.put('projects', p);
      }
    }
    return db;
  })();
  return dbPromise;
}

// ---------- in-memory view of rounds (kept in step with the database) ----------

interface RoundMem { items: Rc[]; byId: Map<string, Rc> }
const roundCache = new Map<string, RoundMem>();
let badSet: Set<string> | null = null;

async function loadRound(pid: number, round: number): Promise<RoundMem> {
  const key = `${pid}:${round}`;
  let mem = roundCache.get(key);
  if (!mem) {
    const db = await getDb();
    const items = (await db.getAll('rc', IDBKeyRange.bound([pid, round], [pid, round, []]))) as Rc[];
    items.sort((a, b) => a.pos - b.pos);
    mem = { items, byId: new Map(items.map((i) => [i.cardId, i])) };
    if (roundCache.size >= 4) roundCache.delete(roundCache.keys().next().value!);
    roundCache.set(key, mem);
  }
  return mem;
}
const dropCache = (pid: number) => {
  for (const k of [...roundCache.keys()]) if (k.startsWith(`${pid}:`)) roundCache.delete(k);
};

async function getBad(): Promise<Set<string>> {
  if (!badSet) badSet = new Set((await (await getDb()).getAllKeys('bad')) as string[]);
  return badSet;
}

async function getRec(id: number | string): Promise<ProjectRec> {
  const p = (await (await getDb()).get('projects', Number(id))) as ProjectRec | undefined;
  return p ?? fail('Project not found');
}
async function getReady(id: number | string) {
  const p = await getRec(id);
  if (p.status !== 'ready') fail('Project cards are not loaded yet');
  return p;
}

function counts(p: ProjectRec, items: Rc[], bad: Set<string>) {
  const c = { pool: items.length, keep: 0, cut: 0, maybe: 0, bad: 0, hidden: 0, undecided: 0 };
  for (const i of items) {
    if (i.d) c[i.d]++;
    else if (!p.ignoreBad && bad.has(i.cardId)) c.hidden++; // hidden by the global bad list
    else c.undecided++;
  }
  return c;
}

/** Everything the UI shows about where a project stands. */
function computeState(p: ProjectRec, items: Rc[], bad: Set<string>): ProjectState {
  const c = counts(p, items, bad);
  const byType: ProjectState['byType'] = {};
  for (const i of items) {
    if (!i.d && !p.ignoreBad && bad.has(i.cardId)) continue; // hidden
    const t = (byType[i.cat ?? 'Other'] ??= { total: 0, reviewed: 0 });
    t.total++;
    if (i.d) t.reviewed++;
  }
  const basicsTotal = Object.values(p.basics).reduce((a, b) => a + b, 0);
  const commanderCount = p.commanderId ? 1 : 0;
  const target = p.deckSize - basicsTotal - commanderCount; // non-basic cards wanted
  const total = c.pool - c.hidden;
  const reviewed = c.keep + c.cut + c.maybe + c.bad;
  const resolved = c.undecided === 0 && c.maybe === 0;
  // Complete: the round is fully decided and the keeps fill the deck exactly.
  // (A fresh round whose whole pool already equals the target also counts.)
  const freshExact = reviewed === 0 && p.currentRound > 1 && total === target;
  return {
    round: p.currentRound, total, reviewed, remaining: c.undecided,
    keep: c.keep, cut: c.cut, maybe: c.maybe, bad: c.bad, hidden: c.hidden,
    deckSize: p.deckSize, basicsTotal, commanderCount, target,
    toCut: (freshExact ? total : c.keep) - target,
    resolved,
    complete: total > 0 && ((resolved && c.keep === target) || freshExact),
    deckFromPool: freshExact,
    byType,
  };
}

async function freshState(p: ProjectRec): Promise<ProjectState | null> {
  if (p.status !== 'ready') return null;
  return computeState(p, (await loadRound(p.id, p.currentRound)).items, await getBad());
}

async function toProject(p: ProjectRec, state: ProjectState | null): Promise<Project> {
  const db = await getDb();
  return {
    id: p.id, name: p.name, query: p.query, builder: p.builder, format: p.format,
    deckSize: p.deckSize,
    commander: p.commanderId ? ((await db.get('cards', p.commanderId)) as Card) ?? null : null,
    sort: p.sort, ignoreBad: p.ignoreBad, basics: p.basics, status: p.status, load: p.load,
    createdAt: p.createdAt, lastActivityAt: p.lastActivityAt, state,
  };
}

async function bulkMatch(p: ProjectRec, crit: BulkCriteria): Promise<Rc[]> {
  const { items } = await loadRound(p.id, p.currentRound);
  const bad = await getBad();
  let hits = items.filter(
    (i) => !i.d && (p.ignoreBad || !bad.has(i.cardId)) && (!crit.cat || i.cat === crit.cat),
  );
  const has = (n: number | null | undefined): n is number => n != null && !Number.isNaN(n);
  if (has(crit.mvMin) || has(crit.mvMax)) {
    const cards = new Map((await getCards(hits.map((i) => i.cardId))).map((c) => [c.id, c]));
    hits = hits.filter((i) => {
      const c = cards.get(i.cardId);
      if (!c) return false;
      if (has(crit.mvMin) && c.cmc < crit.mvMin) return false;
      if (has(crit.mvMax) && c.cmc > crit.mvMax) return false;
      return true;
    });
  }
  return hits;
}

async function getCards(ids: string[]): Promise<Card[]> {
  const db = await getDb();
  const tx = db.transaction('cards');
  const cards = await Promise.all(ids.map((id) => tx.store.get(id) as Promise<Card | undefined>));
  return cards.filter((c): c is Card => !!c);
}

function cleanBasics(raw: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of ALL_BASICS) {
    const n = Math.floor(Number(raw[name]));
    if (n > 0) out[name] = Math.min(n, 999);
  }
  return out;
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/** Runs the saved search on Scryfall (all pages) and stores it as round 1. */
async function downloadProject(id: number) {
  const db = await getDb();
  // Keep the screen on: a phone that sleeps mid-download would interrupt it.
  const lock = await (navigator as any).wakeLock?.request('screen').catch(() => null);
  try {
    const p = await getRec(id);
    let lastTotal = 0;
    const raw = await searchAll(p.query, p.sort, (fetched, total) => {
      lastTotal = total;
      // Read and write in one transaction so a late progress update can never
      // overwrite the finished project.
      const ptx = db.transaction('projects', 'readwrite');
      void ptx.store.get(id).then((cur: ProjectRec | undefined) => {
        if (cur && cur.status === 'loading') void ptx.store.put({ ...cur, load: { fetched, total, error: null } });
      });
      void ptx.done.catch(() => {});
    });
    const bad = await getBad();
    if (!raw.length) fail('The search returned no cards.');
    const seen = new Set<string>();
    const cards = raw.map(toCard).filter((c) => !seen.has(c.id) && seen.add(c.id));
    if (p.sort === 'random') shuffle(cards);
    if (p.sort === 'type') {
      // Scryfall returned them A–Z; a stable sort by category keeps that order inside each type.
      const rank = new Map(cards.map((c) => [c.id, categoryRank(categoryOf(c.typeLine))]));
      cards.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }
    // Guard against cards silently going missing: every card Scryfall counted must be saved.
    const reported = lastTotal || raw.length;
    const warning =
      cards.length !== reported || cards.some((c) => !c.name)
        ? `Scryfall reported ${reported} cards but ${cards.length} were saved. Retry the download if this looks wrong.`
        : null;

    const tx = db.transaction(['projects', 'cards', 'rc', 'log'], 'readwrite');
    const cur = (await tx.objectStore('projects').get(id)) as ProjectRec | undefined;
    if (!cur) return void tx.abort(); // deleted while downloading
    void tx.objectStore('rc').delete(IDBKeyRange.bound([id], [id, []]));
    const rcs: Rc[] = cards.map((c, pos) => ({ pid: id, round: 1, cardId: c.id, name: c.name, cat: categoryOf(c.typeLine), pos, d: null }));
    for (const c of cards) void tx.objectStore('cards').put(c);
    for (const r of rcs) void tx.objectStore('rc').put(r);
    const next: ProjectRec = {
      ...cur, status: 'ready', currentRound: 1,
      load: { fetched: cards.length, total: reported, error: null, warning },
      rounds: [{ number: 1, status: 'active', startedAt: now(), closedAt: null }],
      state: null,
    };
    next.state = computeState(next, rcs, bad);
    void tx.objectStore('projects').put(next);
    await tx.done;
    dropCache(id);
    changeListener();
  } catch (err) {
    const cur = (await db.get('projects', id)) as ProjectRec | undefined;
    if (cur) {
      await db.put('projects', {
        ...cur, status: 'error',
        load: { ...cur.load, error: err instanceof Error ? err.message : String(err) },
      });
    }
  } finally {
    void lock?.release?.().catch(() => {});
  }
}
export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------- automatic backups (see autosave.ts) ----------

let changeListener: () => void = () => {};
/** autosave.ts registers here to hear about every saved change. */
export function setChangeListener(fn: () => void) { changeListener = fn; }

const D_CODE: Record<string, string> = { keep: 'k', cut: 'c', maybe: 'm', bad: 'b' };
const D_NAME: Record<string, Decision> = { k: 'keep', c: 'cut', m: 'maybe', b: 'bad' };

/** Everything needed to rebuild all progress, without the card texts (those are re-downloaded). */
export interface Snapshot {
  app: 'sort-the-multiverse';
  version: 2;
  deviceId: string;
  savedAt: string;
  projects: ProjectRec[];
  rc: [number, number, string, number, string, string, string][]; // pid, round, cardId, pos, decision, name, type
  log: [number, number, string, string, string, number, number][]; // pid, round, cardId, prev, decision, badAdded, batch
  bad: [string, string][]; // cardId, addedAt
}

export async function buildSnapshot(deviceId: string): Promise<Snapshot> {
  const db = await getDb();
  const tx = db.transaction(['projects', 'rc', 'log', 'bad']);
  const [projects, rc, log, bad] = await Promise.all([
    tx.objectStore('projects').getAll() as Promise<ProjectRec[]>,
    tx.objectStore('rc').getAll() as Promise<Rc[]>,
    tx.objectStore('log').getAll() as Promise<LogRec[]>,
    tx.objectStore('bad').getAll() as Promise<{ cardId: string; addedAt: string }[]>,
  ]);
  return {
    app: 'sort-the-multiverse', version: 2, deviceId, savedAt: now(),
    projects,
    rc: rc.map((r) => [r.pid, r.round, r.cardId, r.pos, r.d ? D_CODE[r.d] : '', r.name, r.cat ?? 'Other']),
    log: log.map((l) => [l.pid, l.round, l.cardId, l.prev ? D_CODE[l.prev] : '', D_CODE[l.d], l.badAdded ? 1 : 0, l.batch ?? 0]),
    bad: bad.map((b) => [b.cardId, b.addedAt]),
  };
}

/** Replaces all progress on this device with a snapshot, then re-downloads any card texts it lacks. */
export async function restoreSnapshot(snap: Snapshot, onProgress: (done: number, total: number) => void = () => {}) {
  if (snap?.app !== 'sort-the-multiverse' || snap.version !== 2 || !Array.isArray(snap.rc)) fail('That is not a valid backup.');
  const db = await getDb();
  const tx = db.transaction(['projects', 'rc', 'log', 'bad'], 'readwrite');
  for (const s of ['projects', 'rc', 'log', 'bad'] as const) void tx.objectStore(s).clear();
  for (const p of snap.projects) {
    // A download cannot resume inside a restored copy.
    void tx.objectStore('projects').put(p.status === 'loading' ? { ...p, status: 'error', load: { ...p.load, error: 'The download was interrupted. Retry to fetch the cards again.' } } : p);
  }
  for (const [pid, round, cardId, pos, d, name, cat] of snap.rc) {
    void tx.objectStore('rc').put({ pid, round, cardId, name, cat, pos, d: d ? D_NAME[d] : null } satisfies Rc);
  }
  for (const [pid, round, cardId, prev, d, badAdded, batch] of snap.log) {
    const rec: LogRec = { pid, round, cardId, prev: prev ? D_NAME[prev] : null, d: D_NAME[d], badAdded: !!badAdded };
    if (batch) rec.batch = batch;
    void tx.objectStore('log').add(rec);
  }
  for (const [cardId, addedAt] of snap.bad) void tx.objectStore('bad').put({ cardId, addedAt });
  await tx.done;
  roundCache.clear();
  badSet = null;

  // Card texts and images are not in the snapshot: fetch the ones this device does not have.
  const names = new Map<string, string>();
  for (const r of snap.rc) names.set(r[2], r[5]);
  const needed = new Set<string>(names.keys());
  for (const p of snap.projects) if (p.commanderId) needed.add(p.commanderId);
  for (const [cardId] of snap.bad) needed.add(cardId);
  const have = new Set((await db.getAllKeys('cards')) as string[]);
  const missing = [...needed].filter((id) => !have.has(id));
  if (missing.length) {
    const cards = await fetchByOracleIds(missing, onProgress);
    const got = new Set(cards.map((c) => c.id));
    const ctx = db.transaction('cards', 'readwrite');
    for (const c of cards) void ctx.store.put(c);
    // Anything Scryfall could not return still gets a name-only card, so no decision is lost.
    for (const id of missing) {
      if (got.has(id)) continue;
      void ctx.store.put({
        id, name: names.get(id) ?? 'Unknown card', manaCost: null, cmc: 0, colors: [], colorIdentity: [],
        typeLine: '', oracleText: '', power: null, toughness: null, loyalty: null, rarity: null, setName: null,
        prices: { usd: null, eur: null }, edhrecRank: null, images: { normal: null, large: null, artCrop: null },
        backImages: null, faces: null, scryfallUri: null,
      } satisfies Card);
    }
    await ctx.done;
  }
  changeListener();
  return { projects: snap.projects.length, cardsFetched: missing.length };
}

/** A packed snapshot kept on the device. */
export interface LocalSnapshot { id: string; savedAt: string; projects: number; reviewed: number; data: string }

export async function putLocalSnapshots(recs: LocalSnapshot[], keepDays = 5) {
  const db = await getDb();
  const tx = db.transaction('snapshots', 'readwrite');
  for (const r of recs) void tx.store.put(r);
  const days = ((await tx.store.getAllKeys()) as string[]).filter((k) => k.startsWith('day:')).sort();
  for (const k of days.slice(0, Math.max(0, days.length - keepDays))) void tx.store.delete(k);
  // Snapshots set aside before a delete or restore: keep the three newest.
  const safety = ((await tx.store.getAllKeys()) as string[]).filter((k) => k.startsWith('safety:')).sort();
  for (const k of safety.slice(0, Math.max(0, safety.length - 3))) void tx.store.delete(k);
  await tx.done;
}
export async function listLocalSnapshots(): Promise<Omit<LocalSnapshot, 'data'>[]> {
  const all = (await (await getDb()).getAll('snapshots')) as LocalSnapshot[];
  return all.map(({ data: _data, ...meta }) => meta).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function getLocalSnapshot(id: string) {
  return (await (await getDb()).get('snapshots', id)) as LocalSnapshot | undefined;
}
export async function countProjects() {
  return (await getDb()).count('projects');
}

export const api = {
  /** Result count for a query, before a project is created. */
  async preview(q: string) {
    if (!q.trim()) fail('The search is empty');
    const page = await searchFirstPage(q);
    return { total: page.total, warnings: page.warnings };
  },

  /** Commander picker: cards that can be a commander, matched by name. */
  async commanders(q: string): Promise<Card[]> {
    const words = q.trim().split(/\s+/).map((w) => `name:"${w.replace(/"/g, '')}"`).join(' ');
    const page = await searchFirstPage(`is:commander ${words}`, 'edhrec');
    const cards = page.cards.slice(0, 12).map(toCard);
    const db = await getDb();
    const tx = db.transaction('cards', 'readwrite');
    for (const c of cards) void tx.store.put(c);
    await tx.done;
    return cards;
  },

  async projects(): Promise<Project[]> {
    await getBad();
    const recs = (await (await getDb()).getAll('projects')) as ProjectRec[];
    recs.sort((a, b) => (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt));
    return Promise.all(recs.map((p) => toProject(p, p.status === 'ready' ? p.state : null)));
  },

  async project(id: number | string): Promise<Project> {
    const p = await getRec(id);
    const state = await freshState(p);
    if (state && JSON.stringify(state) !== JSON.stringify(p.state)) {
      await (await getDb()).put('projects', { ...p, state });
    }
    return toProject(p, state);
  },

  async createProject(n: NewProject): Promise<Project> {
    if (!n.name.trim()) fail('Give the project a name');
    if (!n.query.trim()) fail('The search is empty');
    if (!(n.deckSize > 0 && n.deckSize <= 1000)) fail('Invalid deck size');
    await getBad();
    const rec: Omit<ProjectRec, 'id'> = {
      name: n.name.trim(), query: n.query.trim(), builder: n.builder, format: n.format,
      deckSize: Math.floor(n.deckSize), commanderId: n.commanderId, sort: n.sort,
      ignoreBad: false, basics: {}, currentRound: 1, status: 'loading',
      load: { fetched: 0, total: 0, error: null }, createdAt: now(), lastActivityAt: null,
      rounds: [], state: null,
    };
    const id = Number(await (await getDb()).add('projects', rec));
    void downloadProject(id);
    return toProject({ ...rec, id }, null);
  },

  /** Settings that can change at any time. */
  async updateProject(
    id: number | string,
    patch: Partial<{ name: string; deckSize: number; basics: Record<string, number>; ignoreBad: boolean }>,
  ): Promise<Project> {
    const p = await getRec(id);
    if (patch.name?.trim()) p.name = patch.name.trim();
    if (patch.deckSize !== undefined) {
      const n = Math.floor(patch.deckSize);
      if (!(n > 0 && n <= 1000)) fail('Invalid deck size');
      p.deckSize = n;
    }
    if (patch.basics) p.basics = cleanBasics(patch.basics);
    if (patch.ignoreBad !== undefined) p.ignoreBad = patch.ignoreBad;
    p.state = await freshState(p);
    await (await getDb()).put('projects', p);
    return toProject(p, p.state);
  },

  async deleteProject(id: number | string) {
    const pid = Number(id);
    const tx = (await getDb()).transaction(['projects', 'rc', 'log'], 'readwrite');
    void tx.objectStore('projects').delete(pid);
    void tx.objectStore('rc').delete(IDBKeyRange.bound([pid], [pid, []]));
    let cur = await tx.objectStore('log').index('pr').openCursor(IDBKeyRange.bound([pid, 0], [pid, Infinity]));
    while (cur) { void cur.delete(); cur = await cur.continue(); }
    await tx.done;
    dropCache(pid);
    return { ok: true as const };
  },

  async retry(id: number | string): Promise<Project> {
    const p = await getRec(id);
    if (p.status !== 'error') fail('Nothing to retry');
    const next: ProjectRec = { ...p, status: 'loading', load: { fetched: 0, total: 0, error: null } };
    await (await getDb()).put('projects', next);
    void downloadProject(p.id);
    return toProject(next, null);
  },

  /** Next cards to swipe. mode "maybe" returns this round's Maybe cards instead. */
  async queue(id: number | string, mode: 'swipe' | 'maybe', limit = 8, cat: string | null = null) {
    const p = await getReady(id);
    const { items } = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const ids: string[] = [];
    for (const i of items) {
      if (cat && mode === 'swipe' && i.cat !== cat) continue;
      const want = mode === 'maybe' ? i.d === 'maybe' : !i.d && (p.ignoreBad || !bad.has(i.cardId));
      if (want && ids.push(i.cardId) >= limit) break;
    }
    return { cards: await getCards(ids), state: computeState(p, items, bad) };
  },

  /** Set a card's decision in the current round (swipe, resolve a maybe, or rescue a cut). */
  async swipe(id: number | string, cardId: string, decision: Decision) {
    const p = await getReady(id);
    const mem = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const rc = mem.byId.get(cardId) ?? fail('Card is not in this round');
    if (rc.d === decision) return { state: computeState(p, mem.items, bad) };

    const prev = rc.d;
    const badAdded = decision === 'bad' && !bad.has(cardId);
    rc.d = decision;
    if (badAdded) bad.add(cardId);
    p.lastActivityAt = now();
    p.state = computeState(p, mem.items, bad);
    try {
      const tx = (await getDb()).transaction(['projects', 'rc', 'log', 'bad'], 'readwrite');
      void tx.objectStore('rc').put(rc);
      void tx.objectStore('log').add({ pid: p.id, round: p.currentRound, cardId, prev, d: decision, badAdded } satisfies LogRec);
      if (badAdded) void tx.objectStore('bad').put({ cardId, addedAt: p.lastActivityAt });
      void tx.objectStore('projects').put(p);
      await tx.done;
    } catch (err) {
      dropCache(p.id); // memory no longer matches what was saved
      badSet = null;
      throw err;
    }
    return { state: p.state };
  },

  /** Undo the latest decision change in the current round. Unlimited. */
  async undo(id: number | string) {
    const p = await getReady(id);
    const mem = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const tx = (await getDb()).transaction(['projects', 'rc', 'log', 'bad'], 'readwrite');
    const cur = await tx.objectStore('log').index('pr').openCursor(IDBKeyRange.only([p.id, p.currentRound]), 'prev');
    if (!cur) {
      await tx.done;
      return { undone: null, state: computeState(p, mem.items, bad) };
    }
    const last = cur.value as LogRec;
    // A bulk action is undone as one step: every entry that shares its batch id.
    let count = 0;
    let c: typeof cur | null = cur;
    while (c) {
      const rec = c.value as LogRec;
      if (count > 0 && (!last.batch || rec.batch !== last.batch)) break;
      void c.delete();
      const rc = mem.byId.get(rec.cardId)!;
      rc.d = rec.prev;
      void tx.objectStore('rc').put(rc);
      if (rec.badAdded) {
        bad.delete(rec.cardId);
        void tx.objectStore('bad').delete(rec.cardId);
      }
      count++;
      if (!last.batch) break;
      c = await c.continue();
    }
    p.state = computeState(p, mem.items, bad);
    void tx.objectStore('projects').put(p);
    await tx.done;
    const [card] = count === 1 ? await getCards([last.cardId]) : [];
    return { undone: { card: card ?? null, from: last.d, to: last.prev, count }, state: p.state };
  },

  /** How many undecided cards a bulk action would touch. */
  async bulkCount(id: number | string, crit: BulkCriteria) {
    const p = await getReady(id);
    return (await bulkMatch(p, crit)).length;
  },

  /** Decide every undecided card that matches, in one step (and one undo). */
  async bulkApply(id: number | string, crit: BulkCriteria, decision: 'keep' | 'cut' | 'maybe') {
    const p = await getReady(id);
    const mem = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const hits = await bulkMatch(p, crit);
    if (!hits.length) return { count: 0, state: computeState(p, mem.items, bad) };
    const batch = Date.now();
    for (const rc of hits) rc.d = decision;
    p.lastActivityAt = now();
    p.state = computeState(p, mem.items, bad);
    try {
      const tx = (await getDb()).transaction(['projects', 'rc', 'log'], 'readwrite');
      for (const rc of hits) {
        void tx.objectStore('rc').put(rc);
        void tx.objectStore('log').add({
          pid: p.id, round: p.currentRound, cardId: rc.cardId, prev: null, d: decision, badAdded: false, batch,
        } satisfies LogRec);
      }
      void tx.objectStore('projects').put(p);
      await tx.done;
    } catch (err) {
      dropCache(p.id);
      throw err;
    }
    return { count: hits.length, state: p.state };
  },

  /** Re-sorts the cards still to review in the current round. Decided cards are untouched. */
  async reorder(id: number | string, sort: SortKey): Promise<Project> {
    const p = await getReady(id);
    const mem = await loadRound(p.id, p.currentRound);
    const todo = mem.items.filter((i) => !i.d);
    const cards = new Map((await getCards(todo.map((i) => i.cardId))).map((c) => [c.id, c]));
    const slots = todo.map((i) => i.pos).sort((a, b) => a - b);
    const byName = (a: Rc, b: Rc) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const colorRank = (c?: Card) => {
      const cols = c?.colors ?? [];
      return cols.length === 0 ? 7 : cols.length > 1 ? 6 : 'WUBRG'.indexOf(cols[0]);
    };
    const val: Record<SortKey, (a: Rc, b: Rc) => number> = {
      name: byName,
      type: (a, b) => categoryRank(a.cat) - categoryRank(b.cat),
      cmc: (a, b) => (cards.get(a.cardId)?.cmc ?? 0) - (cards.get(b.cardId)?.cmc ?? 0),
      color: (a, b) => colorRank(cards.get(a.cardId)) - colorRank(cards.get(b.cardId)),
      random: () => 0,
    };
    if (sort === 'random') shuffle(todo);
    else todo.sort((a, b) => val[sort](a, b) || byName(a, b));
    todo.forEach((rc, i) => { rc.pos = slots[i]; });
    mem.items.sort((a, b) => a.pos - b.pos);
    p.sort = sort;
    const tx = (await getDb()).transaction(['projects', 'rc'], 'readwrite');
    for (const rc of todo) void tx.objectStore('rc').put(rc);
    void tx.objectStore('projects').put(p);
    await tx.done;
    return toProject(p, p.state);
  },

  /**
   * Fills the open deck slots with basic lands, split by how often each colour's
   * mana symbol appears in the kept cards' costs (within the commander's identity).
   * It is a starting point; the counts stay editable.
   */
  async fillBasics(id: number | string): Promise<Project> {
    const p = await getReady(id);
    const { items } = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const s = computeState(p, items, bad);
    const open = -s.toCut;
    if (open <= 0) return toProject(p, s);
    const kept = items.filter((i) => (s.deckFromPool ? true : i.d === 'keep'));
    const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const c of await getCards(kept.map((i) => i.cardId))) {
      for (const m of (c.manaCost ?? '').matchAll(/\{([^}]+)\}/g)) {
        for (const ch of m[1]) if (ch in pips) pips[ch]++;
      }
    }
    const land: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
    const [cmd] = p.commanderId ? await getCards([p.commanderId]) : [];
    let colors = Object.keys(pips).filter((c) => (cmd ? cmd.colorIdentity.includes(c) : pips[c] > 0));
    if (cmd && !colors.some((c) => pips[c] > 0)) for (const c of colors) pips[c] = 1; // no symbols: split evenly
    colors = colors.filter((c) => pips[c] > 0);
    const basics = { ...p.basics };
    if (!colors.length) basics.Wastes = (basics.Wastes ?? 0) + open; // colourless deck
    else {
      const sum = colors.reduce((n, c) => n + pips[c], 0);
      const shares = colors.map((c) => ({ c, exact: (open * pips[c]) / sum }));
      const left = open - shares.reduce((n, x) => n + Math.floor(x.exact), 0);
      // Largest remainders get the leftover slots, so the total is exactly `open`.
      const order = [...shares].sort((a, b) => (b.exact % 1) - (a.exact % 1));
      const extra = new Set(order.slice(0, left).map((x) => x.c));
      for (const x of shares) {
        const n = Math.floor(x.exact) + (extra.has(x.c) ? 1 : 0);
        if (n > 0) basics[land[x.c]] = (basics[land[x.c]] ?? 0) + n;
      }
    }
    p.basics = cleanBasics(basics);
    p.state = computeState(p, items, bad);
    await (await getDb()).put('projects', p);
    return toProject(p, p.state);
  },

  /** Numbers about the cards currently kept: types and mana curve. */
  async deckStats(id: number | string) {
    const p = await getReady(id);
    const { items } = await loadRound(p.id, p.currentRound);
    const s = computeState(p, items, await getBad());
    const kept = items.filter((i) => (s.deckFromPool ? true : i.d === 'keep'));
    const cards = await getCards(kept.map((i) => i.cardId));
    const byType: Record<string, number> = {};
    for (const i of kept) byType[i.cat ?? 'Other'] = (byType[i.cat ?? 'Other'] ?? 0) + 1;
    const curve = Array<number>(8).fill(0); // mana value 0..6 and 7+, lands excluded
    let mvSum = 0, spells = 0;
    for (const c of cards) {
      if (categoryOf(c.typeLine) === 'Lands') continue;
      curve[Math.min(7, Math.max(0, Math.floor(c.cmc)))]++;
      mvSum += c.cmc;
      spells++;
    }
    return {
      count: kept.length,
      byType: CATEGORIES.filter((c) => byType[c]).map((c) => ({ type: c as string, count: byType[c] })),
      curve,
      avgMv: spells ? mvSum / spells : 0,
      lands: (byType.Lands ?? 0) + s.basicsTotal,
      basics: s.basicsTotal,
    };
  },

  async rounds(id: number | string): Promise<RoundInfo[]> {
    const p = await getReady(id);
    const bad = await getBad();
    return Promise.all(
      p.rounds.map(async (r) => ({ ...r, ...counts(p, (await loadRound(p.id, r.number)).items, bad) })),
    );
  },

  /** Cards of one round's list (keep / cut / maybe / bad / undecided), by name. */
  async roundCards(id: number | string, round: number, list: string, offset = 0, q = '') {
    const p = await getReady(id);
    const { items } = await loadRound(p.id, round);
    const needle = q.trim().toLowerCase();
    const wanted = items
      .filter((i) => !needle || i.name.toLowerCase().includes(needle))
      .filter((i) => (list === 'undecided' ? !i.d : (DECISIONS as string[]).includes(list) ? i.d === list : true))
      .sort(
        (a, b) =>
          categoryRank(a.cat) - categoryRank(b.cat) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
    const cards = await getCards(wanted.slice(offset, offset + 120).map((i) => i.cardId));
    return { total: wanted.length, cards };
  },

  /** Close the current round; its kept cards become the next round's pool. */
  async nextRound(id: number | string): Promise<Project> {
    const p = await getReady(id);
    const mem = await loadRound(p.id, p.currentRound);
    const bad = await getBad();
    const s = computeState(p, mem.items, bad);
    if (s.remaining > 0) fail('There are still cards to review this round');
    if (s.maybe > 0) fail('Resolve every Maybe as Keep or Cut first');
    if (s.keep === 0) fail('No cards were kept');
    const t = now();
    const next = p.currentRound + 1;
    const pool: Rc[] = mem.items.filter((i) => i.d === 'keep').map((i) => ({ ...i, round: next, d: null }));
    p.rounds = [
      ...p.rounds.map((r) => (r.number === p.currentRound ? { ...r, status: 'closed' as const, closedAt: t } : r)),
      { number: next, status: 'active', startedAt: t, closedAt: null },
    ];
    p.currentRound = next;
    p.lastActivityAt = t;
    p.state = computeState(p, pool, bad);
    const tx = (await getDb()).transaction(['projects', 'rc'], 'readwrite');
    for (const r of pool) void tx.objectStore('rc').put(r);
    void tx.objectStore('projects').put(p);
    await tx.done;
    return toProject(p, p.state);
  },

  /**
   * ManaBox-style decklist: "1 Card Name" per line under "// SECTION" headers
   * (commander first, then each card type; basics go under lands with their counts).
   */
  async exportDeck(id: number | string) {
    const p = await getReady(id);
    const { items } = await loadRound(p.id, p.currentRound);
    const s = computeState(p, items, await getBad());
    const kept = items.filter((i) => (s.deckFromPool ? true : i.d === 'keep'));
    const sections: string[] = [];
    if (p.commanderId) {
      const [cmd] = await getCards([p.commanderId]);
      if (cmd) sections.push(['// COMMANDER', `1 ${cmd.name}`].join('\n'));
    }
    for (const cat of CATEGORIES) {
      const lines = kept
        .filter((i) => (i.cat ?? 'Other') === cat)
        .map((i) => i.name)
        .sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }))
        .map((n) => `1 ${n}`);
      if (cat === 'Lands') for (const b of ALL_BASICS) if (p.basics[b] > 0) lines.push(`${p.basics[b]} ${b}`);
      if (lines.length) sections.push([`// ${cat.toUpperCase()}`, ...lines].join('\n'));
    }
    return {
      text: sections.join('\n\n'),
      count: kept.length + s.basicsTotal + s.commanderCount,
      deckSize: p.deckSize,
      complete: s.complete,
      fileName: `${p.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'deck'}.txt`,
    };
  },

  /** The global bad-cards list, newest first. */
  async bad(offset = 0) {
    const all = (await (await getDb()).getAll('bad')) as { cardId: string; addedAt: string }[];
    all.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return { total: all.length, cards: await getCards(all.slice(offset, offset + 120).map((b) => b.cardId)) };
  },

  async removeBad(cardId: string) {
    await (await getDb()).delete('bad', cardId);
    (await getBad()).delete(cardId);
    return { ok: true as const };
  },

  // ---------- backup ----------

  /** Saves everything to a file, e.g. before changing phones. */
  async exportBackup() {
    const db = await getDb();
    const data: Record<string, unknown> = { app: 'sort-the-multiverse', version: 1, exportedAt: now() };
    for (const s of STORES) data[s] = await db.getAll(s);
    download(`sort-the-multiverse-${now().slice(0, 10)}.json`, JSON.stringify(data));
    try { localStorage.setItem('stm.lastBackup', now()); } catch { /* ignore */ }
  },

  /** Replaces everything on this device with the contents of a backup file. */
  async importBackup(file: File) {
    let data: any;
    try { data = JSON.parse(await file.text()); } catch { fail('That file is not a valid backup.'); }
    if (data?.app !== 'sort-the-multiverse' || !Array.isArray(data.projects)) fail('That file is not a Sort the Multiverse backup.');
    if (data.version === 2) return { projects: (await restoreSnapshot(data)).projects };
    const db = await getDb();
    const tx = db.transaction([...STORES], 'readwrite');
    for (const s of STORES) {
      void tx.objectStore(s).clear();
      for (const rec of data[s] ?? []) void tx.objectStore(s).put(rec);
    }
    await tx.done;
    roundCache.clear();
    badSet = null;
    return { projects: data.projects.length as number };
  },

  /** Whether the browser has promised to keep this data. */
  async storageInfo() {
    const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    return { persisted, usedMb: est?.usage ? est.usage / 1048576 : null };
  },
};

// Every method that changes saved data reports it, so the automatic backup can follow.
for (const k of [
  'updateProject', 'deleteProject', 'swipe', 'undo', 'bulkApply', 'reorder', 'fillBasics', 'nextRound', 'removeBad', 'importBackup',
] as const) {
  const fn = api[k] as (...a: any[]) => Promise<unknown>;
  (api as any)[k] = async (...a: any[]) => {
    const r = await fn(...a);
    changeListener();
    return r;
  };
}
