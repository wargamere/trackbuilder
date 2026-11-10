import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WORLD } from '../src/config/track.ts';
import { GEN_STYLES, generateTrack } from '../src/editor/generate.ts';
import { trackFromControl } from '../src/editor/pipeline.ts';
import { crossingsOf } from '../src/editor/validation.ts';

test('every generator style makes valid tracks that stay on the paper and never cross themselves', () => {
  for (const style of GEN_STYLES) {
    for (let seed = 1; seed <= 6; seed++) {
      const def = generateTrack(style, seed * 7717, 'gen');
      assert.ok(def, `${style} #${seed} made a track`);
      const res = trackFromControl(def);
      assert.ok(res.ok, `${style} #${seed} builds`);
      assert.equal(crossingsOf(res.track.center).length, 0, `${style} #${seed} doesn't cross itself`);
      const off = res.track.center.points.some((p) => Math.abs(p.x) > WORLD.width / 2 - 8 || Math.abs(p.y) > WORLD.height / 2 - 8);
      assert.ok(!off, `${style} #${seed} fits the drawing area`);
    }
  }
});

test('generated tracks are reproducible from their seed, differ between seeds, and suit their style', () => {
  const a = generateTrack('gp', 42, 'x');
  const b = generateTrack('gp', 42, 'x');
  const c = generateTrack('gp', 43, 'x');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a?.control, c?.control);
  const length = (style: (typeof GEN_STYLES)[number]) => {
    const def = generateTrack(style, 99, 'x');
    assert.ok(def);
    const r = trackFromControl(def);
    assert.ok(r.ok);
    return { options: r.track.options, length: r.track.center.length };
  };
  const kart = length('kart');
  const gp = length('gp');
  const oval = length('oval');
  const street = length('street');
  assert.ok(kart.length < gp.length * 0.7, `a kart track is short: ${kart.length.toFixed(0)} m vs ${gp.length.toFixed(0)} m`);
  assert.ok(kart.options.width < gp.options.width && !kart.options.pits);
  assert.ok(oval.options.banking > 0, 'an oval is banked');
  assert.ok(street.options.walls, 'a street circuit has walls');
});
