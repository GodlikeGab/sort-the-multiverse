import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Copies text; falls back to execCommand because phones on http:// have no clipboard API. */
export async function copyText(text: string, fallbackEl?: HTMLTextAreaElement | null) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  const el = fallbackEl ?? document.createElement('textarea');
  if (!fallbackEl) {
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
  }
  el.focus();
  el.select();
  el.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  if (!fallbackEl) el.remove();
  return ok;
}
