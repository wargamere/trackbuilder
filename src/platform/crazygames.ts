/**
 * CrazyGames HTML5 SDK v3 wrapper (https://docs.crazygames.com/sdk/intro/).
 *
 * The SDK script is added to <head> by the CrazyGames build (vite.config.ts).
 * Everything here is defensive: if the script is blocked (adblock), missing,
 * fails to initialise, or the environment is 'disabled' (any domain other than
 * CrazyGames / localhost), every call becomes a no-op and the game runs normally.
 */

export interface SdkAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: { code?: string; message?: string }) => void;
}

interface SdkUser {
  username: string;
}

interface Sdk {
  environment: 'local' | 'crazygames' | 'disabled' | string;
  init(): Promise<void>;
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime(): void;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(fn: (s: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', callbacks: SdkAdCallbacks): void;
    hasAdblock(): Promise<boolean>;
  };
  user: {
    isUserAccountAvailable?: boolean;
    systemInfo?: { device?: { type?: 'desktop' | 'tablet' | 'mobile' } };
    getUser(): Promise<SdkUser | null>;
    /** A signed token (1 h) for the logged-in player, for our own server to check; throws for guests. */
    getUserToken?(): Promise<string>;
    addAuthListener?(fn: (user: SdkUser | null) => void): void;
  };
}

let sdk: Sdk | null = null;

function rawSdk(): Sdk | null {
  const w = globalThis as unknown as { CrazyGames?: { SDK?: Sdk } };
  return w.CrazyGames?.SDK ?? null;
}

/** Runs an SDK call, swallowing errors (the SDK throws when disabled). */
function safe<T>(fn: (s: Sdk) => T, fallback: T): T {
  if (!sdk) return fallback;
  try {
    return fn(sdk);
  } catch (e) {
    console.warn('[CrazyGames SDK]', e);
    return fallback;
  }
}

/**
 * Initialises the SDK. Resolves true when it is ready to use. Never rejects,
 * and gives up after `timeoutMs` so a blocked or slow SDK can't stall boot.
 */
export async function initCrazyGames(timeoutMs = 5000): Promise<boolean> {
  const s = rawSdk();
  if (!s || s.environment === 'disabled' || typeof s.init !== 'function') return false;
  try {
    const ok = await Promise.race([
      s.init().then(() => true),
      new Promise<boolean>((res) => setTimeout(() => res(false), timeoutMs)),
    ]);
    if (!ok || s.environment === 'disabled') return false;
    sdk = s;
    return true;
  } catch (e) {
    console.warn('[CrazyGames SDK] init failed', e);
    return false;
  }
}

export const crazyGamesReady = (): boolean => sdk !== null;

/** The SDK data module, once the SDK is initialised (same API as localStorage). */
export function crazyGamesData(): Sdk['data'] | null {
  return sdk?.data ?? null;
}

export const cg = {
  loadingStart: () => safe((s) => s.game.loadingStart(), undefined),
  loadingStop: () => safe((s) => s.game.loadingStop(), undefined),
  gameplayStart: () => safe((s) => s.game.gameplayStart(), undefined),
  gameplayStop: () => safe((s) => s.game.gameplayStop(), undefined),
  happytime: () => safe((s) => s.game.happytime(), undefined),

  /** The platform's mute setting; it overrides the in-game sound toggle. */
  muteAudio: (): boolean => safe((s) => !!s.game.settings?.muteAudio, false),
  onSettingsChange(fn: (muteAudio: boolean) => void): void {
    safe((s) => s.game.addSettingsChangeListener?.((st) => fn(!!st.muteAudio)), undefined);
  },

  /** Requests a video ad; exactly one of finished/error is reported (error when unavailable). */
  requestAd(type: 'midgame' | 'rewarded', cb: SdkAdCallbacks): void {
    if (!sdk) {
      setTimeout(() => cb.adError?.({ code: 'unavailable', message: 'SDK not available' }), 0);
      return;
    }
    try {
      sdk.ad.requestAd(type, cb);
    } catch (e) {
      setTimeout(() => cb.adError?.({ code: 'other', message: String(e) }), 0);
    }
  },

  async hasAdblock(): Promise<boolean> {
    if (!sdk) return false;
    try {
      return await sdk.ad.hasAdblock();
    } catch {
      return false;
    }
  },

  /** Logged-in CrazyGames username, or null for guests / when accounts aren't available. */
  async username(): Promise<string | null> {
    if (!sdk || !sdk.user.isUserAccountAvailable) return null;
    try {
      return (await sdk.user.getUser())?.username ?? null;
    } catch {
      return null;
    }
  },

  deviceType: (): 'desktop' | 'tablet' | 'mobile' | null => safe((s) => s.user.systemInfo?.device?.type ?? null, null),

  /** The logged-in player's signed token (see the SDK's user module), or null for guests / no SDK. */
  async userToken(): Promise<string | null> {
    if (!sdk || !sdk.user.isUserAccountAvailable || typeof sdk.user.getUserToken !== 'function') return null;
    try {
      return await sdk.user.getUserToken();
    } catch {
      return null;
    }
  },

  /** Called when the player logs in or out on CrazyGames. */
  onAuthChange(fn: () => void): void {
    safe((s) => s.user.addAuthListener?.(() => fn()), undefined);
  },
};
