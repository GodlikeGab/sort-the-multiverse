import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatName, type Project } from '../api';
import { useBackupStatus } from '../autosave';
import { when } from './BackupPage';

function ago(iso: string | null) {
  if (!iso) return 'not started';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : d < 60 ? `${d} days ago` : `${Math.floor(d / 30)} months ago`;
}

function ProjectCard({ p }: { p: Project }) {
  const s = p.state;
  const art = p.commander?.images.artCrop;
  const pct = s && s.total ? (s.reviewed / s.total) * 100 : 0;
  return (
    <article className="project">
      <Link to={`/projects/${p.id}`} className="art" style={art ? { backgroundImage: `url(${art})` } : undefined} aria-label={p.name} />
      <div className="body">
        <div>
          <Link to={`/projects/${p.id}`} className="title">{p.name}</Link>
          <div className="muted small">
            {formatName(p.format)}{p.commander && <> · {p.commander.name}</>}
          </div>
        </div>
        {p.status === 'loading' && <div className="muted small">Fetching cards from Scryfall… {p.load.fetched}/{p.load.total || '?'}</div>}
        {p.status === 'error' && <div className="error small">{p.load.error}</div>}
        {s && <>
          <div>
            <div className="row small" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
              <span>
                <span className="round-pill">Round {s.round}</span>{' '}
                <strong>{s.reviewed.toLocaleString()}</strong> <span className="muted">of {s.total.toLocaleString()} reviewed</span>
              </span>
              {s.complete && <span className="complete-badge">✓ Deck ready</span>}
            </div>
            <div className="progress" aria-hidden><span style={{ width: `${pct}%`, background: s.complete ? 'var(--keep)' : 'var(--accent)' }} /></div>
          </div>
          <div className="pile-counts">
            <span style={{ color: 'var(--keep)' }}>{s.keep.toLocaleString()} kept</span>
            <span>target {s.target}</span>
            {s.maybe > 0 && <span style={{ color: 'var(--maybe)' }}>{s.maybe} maybe</span>}
          </div>
        </>}
        <div className="row" style={{ marginTop: 4 }}>
          {s ? (
            <Link className="btn primary" to={`/projects/${p.id}/swipe`}>
              {s.remaining > 0 ? (s.reviewed ? 'Continue' : 'Start swiping') : s.maybe > 0 ? 'Resolve maybes' : 'Round summary'}
            </Link>
          ) : null}
          <Link className="btn" to={`/projects/${p.id}`}>Open</Link>
          <span className="faint small" style={{ marginLeft: 'auto' }}>{ago(p.lastActivityAt)}</span>
        </div>
      </div>
    </article>
  );
}

/** One line that says whether progress is safely backed up, and shouts when it is not. */
function BackupLine({ projects }: { projects: Project[] }) {
  const st = useBackupStatus();
  const reviewed = projects.reduce((n, p) => n + (p.state?.reviewed ?? 0), 0);
  if (st.cloud && (st.error || st.conflict)) {
    return (
      <div className="reminder bad">
        <span style={{ flex: 1, minWidth: 180 }}>
          <strong>Backup needs attention.</strong>{' '}
          <span className="muted">{st.conflict ? 'GitHub holds a different backup.' : st.error}</span>
        </span>
        <Link className="btn sm primary" to="/data">Fix</Link>
      </div>
    );
  }
  if (!st.cloud && reviewed >= 50) {
    return (
      <div className="reminder">
        <span style={{ flex: 1, minWidth: 180 }}>
          <strong>Your progress exists only on this phone.</strong>{' '}
          <span className="muted">Turn on automatic backup so a lost or reset phone cannot erase it.</span>
        </span>
        <Link className="btn sm primary" to="/data">Set up</Link>
      </div>
    );
  }
  if (!st.cloud) return null;
  return (
    <p className="backup-line">
      <span className="dot" style={{ background: 'var(--keep)' }} />
      {st.busy ? 'Backing up…' : st.pending ? 'Changes will be backed up in a moment' : `Backed up to GitHub ${when(st.lastCloud)}`}
    </p>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timer = 0;
    const load = () =>
      api.projects().then((ps) => {
        setProjects(ps);
        if (ps.some((p) => p.status === 'loading')) timer = window.setTimeout(load, 1500);
      }).catch((e) => setError(e.message));
    load();
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="spacer" />
        <Link className="btn primary" to="/new">＋ New project</Link>
      </div>
      {error && <p className="error">Can't reach the server: {error}</p>}
      {!projects && !error && <div className="spinner" />}
      {projects?.length === 0 && (
        <div className="empty">
          <h2>No projects yet</h2>
          <p>Build a search, then swipe through the results round by round until only your deck is left.</p>
          <Link className="btn primary" to="/new">Create your first project</Link>
        </div>
      )}
      {!!projects?.length && <BackupLine projects={projects} />}
      {!!projects?.length && <div className="projects">{projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}
    </main>
  );
}
