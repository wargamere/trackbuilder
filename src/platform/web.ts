/**
 * Web-build-only features: share links (the track code in the URL hash) and a
 * "rotate your phone" prompt. Callers check CAPS first; the CrazyGames build
 * never touches the URL.
 */

const HASH_KEY = 'track';

/** Track code from `#track=…`, if the page was opened from a share link. */
export function readHashCode(): string | null {
  const m = new RegExp(`[#&]${HASH_KEY}=([^&]+)`).exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Keeps the address bar pointing at the current track (without adding history entries). */
export function writeHashCode(code: string | null): void {
  try {
    const url = code ? `#${HASH_KEY}=${code}` : location.pathname + location.search;
    history.replaceState(null, '', url);
  } catch {
    /* sandboxed iframe: ignore */
  }
}

/** A link that opens the game straight into this track. */
export function trackLink(code: string): string {
  return `${location.origin}${location.pathname}#${HASH_KEY}=${code}`;
}

/**
 * Shows `overlay` while a touch device is held in portrait, and reports changes
 * so the race can pause.
 */
export function installOrientationPrompt(overlay: HTMLElement, onChange: (portrait: boolean) => void): void {
  const touch = matchMedia('(pointer: coarse)');
  const portrait = matchMedia('(orientation: portrait)');
  const update = () => {
    const show = touch.matches && portrait.matches;
    overlay.hidden = !show;
    onChange(show);
  };
  portrait.addEventListener('change', update);
  touch.addEventListener('change', update);
  update();
}
