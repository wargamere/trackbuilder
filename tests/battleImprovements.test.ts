import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtInTracks } from '../src/editor/pipeline.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { aiPace } from '../src/race/ai.ts';
import { carPace, roadPace } from '../src/race/racingLine.ts';
import { suggestedSetup } from '../src/race/strategy.ts';
import { approachBattle } from './helpers/battles.ts';
const circuit = (id: string) => builtInTracks().find(t => t.def.id === id)!.track();
test('duelling on the same racing line does not invent phantom braking corners', () => {
  for (const id of ['world-au-1953', 'world-it-1922', 'world-gb-1948']) {
    const t = circuit(id), d = new RacingDriver(t, roadPace(carPace(aiPace(1, t), suggestedSetup(t)), t));
    for (let s = 0; s < t.center.length; s += 5) assert.ok(d.pathLimit(s, x => d.lateralAt(x)) > d.limitAt(s) * .8, `${id} at ${s}`);
  }
});
for (const [id, approach] of [['world-au-1953', 260], ['world-gb-1948', 130]] as const) {
  test(`${id}: a stronger AI car races a slower player car at full pace instead of staying in its wake`, () => {
    // Deliberately slow traffic fixture, independent of career balance values.
    const run = approachBattle(circuit(id), { mode: 'attack', approach, playerDifficulty: 1, playerHardware: { grip: .76, pull: .712, top: .88 } });
    if (id === 'world-au-1953') assert.ok(run.finalGap < -5, `actually clears the player: ${run.finalGap.toFixed(2)} m`);
    else { assert.ok(run.minGap < 2, 'earns a real overlap into the corner'); assert.ok(run.finalGap < 12, 'keeps attacking the defending player'); }
    assert.ok(run.peakAlongside > .5); assert.equal(run.contacts, 0); assert.equal(run.off, 0);
  });
}
