/**
 * Works out the real usable screen height and publishes it to CSS.
 *
 * An installed iPhone web app whose page extends under the status bar reports
 * a viewport that is too short by the status bar's height, which leaves an
 * unused strip at the bottom of the screen. CSS alone cannot see that, so this
 * measures it and sets two variables:
 *
 *   --app-h    the height to lay the app out in
 *   --gap-fix  how far below the reported bottom edge the screen really ends
 *
 * Everywhere else both come out as the normal viewport height and 0.
 */
function safeTop(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;padding-top:env(safe-area-inset-top)';
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return px;
}

function measure() {
  const reported = window.innerHeight;
  const standalone =
    (navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  const portrait = window.innerHeight >= window.innerWidth;
  let full = reported;
  if (standalone && portrait) {
    // Never beyond the physical screen, and never more than the status bar's height extra.
    full = Math.max(reported, Math.min(screen.height, reported + safeTop()));
  }
  const root = document.documentElement.style;
  root.setProperty('--app-h', `${full}px`);
  root.setProperty('--gap-fix', `${full - reported}px`);
}

export function initViewport() {
  measure();
  window.addEventListener('resize', measure);
  window.addEventListener('orientationchange', () => setTimeout(measure, 300));
}
