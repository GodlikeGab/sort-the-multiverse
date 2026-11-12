/**
 * Scryfall API client, running in the browser.
 *
 * Follows https://scryfall.com/docs/api: an Accept header on every request and
 * one queue that keeps ~100 ms between requests. (Browsers set the User-Agent
 * themselves; pages are not allowed to change it.)
 */
import type { Card } from './api';

const BASE = 'https://api.scryfall.com';
const MIN_GAP_MS = 110;

export class ScryfallError extends Error {
  constructor(public status: number, message: string, public warnings: string[] = []) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

function getJson(url: string): Promise<any> {
  return schedule(async () => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json;q=0.9,*/*;q=0.8' } });
      } catch {
        throw new ScryfallError(0, 'Could not reach Scryfall. Check your internet connection.');
      }
      if (res.status === 429 && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ScryfallError(
          res.status,
          body?.details || `Scryfall returned HTTP ${res.status}`,
          body?.warnings ?? [],
        );
      }
      return body;
    }
  });
}

export interface SearchPage {
  total: number;
  cards: any[];
  next: string | null;
  warnings: string[];
}

const ORDERS = new Set(['name', 'cmc', 'color', 'edhrec']); // edhrec: commander picker suggestions only
function searchUrl(query: string, sort: string) {
  const p = new URLSearchParams({ q: query, unique: 'cards', order: ORDERS.has(sort) ? sort : 'name' });
  return `${BASE}/cards/search?${p}`;
}

/** One page of /cards/search. "No cards found" (404) is an empty result, not an error. */
async function searchPage(url: string): Promise<SearchPage> {
  try {
    const body = await getJson(url);
    return {
      total: body.total_cards ?? body.data?.length ?? 0,
      cards: body.data ?? [],
      next: body.has_more ? body.next_page : null,
      warnings: body.warnings ?? [],
    };
  } catch (err) {
    if (err instanceof ScryfallError && err.status === 404) {
      return { total: 0, cards: [], next: null, warnings: err.warnings };
    }
    throw err;
  }
}

export const searchFirstPage = (query: string, sort = 'name') => searchPage(searchUrl(query, sort));

/** Fetches every page of a search. */
export async function searchAll(
  query: string,
  sort: string,
  onProgress: (fetched: number, total: number) => void,
): Promise<any[]> {
  const all: any[] = [];
  let url: string | null = searchUrl(query, sort);
  while (url) {
    const page: SearchPage = await searchPage(url);
    all.push(...page.cards);
    onProgress(all.length, page.total);
    url = page.next;
  }
  return all;
}

const num = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** Scryfall card object → the compact card this app stores. Handles double-faced cards. */
export function toCard(c: any): Card {
  const faces: any[] | undefined = c.card_faces;
  const first = faces?.[0] ?? {};
  // Single-image cards (incl. split/adventure) have top-level image_uris;
  // true double-faced cards have them per face.
  const front = c.image_uris ?? first.image_uris ?? {};
  const back = !c.image_uris ? faces?.[1]?.image_uris : undefined;
  return {
    id: c.oracle_id ?? first.oracle_id ?? c.id,
    name: c.name,
    manaCost: c.mana_cost || (faces ?? []).map((f) => f.mana_cost).filter(Boolean).join(' // ') || null,
    cmc: c.cmc ?? 0,
    colors: c.colors ?? [...new Set((faces ?? []).flatMap((f) => f.colors ?? []))],
    colorIdentity: c.color_identity ?? [],
    typeLine: c.type_line ?? (faces ?? []).map((f) => f.type_line).join(' // '),
    oracleText:
      c.oracle_text ?? (faces ?? []).map((f) => f.oracle_text ?? '').filter(Boolean).join('\n//\n'),
    power: c.power ?? first.power ?? null,
    toughness: c.toughness ?? first.toughness ?? null,
    loyalty: c.loyalty ?? first.loyalty ?? null,
    rarity: c.rarity ?? null,
    setName: c.set_name ?? null,
    prices: { usd: num(c.prices?.usd ?? c.prices?.usd_foil), eur: num(c.prices?.eur ?? c.prices?.eur_foil) },
    edhrecRank: c.edhrec_rank ?? null,
    images: { normal: front.normal ?? null, large: front.large ?? front.normal ?? null, artCrop: front.art_crop ?? null },
    backImages: back ? { normal: back.normal ?? null, large: back.large ?? back.normal ?? null } : null,
    faces: faces
      ? faces.map((f) => ({
          name: f.name,
          manaCost: f.mana_cost || null,
          typeLine: f.type_line ?? null,
          oracleText: f.oracle_text ?? null,
          power: f.power ?? null,
          toughness: f.toughness ?? null,
          loyalty: f.loyalty ?? null,
        }))
      : null,
    scryfallUri: c.scryfall_uri ?? null,
  };
}

/**
 * Fetches cards by oracle id, 75 per request (Scryfall's /cards/collection limit).
 * Ids Scryfall no longer knows are simply missing from the result.
 */
export async function fetchByOracleIds(ids: string[], onProgress: (done: number, total: number) => void): Promise<Card[]> {
  const out: Card[] = [];
  for (let i = 0; i < ids.length; i += 75) {
    const chunk = ids.slice(i, i + 75);
    const body: any = await schedule(async () => {
      let res: Response;
      try {
        res = await fetch(`${BASE}/cards/collection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json;q=0.9,*/*;q=0.8' },
          body: JSON.stringify({ identifiers: chunk.map((id) => ({ oracle_id: id })) }),
        });
      } catch {
        throw new ScryfallError(0, 'Could not reach Scryfall. Check your internet connection.');
      }
      if (!res.ok) throw new ScryfallError(res.status, `Scryfall returned HTTP ${res.status}`);
      return res.json();
    });
    out.push(...(body.data ?? []).map(toCard));
    onProgress(Math.min(i + 75, ids.length), ids.length);
  }
  return out;
}
