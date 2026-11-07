import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRACK } from '../src/config/track.ts';
import type { Vec2 } from '../src/core/math.ts';
import { getSampleTrack, SAMPLE_COUNT, trackFromControl, trackFromStroke } from '../src/editor/pipeline.ts';
import { strokeToControl } from '../src/editor/smoothing.ts';
import { validateCenterline } from '../src/editor/validation.ts';
import { buildCenterline } from '../src/track/spline.ts';
import { buildTrack } from '../src/track/track.ts';

/** Points along a parametric curve, t in [0, 1]. */
const curve = (n: number, f: (t: number) => Vec2): Vec2[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const ellipse = (rx: number, ry: number, turns = 1, jitter = 0) =>
  curve(400, (t) => {
    const a = t * Math.PI * 2 * turns;
    return { x: Math.cos(a) * rx + Math.sin(t * 977) * jitter, y: Math.sin(a) * ry + Math.cos(t * 613) * jitter };
  });

test('centre line of a circle has the right length, spacing and curvature', () => {
  const r = 100;
  const ctrl = curve(24, (t) => ({ x: r * Math.cos(t * Math.PI * 2), y: r * Math.sin(t * Math.PI * 2) })).slice(0, 24);
  const c = buildCenterline(ctrl);
  assert.ok(Math.abs(c.length - 2 * Math.PI * r) < 2, `length ${c.length}`);
  assert.ok(Math.abs(c.spacing - TRACK.centerSpacing) < 0.1);
  // Increasing angle with y pointing south is clockwise on screen: a right-hander.
  for (let i = 0; i < c.points.length; i++) assert.ok(Math.abs(c.curvature[i] - 1 / r) < 0.001);
});

test('a hand-drawn loop that overshoots the start closes and validates', () => {
  const res = trackFromStroke(ellipse(220, 120, 1.06, 1.5), 'test');
  assert.ok(res.ok, JSON.stringify(res));
  if (!res.ok) return;
  const { center } = res.track;
  assert.ok(center.length > 1000 && center.length < 1250, `length ${center.length}`);
  // Start line is where the pen went down.
  assert.ok(Math.hypot(center.points[0].x - 220, center.points[0].y) < 5);
});

test('an open stroke is rejected as not closed', () => {
  const res = strokeToControl(curve(200, (t) => ({ x: Math.cos(t * 4.5) * 150, y: Math.sin(t * 4.5) * 100 })));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.issue, 'not-closed');
});

test('a tiny loop is rejected as too short', () => {
  const res = trackFromStroke(ellipse(30, 25), 'tiny');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.issue, 'too-short');
});

/** Lissajous figure eight, starting `phase` of the way round (0 = on the crossing). */
const figureEight = (w: number, h: number, phase: number) =>
  curve(400, (t) => ({ x: Math.sin((t + phase) * Math.PI * 2) * w, y: Math.sin((t + phase) * Math.PI * 4) * h }));

test('a figure eight with a steep crossing is allowed', () => {
  const res = trackFromStroke(figureEight(220, 120, 0.25), 'fig8');
  assert.ok(res.ok, JSON.stringify(!res.ok && res.issue));
});

test('a crossing on the start line is rejected', () => {
  const res = trackFromStroke(figureEight(220, 120, 0), 'fig8');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.issue, 'crossing-start');
});

test('a crossing at a shallow angle is rejected', () => {
  const res = trackFromStroke(figureEight(260, 25, 0.25), 'flat8');
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.issue === 'shallow-crossing' || res.issue === 'too-close', res.issue);
});

test('two parallel straights closer than the minimum separation are rejected', () => {
  // A long thin loop: 300 m straights only 10 m apart.
  const ctrl: Vec2[] = [];
  for (let x = -150; x <= 150; x += 10) ctrl.push({ x, y: -5 });
  for (let x = 150; x >= -150; x -= 10) ctrl.push({ x, y: 5 });
  const v = validateCenterline(buildCenterline(ctrl));
  assert.equal(v.ok, false);
  if (!v.ok) assert.ok(v.issue === 'too-close' || v.issue === 'too-tight', v.issue);
});

test('a sharp drawn corner is relaxed to a drivable radius', () => {
  // A right-angled triangle: three sharp corners.
  const tri = [
    ...curve(100, (t) => ({ x: -150 + 300 * t, y: 100 })),
    ...curve(100, (t) => ({ x: 150 - 300 * t, y: 100 - 200 * t })),
    ...curve(100, (t) => ({ x: -150, y: -100 + 200 * t })),
  ];
  const res = trackFromStroke(tri, 'tri');
  assert.ok(res.ok, JSON.stringify(res));
  if (!res.ok) return;
  const maxK = Math.max(...Array.from(res.track.center.curvature, Math.abs));
  assert.ok(1 / maxK >= TRACK.minRadius * 0.85, `min radius ${1 / maxK}`);
});

test('sharp smoothing keeps hand-drawn corners tight, smooth rounds them', () => {
  const sq = [
    ...curve(60, (t) => ({ x: -200 + 400 * t, y: -110 })),
    ...curve(60, (t) => ({ x: 200, y: -110 + 220 * t })),
    ...curve(60, (t) => ({ x: 200 - 400 * t, y: 110 })),
    ...curve(60, (t) => ({ x: -200, y: 110 - 215 * t })),
  ];
  const radiusOf = (level: 'sharp' | 'smooth') => {
    const res = trackFromStroke(sq, 'sq', level);
    assert.ok(res.ok, JSON.stringify(!res.ok && res.issue));
    if (!res.ok) return 0;
    return 1 / Math.max(...Array.from(res.track.center.curvature, Math.abs));
  };
  const sharp = radiusOf('sharp');
  assert.ok(sharp >= TRACK.minRadius && sharp < 9, `sharp corner radius ${sharp}`);
  assert.ok(radiusOf('smooth') > sharp, 'smooth gives rounder corners');
});

test('freehand tracks become a manageable number of editable dots', () => {
  const res = trackFromStroke(ellipse(220, 120, 1.05, 1.5), 'oval');
  assert.ok(res.ok);
  if (res.ok) assert.ok(res.track.def.control.length >= 6 && res.track.def.control.length <= 40, `${res.track.def.control.length} dots`);
});

test('a track rebuilds identically from its definition', () => {
  const res = trackFromStroke(ellipse(200, 110, 1.04, 2), 'det');
  assert.ok(res.ok);
  if (!res.ok) return;
  const again = buildTrack(JSON.parse(JSON.stringify(res.track.def)));
  assert.deepEqual(again.center.points, res.track.center.points);
  for (const p of res.track.def.control) {
    assert.ok(Number.isInteger(p.x / TRACK.quantize) && Number.isInteger(p.y / TRACK.quantize));
  }
});

test('all sample tracks remain valid without a length budget', () => {
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = getSampleTrack(i);
    assert.ok(trackFromControl(t.def).ok, t.def.name);
  }
  assert.equal(SAMPLE_COUNT, 3);
});

test('a drivable circuit longer than the former ink limit is accepted', () => {
  const control = Array.from({ length: 24 }, (_, i) => ({ x: 500 * Math.cos(i * Math.PI / 12), y: 500 * Math.sin(i * Math.PI / 12) }));
  const result = trackFromControl({ id: 'long', name: 'Long circuit', control });
  assert.ok(result.ok);
  assert.ok(result.track.center.length > 3000);
});
