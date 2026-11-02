/**
 * Build-time platform flag. All platform-specific code lives in src/platform/;
 * the rest of the game asks this module instead of checking the flag itself.
 */
export type Platform = 'crazygames' | 'web';

export const PLATFORM: Platform = __PLATFORM__;
export const IS_CRAZYGAMES = PLATFORM === 'crazygames';
