import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
// Diagnostic CPU profile, not a universal FPS assertion: headless graphics and
// device speed vary. Compare runs on the same machine without concurrent tests.
const label = process.argv[2] || 'current';
assert.match(label, /^[a-z0-9-]+$/i);
const port = Number(process.env.RACE_PERF_PORT || 5269), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* server starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'performance server starts');
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${origin}/?autopilot`);
  await page.waitForFunction(() => window.__game);
  await page.evaluate(async () => {
    const game = window.__game;
    game.frame = () => {};
    game.setTrack((await import('/src/editor/pipeline.ts')).builtInTracks().find(t => t.def.id === 'world-au-1953').track());
    game.start({ mode: 'race', opponents: 23, difficulty: 100, grid: 'pick', startSlot: 24, ghost: false, damage: true, laps: 10 });
    window.race = game.screens.race;
  });
  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable'); await client.send('Profiler.start');
  const result = await page.evaluate(async () => {
    const race = window.race;
    const tickMs = []; const sections = {};
    for (const name of ['measureAuthor', 'runQualifyingSims', 'tick', 'placeLabel', 'updateHud']) {
      const fn = race[name].bind(race); sections[name] = { ms: 0, calls: 0, max: 0 };
      race[name] = (...args) => { const t = performance.now(); const ret = fn(...args); const ms = performance.now() - t; sections[name].ms += ms; sections[name].calls++; sections[name].max = Math.max(sections[name].max, ms); return ret; };
    }
    for (let i = 0; i < 1800; i++) { const t = performance.now(); race.tick(); tickMs.push(performance.now() - t); }
    const frameMs = [];
    for (let i = 0; i < 90; i++) { const t = performance.now(); race.frame(1 / 60); frameMs.push(performance.now() - t); }
    const { AuthorLap } = await import('/src/race/medals.ts');
    const author = new AuthorLap(window.__game.track); const authorMs = [];
    for (let i = 0; i < 8; i++) { const t = performance.now(); author.run(1500); authorMs.push(performance.now() - t); }
    const stats = a => { a = [...a].sort((x,y)=>x-y); return { mean: a.reduce((x,y)=>x+y,0)/a.length, p50:a[Math.floor(a.length*.5)], p95:a[Math.floor(a.length*.95)], max:a.at(-1) }; };
    const racing = { tick:stats(tickMs), frame:stats(frameMs), warmFrame:stats(frameMs.slice(10)), author1500:stats(authorMs), sections:structuredClone(sections), draw:window.__game.view3d.stats(), count:race.opponents.length + 1 };
    window.__game.start({ mode:'race', opponents:23, difficulty:100, grid:'qualifying', ghost:false, laps:10 });
    const qualifyingMs = [];
    for (let i = 0; i < 90; i++) { const t = performance.now(); race.frame(1/60); qualifyingMs.push(performance.now() - t); }
    return { racing, qualifying: { frame:stats(qualifyingMs), work:sections.runQualifyingSims, completed:race.qualSims.filter(s => s.result !== undefined).length } };
  });
  const { profile } = await client.send('Profiler.stop');
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/race-performance-${label}.cpuprofile`, JSON.stringify(profile));
  await writeFile(`test-results/race-performance-${label}.json`, JSON.stringify({ ...result, errors }, null, 2));
  const nodes = new Map(profile.nodes.map(n => [n.id,n])); const hit = new Map();
  for (let i = 0; i < profile.samples.length; i++) { const n = nodes.get(profile.samples[i]); const key = `${n.callFrame.functionName} ${n.callFrame.url.split('/').at(-1)}`; hit.set(key, (hit.get(key)||0)+(profile.timeDeltas[i]||0)); }
  console.log(JSON.stringify({ ...result, errors, top: [...hit].sort((a,b)=>b[1]-a[1]).slice(0,25) },null,2));
  assert.deepEqual(errors, [], 'no browser race/qualifying errors');
} finally { await browser?.close(); server.kill(); }
