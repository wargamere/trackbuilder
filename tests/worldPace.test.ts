import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDLING } from '../src/config/handling.ts';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import type { Progress, RaceEvent } from '../src/race/session.ts';

// Exercise actual steering, throttle, physics and checkpoint crossings, not just
// the planned speed profile. Include every real circuit, not only editor samples.
for (const entry of builtInTracks().filter(t => t.group === 'world')) {
  test(`${entry.def.name}: four clean laps with consistent flying pace`, () => {
    const t = entry.track();
    // Spielberg at 90% reproduces a checkpoint exactly on a sampled vertex.
    const ai = new AiDriver(t, { name: 'Audit', paint: 0, difficulty: t.def.id === 'world-at-1969' ? .9 : 1, laps: 4, slot: 0 });
    const st = ai.car.state, events: RaceEvent[] = [];
    const progress = (): Progress => {
      const tan = t.center.tangents[Math.max(0, st.trackIndex)];
      return { s: st.s, lateral: st.lateral, along: st.vx * tan.x + st.vz * tan.y, offTrack: st.offTrack };
    };
    let walls = 0, off = 0, chicaneMinimum = Infinity;
    for (let tick = 0; tick < HANDLING.tickRate * 350 && ai.session.phase !== 'finished'; tick++) {
      const prev = progress(); ai.car.step(ai.drive([st], ai.car.dt)); ai.session.step(prev, progress(), events);
      if (ai.session.laps.length > 0) {
        if (st.wallHit) walls++;
        if (st.offTrack) off++;
        // The exit of Melbourne's fast left-right: no repeated recovery lift
        // after a controlled direction change (previously dropped below 36 m/s).
        if (t.def.id === 'world-au-1953' && st.s > 710 && st.s < 740) chicaneMinimum = Math.min(chicaneMinimum, st.speed);
      }
    }
    assert.equal(ai.session.laps.length, 4);
    assert.deepEqual(ai.session.lapValid, [true, true, true, true]);
    assert.equal(walls, 0); assert.equal(off, 0);
    assert.ok(!events.some(e => e.type === 'missedCheckpoint'));
    const flying = ai.session.laps.slice(1);
    assert.ok(Math.max(...flying) - Math.min(...flying) < .25, `flying laps: ${flying.join(', ')}`);
    if (t.def.id === 'world-au-1953') assert.ok(chicaneMinimum > 37.5, `chicane exit: ${chicaneMinimum.toFixed(2)} m/s`);
  });
}
