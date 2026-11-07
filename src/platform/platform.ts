/**
 * Build-time platform flag. All platform-specific code lives in src/platform/;
 * the rest of the game asks this module instead of checking the flag itself.
 */
export type Platform = 'crazygames' | 'web';

// (Outside a Vite build, e.g. in unit tests, the define is missing: treat that as web.)
export const PLATFORM: Platform = typeof __PLATFORM__ !== 'undefined' ? __PLATFORM__ : 'web';
export const IS_CRAZYGAMES = PLATFORM === 'crazygames';

/** What each build may do. The CrazyGames build never shows URLs or links. */
export const CAPS = {
  /** Share links / track code in the URL hash. */
  links: PLATFORM === 'web',
  /** "Rotate your phone" prompt (CrazyGames handles orientation itself). */
  orientationPrompt: PLATFORM === 'web',
} as const;

/**
 * Whether to show the on-screen touch controls. On CrazyGames the SDK's
 * system info decides (mobile / tablet = touch). Otherwise: a coarse pointer
 * with no fine one (phones, tablets).
 */
export function prefersTouchControls(device: 'desktop' | 'tablet' | 'mobile' | null = null): boolean {
  if (device) return device !== 'desktop';
  if (typeof matchMedia !== 'function') return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fine = matchMedia('(any-pointer: fine)').matches;
  return coarse && (!fine || navigator.maxTouchPoints > 0);
}
