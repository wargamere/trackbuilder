import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { builtInTrack, builtInTracks, trackFromCode } from '../src/editor/pipeline.ts';
import { encodeTrack, decodeTrack } from '../src/track/code.ts';
import { CIRCUIT_WIDTHS } from '../src/track/circuitWidths.ts';
import { WORLD_TERRAIN } from '../src/track/data/worldTerrain.ts';
import { surfaceFor, terrainHeight } from '../src/track/surface.ts';
import { readDraft, writeDraft } from '../src/editor/draft.ts';
import { reverseDots } from '../src/editor/smoothing.ts';
import { transformDots } from '../src/editor/transform.ts';
import { paperFor } from '../src/track/bounds.ts';
import { RecordBook } from '../src/race/records.ts';
import { saveJSON, loadJSON, storage } from '../src/platform/storage.ts';

test('all real circuits have cached, geographically registered terrain and circuit-specific road widths', () => {
  const source = JSON.parse(fs.readFileSync('data/circuits/elevation-samples.json', 'utf8'));
  const entries = builtInTracks().filter(t => t.group === 'world');
  assert.equal(source.circuits.length, entries.length);
  for (const e of entries) {
    const raw = source.circuits.find((s: { id: string }) => s.id === e.def.id), t = e.track();
    assert.ok(raw && raw.locations.length === 96 && raw.elevation.length === 96 && raw.fitRms < 65, e.def.name);
    assert.equal(WORLD_TERRAIN[e.def.id].heights.length, e.def.control.length);
    assert.ok(t.center.height.every(Number.isFinite));
    assert.ok(Math.max(...t.center.height) - Math.min(...t.center.height) > .4, e.def.name);
    assert.equal(t.center.width, CIRCUIT_WIDTHS[e.def.id]);
    assert.ok(e.def.control.every(p => (p.h ?? 0) < 200 && p.bank !== undefined));
    const decoded = trackFromCode(encodeTrack(e.def.name, e.def.control, e.def.options));
    assert.ok(decoded.ok, e.def.name);
    if (decoded.ok) assert.deepEqual(decoded.track.center.height, t.center.height);
  }
});

test('published elevation spans are retained without the old forty-metre clipping', () => {
  for (const [id, span] of [['world-be-1925', 102.2], ['world-at-1969', 63.5], ['world-sg-2008', 5.3], ['world-mx-1962', 2.8]] as const) {
    const h = builtInTrack(id)!.center.height;
    assert.ok(Math.abs(Math.max(...h) - Math.min(...h) - span) < 2, id);
  }
  assert.ok(Math.max(...builtInTrack('world-be-1925')!.center.height) > 100);
});

test('Zandvoort and Jeddah use actual signed banking angles independently of bend radius', () => {
  for (const [id, angle] of [['world-nl-1948', 18], ['world-sa-2021', 12]] as const) {
    const t = builtInTrack(id)!, c = t.center, peak = Math.max(...c.bank.map(v => Math.abs(v))) * 180 / Math.PI;
    assert.ok(peak > angle - 1 && peak <= angle + .1, `${id}: ${peak}`);
    for (let i = 0; i < c.bank.length; i++) if (Math.abs(c.bank[i]) > .08 && Math.abs(c.curvature[i]) > .003) assert.ok(c.bank[i] * c.curvature[i] > 0, 'leans into the documented bank, with rollout on the straights');
  }
});


test('tall heights and signed banks survive sharing, drafts, mirroring and direction reversal', () => {
  const t = builtInTrack('world-nl-1948')!;
  const control = t.def.control.map((p, i) => ({ ...p, h: (p.h ?? 0) + 140, bank: i === 0 ? -18 : p.bank }));
  const d = decodeTrack(encodeTrack('Tall banks', control, t.options));
  assert.ok(d.ok); if (d.ok) assert.deepEqual(d.dots, control);
  writeDraft({ dots: control, name: 'Tall banks', closed: true, options: t.options });
  assert.deepEqual(readDraft()?.dots, control); storage.removeItem('editor.draft.v1');
  assert.equal(reverseDots(control)[0].bank, 18);
  assert.equal(transformDots(control, 'mirror', paperFor(control))[0].bank, 18);
});

test('full-size flat-layout records remain stored separately from the revised terrain', () => {
  const id = 'world-be-1925', old = { best: { time: 90, splits: [] }, bestScore: 1600, ghost: null };
  saveJSON(`records.full-v1/${id}`, old);
  const book = new RecordBook(); assert.equal(book.get(id).best, null);
  book.get(id).best = { time: 95, splits: [] }; book.save(id);
  assert.deepEqual(loadJSON(`records.full-v1/${id}`, null), old);
  book.forget(id); storage.removeItem(`records.full-v1/${id}`);
});

test('the terrain envelope supports hills between roads with a bounded heightfield', () => {
  const t = builtInTrack('world-be-1925')!, grid = surfaceFor(t).terrain;
  assert.ok(grid.nx * grid.nz <= 182 ** 2);
  assert.equal(terrainHeight(grid, grid.x0, grid.z0), 0);
  assert.ok(grid.h.some(v => v > 70));
});
