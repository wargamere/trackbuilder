/**
 * CrazyGames SDK v3 wrapper. Everything here is defensive: if the SDK script
 * is blocked (adblock), missing (local testing) or its environment is
 * 'disabled', every call becomes a no-op and the game runs normally.
 * (Phase 6 adds init, game events, ads and user info.)
 */

/** The subset of the SDK `data` module the game uses (same shape as localStorage). */
interface SdkData {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CrazySdk {
  environment?: string;
  data?: Partial<SdkData>;
}

function sdk(): CrazySdk | null {
  const w = globalThis as unknown as { CrazyGames?: { SDK?: CrazySdk } };
  const s = w.CrazyGames?.SDK;
  if (!s || s.environment === 'disabled') return null;
  return s;
}

/** The SDK data module when it's usable, otherwise null (callers fall back to localStorage). */
export function crazyGamesData(): SdkData | null {
  const d = sdk()?.data;
  if (!d || typeof d.getItem !== 'function' || typeof d.setItem !== 'function' || typeof d.removeItem !== 'function') {
    return null;
  }
  return d as SdkData;
}
