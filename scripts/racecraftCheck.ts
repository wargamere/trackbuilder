import { mkdir, writeFile } from 'node:fs/promises';
import { cornerDuel } from '../tests/helpers/racecraft.ts';
import { DrivingEnv } from '../training/env.ts';
import { raceMetrics } from '../training/metrics.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';

const runs = [];
await mkdir('test-results', { recursive: true });
if (process.argv.includes('--field')) {
  const fields = [];
  for (const field of [20, 24]) {
    const env = new DrivingEnv(getSampleTrack(1), Array.from({ length: field }, (_, i) => ({ brain: 'classic', difficulty: 0.9, player: i === field - 1 })), { seed: 88, laps: 2, seconds: 240, damage: true });
    while (!env.done) env.step();
    const result = raceMetrics(env);
    fields.push(result);
    console.log(JSON.stringify({ field, finishers: result.finishers, retired: result.retirements, firm: result.firmContacts, hard: result.hardContacts, resets: result.cars.reduce((n, c) => n + c.resets, 0), off: result.cars.reduce((n, c) => n + c.offSeconds, 0) }));
  }
  await writeFile('test-results/racecraft-fields.json', JSON.stringify({ seed: 88, track: 'Paperclip', laps: 2, player: 'matched clean classic stand-in at the back', fields }, null, 2));
} else {
  for (const track of [0, 1, 2]) for (const start of [-1, 0, 1, 6]) for (const style of ['inside', 'wide-exit'] as const) runs.push(cornerDuel(track, start, style));
  await writeFile('test-results/racecraft.json', JSON.stringify(runs, null, 2));
  console.log(JSON.stringify(runs.map(({ trace: _trace, ...run }) => run), null, 2));
}
