import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACK } from '../src/config/track.ts';
import type { Vec2 } from '../src/core/math.ts';
import { getSampleTrack, SAMPLE_COUNT, trackFromStroke } from '../src/editor/pipeline.ts';
import { buildKerbGeometry, buildRoadGeometry } from '../src/track/mesh.ts';
import { surfaceFor } from '../src/track/surface.ts';
import { buildTrack, type Track } from '../src/track/track.ts';

const line = (a: Vec2, b: Vec2, n: number): Vec2[] =>
  Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));

/** A drawn triangle: its corners get relaxed down to about the minimum radius. */
function sharpTrack(): Track {
  const res = trackFromStroke(
    [...line({ x: -150, y: 100 }, { x: 150, y: 100 }, 100), ...line({ x: 150, y: 100 }, { x: -150, y: -100 }, 100), ...line({ x: -150, y: -100 }, { x: -150, y: 100 }, 101)],
    'sharp',
  );
  assert.ok(res.ok);
  return res.track;
}

test('road ribbon never folds back on itself, even at the tightest corners', () => {
  const tracks = [sharpTrack(), ...Array.from({ length: SAMPLE_COUNT }, (_, i) => getSampleTrack(i))];
  for (const t of tracks) {
    const g = buildRoadGeometry(t.center, surfaceFor(t)).ground;
    const pos = g.getAttribute('position');
    const n = t.center.points.length;
    assert.equal(pos.count, (n + 1) * 2);
    for (let r = 0; r < n; r++) {
      const tan = t.center.tangents[r];
      for (const side of [0, 1]) {
        const a = r * 2 + side;
        const b = a + 2;
        const dx = pos.getX(b) - pos.getX(a);
        const dz = pos.getZ(b) - pos.getZ(a);
        assert.ok(dx * tan.x + dz * tan.y > 0, `${t.def.name}: edge ${side} folds at row ${r}`);
      }
    }
  }
});

test('road texture V ends on a whole number of tiles, so the loop has no seam', () => {
  const t = getSampleTrack(0);
  const g = buildRoadGeometry(t.center, surfaceFor(t)).ground;
  const uv = g.getAttribute('uv');
  const lastV = uv.getY(uv.count - 1);
  assert.equal(lastV, Math.round(lastV));
  assert.equal(uv.getY(0), 0);
});

test('kerbs sit on the outside of corners and on the inside at the apex, never on the road', () => {
  // A small clockwise circle (all right-handers).
  const r = 40;
  const control = Array.from({ length: 32 }, (_, i) => ({
    x: r * Math.cos((i / 32) * Math.PI * 2),
    y: r * Math.sin((i / 32) * Math.PI * 2),
  }));
  const t = buildTrack({ id: 'circle', name: 'circle', control });
  assert.ok(t.kerbs.length > 0 && t.kerbs.every((k) => k.sign === 1));
  const g = buildKerbGeometry(t);
  assert.ok(g);
  const pos = g.getAttribute('position');
  let outside = 0;
  let inside = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getZ(i));
    if (d > r + TRACK.roadWidth / 2 - 0.5) outside++;
    else if (d < r - TRACK.roadWidth / 2 + 0.5) inside++;
    else assert.fail(`kerb vertex on the road, at radius ${d.toFixed(2)}`);
  }
  assert.ok(outside > 0 && inside > 0, `outside ${outside}, inside ${inside}`);
});

test('a straight-ish track gets no kerbs', () => {
  const control = Array.from({ length: 40 }, (_, i) => ({
    x: 300 * Math.cos((i / 40) * Math.PI * 2),
    y: 160 * Math.sin((i / 40) * Math.PI * 2),
  }));
  const t = buildTrack({ id: 'oval', name: 'oval', control });
  assert.equal(t.kerbs.length, 0);
  assert.equal(buildKerbGeometry(t), null);
});
