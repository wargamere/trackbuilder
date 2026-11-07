import { cg, crazyGamesReady, initCrazyGames } from './crazygames.ts';
import { PLATFORM } from './platform.ts';

/**
 * Platform services the game calls without knowing which build it is in.
 * On the web build these are no-ops (no ads, no accounts); on CrazyGames they
 * go through the SDK wrapper. Platform-specific code stays in src/platform/.
 */

const ADS_BUILD = typeof __ADS__ !== 'undefined' && __ADS__;

/** Every SDK event this session, newest last (shown in dev builds for QA). */
export const sdkEventLog: string[] = [];
function log(e: string): void {
  sdkEventLog.push(e);
  if (sdkEventLog.length > 200) sdkEventLog.shift();
}

let gameplayWanted = false;
let gameplayReported = false;
let adsOff = false;
let adblockCheck: Promise<boolean> | null = null;
let usernameCheck: Promise<string | null> | null = null;

/** Gameplay start/stop are only reported on changes, and never while the tab is hidden (CrazyGames handles focus changes itself). */
function syncGameplay(): void {
  if (typeof document !== 'undefined' && document.hidden) return;
  if (gameplayWanted === gameplayReported) return;
  gameplayReported = gameplayWanted;
  if (gameplayWanted) {
    log('gameplayStart');
    cg.gameplayStart();
  } else {
    log('gameplayStop');
    cg.gameplayStop();
  }
}

export interface AdHooks {
  /** An ad really started: pause and mute. */
  onAdStart(): void;
  /** The ad finished or failed: unmute and continue. */
  onAdEnd(): void;
}

let hooks: AdHooks = { onAdStart: () => {}, onAdEnd: () => {} };

export const platform = {
  /** Must finish before anything reads storage. Never rejects. */
  async init(): Promise<void> {
    if (PLATFORM !== 'crazygames') return;
    const ok = await initCrazyGames();
    log(ok ? 'init' : 'init:unavailable');
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', syncGameplay);
  },

  get sdkReady(): boolean {
    return crazyGamesReady();
  },

  loadingStart(): void {
    log('loadingStart');
    cg.loadingStart();
  },

  loadingStop(): void {
    log('loadingStop');
    cg.loadingStop();
  },

  /** True while the player is actually driving (not counting down, paused or in menus). */
  setGameplay(active: boolean): void {
    gameplayWanted = active;
    syncGameplay();
  },

  /** Celebrate a personal best (used sparingly: once per run at most). */
  happytime(): void {
    log('happytime');
    cg.happytime();
  },

  setAdHooks(h: AdHooks): void {
    hooks = h;
  },

  /** Ads exist only in a CrazyGames build made with ADS=1, with the SDK up, until the SDK says they're disabled. */
  get adsEnabled(): boolean {
    return ADS_BUILD && crazyGamesReady() && !adsOff;
  },

  /**
   * Requests a video ad and resolves when the game may continue: 'finished',
   * or 'error' (unfilled, adblock, cooldown, disabled...). The caller blocks
   * its UI until then; audio is muted only once an ad really starts.
   */
  requestAd(type: 'midgame' | 'rewarded'): Promise<'finished' | 'error'> {
    if (!this.adsEnabled) return Promise.resolve('error');
    log(`requestAd:${type}`);
    return new Promise((resolve) => {
      let started = false;
      let done = false;
      const finish = (result: 'finished' | 'error') => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        if (started) hooks.onAdEnd();
        resolve(result);
      };
      // If the SDK never answers and no ad started, don't leave the player stuck.
      const safety = setTimeout(() => {
        if (!started) finish('error');
      }, 10000);
      cg.requestAd(type, {
        adStarted: () => {
          if (done) return;
          started = true;
          log(`adStarted:${type}`);
          hooks.onAdStart();
        },
        adFinished: () => {
          log(`adFinished:${type}`);
          finish('finished');
        },
        adError: (e) => {
          log(`adError:${type}:${e?.code ?? '?'}`);
          if (e?.code === 'adsDisabled') adsOff = true;
          finish('error');
        },
      });
    });
  },

  /** Whether an ad blocker was detected (checked once). */
  hasAdblock(): Promise<boolean> {
    adblockCheck ??= this.adsEnabled ? cg.hasAdblock() : Promise.resolve(false);
    return adblockCheck;
  },

  /** CrazyGames username of a logged-in player (never any other login), else null. */
  username(): Promise<string | null> {
    usernameCheck ??= crazyGamesReady() ? cg.username() : Promise.resolve(null);
    return usernameCheck;
  },

  /** Platform audio mute (CrazyGames settings.muteAudio); overrides the in-game toggle. */
  platformMuted(): boolean {
    return crazyGamesReady() ? cg.muteAudio() : false;
  },

  onPlatformMuteChange(fn: (muted: boolean) => void): void {
    if (crazyGamesReady()) cg.onSettingsChange(fn);
  },

  /** Device type from the CrazyGames system info, when available. */
  deviceType(): 'desktop' | 'tablet' | 'mobile' | null {
    return crazyGamesReady() ? cg.deviceType() : null;
  },
};
