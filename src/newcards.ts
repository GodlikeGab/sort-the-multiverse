/**
 * Keeps every project's pool up to date with newly revealed cards.
 *
 * There is no server, so nothing can run while the app is closed. Instead, each
 * time the app is opened or brought back to the front, every project that has
 * not been checked in the last 12 hours re-asks Scryfall for cards that match
 * its search and are not in its pool yet (see `api.scanNewCards`). Scryfall
 * lists preview cards as soon as they are officially revealed, so this follows
 * a preview season without having to watch for set announcements.
 */
import { api } from './api';

const EVERY_MS = 12 * 3600_000;
let running = false;

export async function checkAllProjects() {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    for (const p of await api.projects()) {
      if (p.status !== 'ready') continue;
      if (p.scannedAt && Date.now() - new Date(p.scannedAt).getTime() < EVERY_MS) continue;
      try {
        await api.scanNewCards(p.id);
      } catch {
        // Offline or Scryfall unavailable: the next opening tries again.
      }
    }
  } finally {
    running = false;
  }
}

export function initNewCards() {
  window.setTimeout(() => void checkAllProjects(), 4000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkAllProjects();
  });
}

/** Screens call this to reload when a check has changed a project. Returns the unsubscribe function. */
export function onProjectsChanged(fn: () => void) {
  window.addEventListener('stm:projects', fn);
  return () => window.removeEventListener('stm:projects', fn);
}
