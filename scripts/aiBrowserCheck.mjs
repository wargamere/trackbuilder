// Conformance, not a performance or promotion test. Uses the same pure simulator in Node and Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loadPolicy, newDrivingPolicy } from '../src/ai/nn.ts';
import { LearnedDriver } from '../src/ai/learnedDriver.ts';
import { defaultIntent } from '../src/ai/intents.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { DrivingEnv, DT } from '../training/env.ts';
import { updateIntent } from '../training/teacher.ts';

const artifact = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : newDrivingPolicy(42).artifact({ algorithm: 'conformance fixture', seed: 42, samples: 0, updates: 0, promotion: 'experimental', corpus: 'unit test' });
const { network } = loadPolicy(artifact), track = getSampleTrack(0);
const env = new DrivingEnv(track, [{ brain: 'external', difficulty: 1 }], { seed: 42, seconds: 15 });
const driver = new LearnedDriver(track, network), intent = defaultIntent();
for (let i = 0; i < 1800; i++) env.step((a, k) => driver.drive(a.car, env.states, DT, updateIntent(env, k, intent)));
const nodeState = { ...env.states[0] };
const port = Number(process.env.AI_PARITY_PORT || 5228), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--mode', 'web', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'inherit' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* server starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'parity Vite server starts');
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(origin);
  const browserState = await page.evaluate(async (artifact) => {
    const [{ loadPolicy }, { LearnedDriver }, { defaultIntent }, { getSampleTrack }, { DrivingEnv, DT }, { updateIntent }] = await Promise.all([
      import('/src/ai/nn.ts'), import('/src/ai/learnedDriver.ts'), import('/src/ai/intents.ts'),
      import('/src/editor/pipeline.ts'), import('/training/env.ts'), import('/training/teacher.ts'),
    ]);
    const { network } = loadPolicy(artifact), track = getSampleTrack(0);
    const env = new DrivingEnv(track, [{ brain: 'external', difficulty: 1 }], { seed: 42, seconds: 15 });
    const driver = new LearnedDriver(track, network), intent = defaultIntent();
    for (let i = 0; i < 1800; i++) env.step((a, k) => driver.drive(a.car, env.states, DT, updateIntent(env, k, intent)));
    return { ...env.states[0] };
  }, artifact);
  let maximumError = 0;
  for (const key of Object.keys(nodeState)) {
    if (typeof nodeState[key] === 'number') {
      assert.ok(Number.isFinite(browserState[key]), `${key} is finite`);
      maximumError = Math.max(maximumError, Math.abs(nodeState[key] - browserState[key]));
    } else assert.equal(browserState[key], nodeState[key], key);
  }
  assert.ok(maximumError <= 1e-5, `trajectory parity: ${maximumError}`);
  const report = { kind: 'single-car dry Node/Chrome trajectory conformance, not full acceptance parity', ticks: 1800, seed: 42, observationHash: artifact.observationHash, maximumError, passed: true, fullParityGatePassed: false };
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/ai-parity.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser?.close(); server.kill();
}
