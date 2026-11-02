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
 * Whether to show the on-screen touch controls. Web: a coarse pointer with no
 * fine one (phones, tablets). The CrazyGames build will use the SDK's device
 * type here instead (Phase 6).
 */
export function prefersTouchControls(): boolean {
  if (typeof matchMedia !== 'function') return false;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const fine = matchMedia('(any-pointer: fine)').matches;
  return coarse && (!fine || navigator.maxTouchPoints > 0);
}
