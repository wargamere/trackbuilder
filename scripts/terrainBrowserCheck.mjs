import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5300';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', '5300', '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [], externalTerrain = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/opentopodata|mapzen/i.test(r.url())) externalTerrain.push(r.url()); });
  await page.addInitScript(() => localStorage.setItem('inkcircuit.settings', JSON.stringify({ played: true, graphics: 'fast', graphicsChosen: true })));
  await page.goto(origin); await page.waitForFunction(() => window.__game);
  await mkdir('test-results', { recursive: true });
  const results = [];
  for (const [id, name] of [['world-be-1925', 'spa'], ['world-nl-1948', 'zandvoort'], ['world-sa-2021', 'jeddah'], ['world-bh-2002', 'bahrain']]) {
    const result = await page.evaluate(async ({ id, name }) => {
      const { builtInTrack } = await import('/src/editor/pipeline.ts');
      const { encodeTrack, decodeTrack } = await import('/src/track/code.ts');
      const { surfaceFor, terrainHeight } = await import('/src/track/surface.ts');
      const g = window.__game, t = builtInTrack(id), c = t.center;
      g.go('menu'); g.setTrack(t); g.start({ mode: 'practice', opponents: 0, ghost: false, weather: 'dry', time: 'day' }); g.frame = () => {};
      const r = g.screens.race;
      const bank = Math.max(...c.bank.map(Math.abs));
      let index = 0;
      if (bank > .1) index = c.bank.findIndex(v => Math.abs(v) === bank);
      else if (name === 'spa') index = c.grade.findIndex(v => v === Math.max(...c.grade));
      r.car.placeAt(index * c.spacing); r.car.prev.copyFrom(r.car.state);
      r.rig.snap(r.car.state); r.hud.clearFlash(); r.frame(0);
      const state = r.car.state, ground = surfaceFor(t).terrain;
      const decoded = decodeTrack(encodeTrack(t.def.name, t.def.control, t.options));
      return { id, width: c.width, span: Math.max(...c.height) - Math.min(...c.height), bank: bank * 180 / Math.PI, roll: state.roll * 180 / Math.PI, pitch: state.pitch, y: state.y, ground: terrainHeight(ground, state.x, state.z), grid: ground.nx * ground.nz, shared: decoded.ok && JSON.stringify(decoded.dots) === JSON.stringify(t.def.control) };
    }, { id, name });
    console.log(JSON.stringify(result)); assert.ok(result.shared && result.grid <= 182 ** 2, JSON.stringify(result));
    assert.ok(result.y >= result.ground - .2);
    if (name === 'spa') assert.ok(result.span > 100 && Math.abs(result.pitch) > .02);
    if (name === 'zandvoort') assert.ok(result.bank > 17 && Math.abs(result.roll) > 17);
    if (name === 'jeddah') assert.ok(result.bank > 11 && Math.abs(result.roll) > 11);
    if (name === 'bahrain') assert.equal(result.width, 16);
    await page.screenshot({ path: `test-results/terrain-${name}.png` }); results.push(result);
  }
  await page.evaluate(async () => {
    const g = window.__game; g.setTrack((await import('/src/editor/pipeline.ts')).builtInTrack('world-nl-1948')); g.go('editor');
    const e = g.screens.editor; e.frame(0, 0);
    const index = e.built.track.kerbs.findIndex(k => Math.abs(e.built.track.center.bank[k.apex]) > .2);
    e.setCornerBank(index, 12); e.commitLive(); e.rebuild(); e.flushDraft();
    const angle = Math.abs(e.built.track.center.bank[e.built.track.kerbs[index].apex]) * 180 / Math.PI;
    if (Math.abs(angle - 12) > 1) throw Error(`Editor absolute banking ${angle}`);
    const { readDraft } = await import('/src/editor/draft.ts');
    if (JSON.stringify(readDraft().dots) !== JSON.stringify(e.dots)) throw Error('Terrain draft mismatch');
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__game.surface.w === 844);
  const fits = await page.evaluate(() => {
    const g = window.__game, e = g.screens.editor; e.frame(0, 0); const v = e.view;
    return e.dots.every(p => v.ox + p.x * v.scale >= 0 && v.ox + p.x * v.scale <= g.surface.w && v.oy + p.y * v.scale >= 0 && v.oy + p.y * v.scale <= g.surface.h);
  });
  assert.ok(fits); await page.screenshot({ path: 'test-results/terrain-editor-phone.png' });
  assert.deepEqual(externalTerrain, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, fits, externalTerrain, errors }));
} finally { await browser?.close(); server.kill(); }
