import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  backupNow, connectCloud, disconnectCloud, keepThisDevice, listLocalSnapshots, preserveCurrent,
  restoreFromCloud, restoreLocal, useBackupStatus,
} from '../autosave';

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Sort%20the%20Multiverse%20backup';

export function when(iso: string | null) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type Snap = Awaited<ReturnType<typeof listLocalSnapshots>>[number];

export default function BackupPage() {
  const st = useBackupStatus();
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [info, setInfo] = useState<{ persisted: boolean; usedMb: number | null } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { api.storageInfo().then(setInfo); }, []);
  useEffect(() => { listLocalSnapshots().then(setSnaps); }, [st.lastLocal]);

  /** Runs an action with a busy state and a result message. */
  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await fn(), ok: true });
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    }
    setBusy(false);
    setProgress(null);
  };
  const onProgress = (done: number, total: number) => setProgress(`Re-downloading cards… ${done.toLocaleString()} of ${total.toLocaleString()}`);
  const restored = (r: { projects: number }) => `Restored ${r.projects} project${r.projects === 1 ? '' : 's'}.`;

  const connect = () => act(async () => {
    const r = await connectCloud(token);
    setToken('');
    return r.kind === 'connected'
      ? 'Connected. A backup was uploaded and read back successfully.'
      : 'Connected. A backup already exists on GitHub; choose below what to do with it.';
  });

  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <div className="page-head"><h1>Your data</h1></div>

      <div className="panel stack">
        <h2>How your progress is kept safe</h2>
        <div className="safety">
          <div className="ok">
            <strong>1. On this phone, instantly</strong>
            <span className="muted small">Every swipe is saved the moment you make it.</span>
          </div>
          <div className={st.lastLocal ? 'ok' : ''}>
            <strong>2. Snapshots on this phone</strong>
            <span className="muted small">Taken automatically. Last: {when(st.lastLocal)}.</span>
          </div>
          <div className={st.cloud && !st.error && !st.conflict ? 'ok' : 'warn'}>
            <strong>3. Copy outside the phone</strong>
            <span className="muted small">
              {st.cloud ? `Uploaded automatically to your GitHub. Last: ${when(st.lastCloud)}.` : 'Not set up. A lost or reset phone would lose everything.'}
            </span>
          </div>
        </div>
        {st.busy && <span className="muted small">Backing up…</span>}
        {msg && <p className={msg.ok ? 'small' : 'small error'} style={{ margin: 0 }}>{msg.text}</p>}
        {progress && <p className="small muted" style={{ margin: 0 }}>{progress}</p>}
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Automatic backup to GitHub</h2>
        {!st.cloud ? <>
          <p className="muted" style={{ margin: 0 }}>
            Your progress is uploaded to a secret gist in your own GitHub account a few seconds after you stop
            swiping. It is free, and only decisions and card names are stored there.
          </p>
          <ol className="steps">
            <li>
              <a href={TOKEN_URL} target="_blank" rel="noreferrer">Create an access token on GitHub ↗</a>.
              Leave only <strong>gist</strong> ticked, set <strong>Expiration</strong> to <strong>No expiration</strong>, and tap Generate.
            </li>
            <li>Copy the token GitHub shows you and paste it here.</li>
          </ol>
          <div className="row">
            <input className="input" style={{ flex: 1, minWidth: 200 }} type="password" autoComplete="off" autoCapitalize="none"
              spellCheck={false} placeholder="Paste the token (starts with ghp_)" aria-label="GitHub access token"
              value={token} onChange={(e) => setToken(e.target.value)} />
            <button className="btn primary" onClick={connect} disabled={busy || !token.trim()}>Connect</button>
          </div>
          <span className="hint">The token stays on this phone. It can only read and write your gists, nothing else in your account.</span>
        </> : <>
          {st.conflict ? (
            <div className="stack" style={{ gap: 10 }}>
              <p className="notice" style={{ margin: 0 }}>
                GitHub holds a backup{st.conflict.savedAt ? ` from ${when(st.conflict.savedAt)}` : ''} that did not come from this
                phone as it is now. Automatic uploads are paused until you choose.
              </p>
              <div className="row">
                <button className="btn primary" disabled={busy}
                  onClick={() => confirm('Replace everything on this phone with the GitHub backup?') && act(async () => restored(await restoreFromCloud(onProgress)))}>
                  Restore the GitHub backup here
                </button>
                <button className="btn" disabled={busy}
                  onClick={() => confirm('Overwrite the GitHub backup with what is on this phone?') && act(async () => { await keepThisDevice(); return 'The GitHub backup now matches this phone.'; })}>
                  Keep this phone's data
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="pile-counts">
                <span style={{ color: st.error ? 'var(--cut)' : 'var(--keep)' }}>{st.error ? 'Backup failing' : '✓ Connected'}</span>
                <span>Last upload: {when(st.lastCloud)}</span>
                {st.pending && !st.busy && <span className="muted">changes waiting</span>}
              </div>
              {st.error && <p className="error small" style={{ margin: 0 }}>{st.error}</p>}
              <div className="row">
                <button className="btn sm" disabled={busy || st.busy} onClick={() => act(async () => { await backupNow(); return 'Backup run finished.'; })}>Back up now</button>
                <button className="btn sm" disabled={busy}
                  onClick={() => confirm('Replace everything on this phone with the GitHub backup?') && act(async () => restored(await restoreFromCloud(onProgress)))}>
                  Restore from GitHub
                </button>
                <button className="btn sm ghost" disabled={busy}
                  onClick={() => confirm('Stop automatic uploads? The backup already on GitHub stays there.') && disconnectCloud()}>
                  Disconnect
                </button>
              </div>
            </>
          )}
        </>}
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Snapshots on this phone</h2>
        <p className="muted" style={{ margin: 0 }}>
          Kept automatically: the latest state and one per day for the last five days you used the app. Use one to go back
          after a mistake, such as deleting a project.
        </p>
        {!snaps.length && <span className="muted small">None yet. The first one is taken shortly after your first swipes.</span>}
        <div className="rounds">
          {snaps.map((s) => (
            <div key={s.id} className="round-row">
              <span className="num">
                {s.id === 'latest' ? 'Latest' : new Date(s.savedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                {s.id.startsWith('safety:') && <span className="muted small"> · before a delete or restore</span>}
              </span>
              <span className="muted small">
                {new Date(s.savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {s.projects} project{s.projects === 1 ? '' : 's'} · {s.reviewed.toLocaleString()} decisions
              </span>
              <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={busy}
                onClick={() => confirm('Replace everything on this phone with this snapshot?') && act(async () => restored(await restoreLocal(s.id, onProgress)))}>
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack" style={{ marginTop: 14 }}>
        <h2>Backup file</h2>
        <p className="muted" style={{ margin: 0 }}>A complete copy in one file, to keep wherever you like or to move to another device by hand.</p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => act(async () => { await api.exportBackup(); return 'Backup file saved to your downloads.'; })}>Save backup file</button>
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>Restore from file</button>
          <input ref={file} type="file" accept="application/json,.json" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f && confirm('Replace everything on this phone with the backup file?')) {
                void act(async () => { await preserveCurrent(); return restored(await api.importBackup(f)); });
              }
            }} />
        </div>
        {info && (
          <span className="muted small">
            {info.persisted ? 'The phone has marked this app’s storage as protected.' : 'Add the app to your home screen so the phone protects its storage.'}
            {info.usedMb != null && ` ${info.usedMb.toFixed(1)} MB used.`}
          </span>
        )}
      </div>
    </main>
  );
}
