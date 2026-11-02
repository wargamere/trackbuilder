/**
 * Build-time platform flag. All platform-specific code lives in src/platform/;
 * the rest of the game asks this module instead of checking the flag itself.
 */
export type Platform = 'crazygames' | 'web';

export const PLATFORM: Platform = __PLATFORM__;
export const IS_CRAZYGAMES = PLATFORM === 'crazygames';

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
