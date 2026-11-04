import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD } from '../src/config/track.ts';
import { builtInTrack, builtInTracks, trackFromCode } from '../src/editor/pipeline.ts';
import { crossingsOf } from '../src/editor/validation.ts';
import { AuthorLap } from '../src/race/medals.ts';
import { encodeTrack } from '../src/track/code.ts';

test("the built-in tracks: 23 of the game's own and 30 real-world circuits, with unique ids and names", () => {
  const all = builtInTracks();
  assert.equal(all.filter((b) => b.group === 'builtIn').length, 23);
  assert.equal(all.filter((b) => b.group === 'world').length, 30);
  assert.equal(new Set(all.map((b) => b.def.id)).size, all.length, 'ids unique');
  assert.equal(new Set(all.map((b) => b.def.name)).size, all.length, 'names unique');
  for (const b of all) {
    assert.ok(b.def.builtIn, `${b.def.name}: built-in`);
    if (b.group === 'world') assert.ok(b.def.place, `${b.def.name}: has its country`);
  }
});

test('every built-in track is a valid road inside the drawing area, not starting in a corner', () => {
  for (const b of builtInTracks()) {
    const t = b.track();
    const c = t.center;
    for (const p of c.points) {
      assert.ok(Math.abs(p.x) <= WORLD.width / 2 + 1 && Math.abs(p.y) <= WORLD.height / 2 + 1, `${b.def.name}: inside the area at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}`);
    }
    // The start line not in a corner: nothing tighter than a 20 m radius within 20 m either
    // side of it (Monaco's curving pit straight is about that, scaled down; the original
    // hand-drawn samples aside: Knot Garden starts in a sweep).
    const n = c.points.length;
    const near = Math.ceil(20 / c.spacing);
    if (!b.def.id.startsWith('sample-')) {
      for (let k = -near; k <= near; k++) assert.ok(Math.abs(c.curvature[(k + n) % n]) < 1 / 20, `${b.def.name}: the start isn't in a corner`);
    }
    // Only the figure-of-eight (Suzuka) crosses itself, on a bridge.
    const xs = crossingsOf(c);
    if (xs.length) {
      assert.equal(b.def.name, 'Suzuka', `${b.def.name}: no crossing`);
      assert.ok(xs.every((x) => Math.abs(x.dh) >= 6), 'Suzuka: the crossing is a bridge');
    }
  }
});

test('an AI laps every built-in track, at medal pace and flat out', () => {
  for (const b of builtInTracks()) {
    const t = b.track();
    assert.notEqual(new AuthorLap(t).finish(), null, `${b.def.name}: at medal pace`);
    assert.notEqual(new AuthorLap(t, 1).finish(), null, `${b.def.name}: flat out`);
  }
});

test('a built-in track shared as a code comes back as the same built-in', () => {
  for (const id of ['classic-copper-canyon', 'world-it-1922', 'world-jp-1962', 'sample-paperclip']) {
    const t = builtInTrack(id);
    assert.ok(t, id);
    const res = trackFromCode(encodeTrack(t.def.name, t.def.control, t.def.options));
    assert.ok(res.ok && res.track === t, `${id}: same track`);
  }
});
