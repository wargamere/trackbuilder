import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Platform layer against a fake CrazyGames SDK (the real one only runs in a
 * browser). The fake records calls and lets each test script the ad outcome.
 */
const calls: string[] = [];
const data = new Map<string, string>();
let adScript: (type: string, cb: Record<string, (e?: unknown) => void>) => void = () => {};

Object.assign(globalThis, {
  __PLATFORM__: 'crazygames', // as in npm run build:cg
  __ADS__: true, // ...made with ADS=1
  CrazyGames: {
    SDK: {
      environment: 'local',
      init: async () => void calls.push('init'),
      data: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
      },
      game: {
        loadingStart: () => calls.push('loadingStart'),
        loadingStop: () => calls.push('loadingStop'),
        gameplayStart: () => calls.push('gameplayStart'),
        gameplayStop: () => calls.push('gameplayStop'),
        happytime: () => calls.push('happytime'),
        settings: { muteAudio: true },
      },
      ad: {
        requestAd: (type: string, cb: Record<string, (e?: unknown) => void>) => adScript(type, cb),
        hasAdblock: async () => false,
      },
      user: {
        isUserAccountAvailable: true,
        systemInfo: { device: { type: 'mobile' } },
        getUser: async () => ({ username: 'SingingCheese.TLNU' }),
      },
    },
  },
});

const { platform } = await import('../src/platform/services.ts');
const { storage } = await import('../src/platform/storage.ts');
const { prefersTouchControls } = await import('../src/platform/platform.ts');
await platform.init();

test('SDK init happens first, and storage then goes to the SDK data module', () => {
  assert.equal(calls[0], 'init');
  assert.ok(platform.sdkReady);
  storage.setItem('k', 'v');
  assert.equal(data.get('inkcircuit.k'), 'v');
  assert.equal(storage.getItem('k'), 'v');
});

test('gameplay start/stop are only reported when the state changes', () => {
  calls.length = 0;
  platform.setGameplay(true);
  platform.setGameplay(true);
  platform.setGameplay(false);
  platform.setGameplay(false);
  platform.setGameplay(true);
  assert.deepEqual(calls, ['gameplayStart', 'gameplayStop', 'gameplayStart']);
  platform.setGameplay(false);
});

test('a midgame ad mutes only once it really starts, and the game continues after it', async () => {
  const hooks: string[] = [];
  platform.setAdHooks({ onAdStart: () => hooks.push('start'), onAdEnd: () => hooks.push('end') });
  adScript = (_t, cb) => {
    setTimeout(() => cb.adStarted(), 5);
    setTimeout(() => cb.adFinished(), 10);
  };
  assert.equal(await platform.requestAd('midgame'), 'finished');
  assert.deepEqual(hooks, ['start', 'end']);
});

test('an unfilled ad never mutes and is reported as an error (no reward)', async () => {
  const hooks: string[] = [];
  platform.setAdHooks({ onAdStart: () => hooks.push('start'), onAdEnd: () => hooks.push('end') });
  adScript = (_t, cb) => setTimeout(() => cb.adError({ code: 'unfilled', message: 'No ad available' }), 5);
  assert.equal(await platform.requestAd('rewarded'), 'error');
  assert.deepEqual(hooks, []);
});

test('"adsDisabled" (e.g. Basic Launch) switches ads off for the session', async () => {
  adScript = (_t, cb) => setTimeout(() => cb.adError({ code: 'adsDisabled', message: 'Basic launch' }), 1);
  assert.ok(platform.adsEnabled);
  await platform.requestAd('midgame');
  assert.equal(platform.adsEnabled, false);
  assert.equal(await platform.requestAd('rewarded'), 'error');
});

test('username, platform mute and device type come from the SDK', async () => {
  assert.equal(await platform.username(), 'SingingCheese.TLNU');
  assert.equal(platform.platformMuted(), true);
  assert.equal(platform.deviceType(), 'mobile');
  assert.equal(prefersTouchControls(platform.deviceType()), true);
  assert.equal(prefersTouchControls('desktop'), false);
});

test('paints unlock by finished runs or by a rewarded ad', async () => {
  const paint = await import('../src/car/paint.ts');
  const { settings } = await import('../src/core/settings.ts');
  assert.ok(paint.paintUnlocked('yellow'));
  assert.ok(!paint.paintUnlocked('red'));
  assert.deepEqual(paint.recordFinishedRun(), ['red']);
  assert.equal(paint.nextLockedPaint()?.id, 'blue');
  paint.unlockPaintByAd('blue');
  assert.ok(paint.paintUnlocked('blue'));
  assert.equal(settings().paint, 'blue');
  assert.equal(paint.nextLockedPaint()?.id, 'green');
});
