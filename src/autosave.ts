/**
 * Automatic backups. Nothing here needs the user to do anything once set up.
 *
 * Every swipe is already written to the phone's storage immediately. On top of
 * that, shortly after any change this module:
 *   1. keeps a snapshot on the device (latest + one per day), which protects
 *      against a bad update or an accidental delete, and
 *   2. if the user connected GitHub, uploads the same snapshot to a secret gist
 *      in their own account, which protects against a lost, reset or wiped phone.
 *
 * A snapshot holds decisions, not card texts or images; those are re-downloaded
 * from Scryfall on restore.
 */
import { useSyncExternalStore } from 'react';
import {
  buildSnapshot, countProjects, getLocalSnapshot, listLocalSnapshots, putLocalSnapshots,
  restoreSnapshot, setChangeListener, type Snapshot,
} from './store';

const GIST_FILE = 'sort-the-multiverse-backup.txt';
const GIST_LABEL = 'Sort the Multiverse backup';
const API = 'https://api.github.com';
const QUIET_MS = 20_000; // back up this long after the last change…
const MAX_WAIT_MS = 90_000; // …but never wait longer than this while changes keep coming
const BURST = 40; // …or more than this many changes

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function deviceId() {
  let id = ls.get('stm.device');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    ls.set('stm.device', id);
  }
  return id;
}

interface CloudConfig { token: string; gistId: string }
const cloudConfig = (): CloudConfig | null => {
  try { return JSON.parse(ls.get('stm.cloud') ?? 'null'); } catch { return null; }
};

export interface BackupStatus {
  cloud: boolean; // GitHub connected
  lastLocal: string | null;
  lastCloud: string | null;
  busy: boolean;
  pending: boolean; // changes not backed up yet
  error: string | null; // last cloud error
  /** Another device uploaded a newer backup; automatic uploads wait for a choice. */
  conflict: { savedAt: string } | null;
}

let status: BackupStatus = {
  cloud: !!cloudConfig(),
  lastLocal: ls.get('stm.lastLocal'),
  lastCloud: ls.get('stm.lastCloud'),
  busy: false,
  pending: ls.get('stm.dirty') === '1',
  error: null,
  conflict: null,
};
const listeners = new Set<() => void>();
function setStatus(patch: Partial<BackupStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useBackupStatus(): BackupStatus {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => status,
  );
}

// ---------- packing (gzip + base64 keeps uploads small) ----------

async function pack(text: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') return text;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'gz1:' + btoa(bin);
}

async function unpack(packed: string): Promise<string> {
  if (!packed.startsWith('gz1:')) return packed;
  const bin = atob(packed.slice(4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ---------- GitHub (a secret gist in the user's own account) ----------

async function gh(token: string, path: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new Error('Could not reach GitHub. Check your internet connection.');
  }
  if (res.status === 401) throw new Error('GitHub rejected the access token. It may have expired; create a new one.');
  if (res.status === 403 || res.status === 404) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(`GitHub refused the request (${body?.message ?? res.status}). The token needs the "gist" permission.`);
  }
  if (!res.ok) throw new Error(`GitHub returned an error (${res.status}).`);
  return res.json();
}

const describe = (savedAt: string) => `${GIST_LABEL} | device ${deviceId()} | ${savedAt}`;
function parseDescription(d: string | null | undefined) {
  const m = /^Sort the Multiverse backup \| device (\S+) \| (\S+)$/.exec(d ?? '');
  return m ? { device: m[1], savedAt: m[2] } : null;
}

async function uploadTo(cfg: CloudConfig, packed: string, savedAt: string) {
  await gh(cfg.token, `/gists/${cfg.gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ description: describe(savedAt), files: { [GIST_FILE]: { content: packed } } }),
  });
}

async function downloadFrom(cfg: CloudConfig): Promise<{ packed: string; meta: ReturnType<typeof parseDescription> }> {
  const gist = await gh(cfg.token, `/gists/${cfg.gistId}`);
  const file = gist.files?.[GIST_FILE];
  if (!file) throw new Error('The backup file is missing from your GitHub gist.');
  let packed: string = file.content;
  if (file.truncated) {
    const raw = await fetch(file.raw_url);
    if (!raw.ok) throw new Error('Could not download the backup from GitHub.');
    packed = await raw.text();
  }
  return { packed, meta: parseDescription(gist.description) };
}

// ---------- the backup cycle ----------

let timer = 0;
let firstDirtyAt = 0;
let changes = 0;
let running: Promise<void> | null = null;

function markDirty() {
  changes++;
  if (!firstDirtyAt) firstDirtyAt = Date.now();
  ls.set('stm.dirty', '1');
  if (!status.pending) setStatus({ pending: true });
  clearTimeout(timer);
  const waited = Date.now() - firstDirtyAt;
  const delay = changes >= BURST || waited >= MAX_WAIT_MS ? 500 : Math.min(QUIET_MS, MAX_WAIT_MS - waited);
  timer = window.setTimeout(() => void backupNow(), delay);
}

/** Runs one backup cycle now. Safe to call at any time; calls never overlap. */
export function backupNow(): Promise<void> {
  if (running) return running.then(() => (status.pending ? backupNow() : undefined));
  clearTimeout(timer);
  const seen = changes;
  running = (async () => {
    setStatus({ busy: true });
    try {
      const snap = await buildSnapshot(deviceId());
      const packed = await pack(JSON.stringify(snap));
      const reviewed = snap.rc.reduce((n, r) => n + (r[4] ? 1 : 0), 0);
      const meta = { savedAt: snap.savedAt, projects: snap.projects.length, reviewed, data: packed };
      // 1. On the device: the latest snapshot plus one per day.
      if (snap.projects.length) {
        const recs = [{ id: 'latest', ...meta }, { id: `day:${snap.savedAt.slice(0, 10)}`, ...meta }];
        // A project disappeared since the last snapshot: keep that one aside, in case it was a mistake.
        const prev = await getLocalSnapshot('latest');
        if (prev && prev.projects > meta.projects) recs.push({ ...prev, id: `safety:${prev.savedAt}` });
        await putLocalSnapshots(recs);
        ls.set('stm.lastLocal', snap.savedAt);
        setStatus({ lastLocal: snap.savedAt });
      }
      // 2. Off the device, if connected. An empty app never overwrites a backup.
      const cfg = cloudConfig();
      let cloudDone = !cfg;
      if (cfg && snap.projects.length && !status.conflict) {
        if (!navigator.onLine) throw new Error('Offline. The backup will upload when you are back online.');
        await uploadTo(cfg, packed, snap.savedAt);
        ls.set('stm.lastCloud', snap.savedAt);
        setStatus({ lastCloud: snap.savedAt, error: null });
        cloudDone = true;
      }
      if (cloudDone && seen === changes) {
        ls.del('stm.dirty');
        firstDirtyAt = 0;
        changes = 0;
        setStatus({ pending: false });
      }
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setStatus({ busy: false });
      running = null;
    }
  })();
  return running;
}

/** Starts automatic backups. Call once when the app opens. */
export function initAutosave() {
  setChangeListener(markDirty);
  // Leaving the app is the last chance to save; phones may close it at any time afterwards.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && status.pending) void backupNow();
  });
  window.addEventListener('online', () => { if (status.pending) void backupNow(); });
  if (status.pending) window.setTimeout(() => void backupNow(), 3000);
  void checkCloud();
}

/** Notices when another device has uploaded a newer backup, so we never overwrite it blindly. */
async function checkCloud() {
  const cfg = cloudConfig();
  if (!cfg || !navigator.onLine) return;
  try {
    const gist = await gh(cfg.token, `/gists/${cfg.gistId}`);
    const meta = parseDescription(gist.description);
    if (meta && meta.device !== deviceId() && meta.savedAt > (status.lastCloud ?? '')) {
      setStatus({ conflict: { savedAt: meta.savedAt } });
    }
  } catch (err) {
    setStatus({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------- actions for the Data page ----------

export type ConnectResult =
  | { kind: 'connected' } // a backup was uploaded and read back
  | { kind: 'found'; savedAt: string | null }; // an existing backup is waiting; nothing was overwritten

/** Links a GitHub account. The token is stored only on this device. */
export async function connectCloud(token: string): Promise<ConnectResult> {
  token = token.trim();
  if (!token) throw new Error('Paste the access token first.');
  const gists: any[] = await gh(token, '/gists?per_page=100');
  const existing = gists.find((g) => g.files?.[GIST_FILE]);
  const localProjects = await countProjects();

  if (existing) {
    const cfg = { token, gistId: existing.id as string };
    ls.set('stm.cloud', JSON.stringify(cfg));
    const meta = parseDescription(existing.description);
    if (meta && (localProjects === 0 || meta.device !== deviceId())) {
      // Never overwrite a backup made elsewhere: let the user choose.
      setStatus({ cloud: true, error: null, conflict: { savedAt: meta?.savedAt ?? '' } });
      return { kind: 'found', savedAt: meta?.savedAt ?? null };
    }
    setStatus({ cloud: true, error: null, conflict: null });
  } else {
    const created = await gh(token, '/gists', {
      method: 'POST',
      body: JSON.stringify({ description: GIST_LABEL, public: false, files: { [GIST_FILE]: { content: 'empty' } } }),
    });
    ls.set('stm.cloud', JSON.stringify({ token, gistId: created.id }));
    setStatus({ cloud: true, error: null, conflict: null });
  }

  if (localProjects > 0) {
    ls.set('stm.dirty', '1');
    setStatus({ pending: true });
    await backupNow();
    if (status.error) throw new Error(status.error);
    // Read it back, so "connected" means a restore would really work.
    const { packed } = await downloadFrom(cloudConfig()!);
    const snap = JSON.parse(await unpack(packed)) as Snapshot;
    if (snap.app !== 'sort-the-multiverse') throw new Error('The uploaded backup could not be read back.');
  }
  return { kind: 'connected' };
}

export function disconnectCloud() {
  ls.del('stm.cloud');
  ls.del('stm.lastCloud');
  setStatus({ cloud: false, lastCloud: null, error: null, conflict: null });
}

/**
 * Sets the current state aside before something replaces it (a restore or an
 * import), so that a restore can itself be undone from the snapshot list.
 */
export async function preserveCurrent() {
  const snap = await buildSnapshot(deviceId());
  if (!snap.projects.length) return;
  const reviewed = snap.rc.reduce((n, r) => n + (r[4] ? 1 : 0), 0);
  await putLocalSnapshots([{
    id: `safety:${snap.savedAt}`, savedAt: snap.savedAt, projects: snap.projects.length, reviewed,
    data: await pack(JSON.stringify(snap)),
  }]);
}

/** Replaces this device's data with the GitHub backup. */
export async function restoreFromCloud(onProgress?: (done: number, total: number) => void) {
  const cfg = cloudConfig();
  if (!cfg) throw new Error('GitHub is not connected.');
  const { packed, meta } = await downloadFrom(cfg);
  const snap = JSON.parse(await unpack(packed)) as Snapshot;
  await preserveCurrent();
  const result = await restoreSnapshot(snap, onProgress);
  ls.set('stm.lastCloud', meta?.savedAt ?? snap.savedAt);
  setStatus({ conflict: null, lastCloud: meta?.savedAt ?? snap.savedAt, error: null });
  await backupNow(); // from now on this device owns the backup
  return result;
}

/** Keeps this device's data and overwrites the GitHub backup with it. */
export async function keepThisDevice() {
  setStatus({ conflict: null });
  ls.set('stm.dirty', '1');
  setStatus({ pending: true });
  await backupNow();
  if (status.error) throw new Error(status.error);
}

export { listLocalSnapshots };

/** Replaces this device's data with one of the snapshots kept on the device. */
export async function restoreLocal(id: string, onProgress?: (done: number, total: number) => void) {
  const rec = await getLocalSnapshot(id);
  if (!rec) throw new Error('That snapshot no longer exists.');
  await preserveCurrent();
  return restoreSnapshot(JSON.parse(await unpack(rec.data)) as Snapshot, onProgress);
}
