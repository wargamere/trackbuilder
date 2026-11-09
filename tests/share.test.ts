import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSampleTrack, SAMPLE_COUNT, trackFromCode, trackFromStroke } from '../src/editor/pipeline.ts';
import { decodeGhost, encodeGhost, ghostPose, type GhostLap } from '../src/race/ghost.ts';
import { GHOST_BUDGET, RecordBook } from '../src/race/records.ts';
import { CODE_PREFIX, decodeTrack, encodeTrack } from '../src/track/code.ts';
import { TrackLibrary } from '../src/track/library.ts';
import { contentId } from '../src/track/track.ts';

test('track codes round-trip exactly and stay short', () => {
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const def = getSampleTrack(i).def;
    const code = encodeTrack(def.name, def.control);
    assert.ok(code.startsWith(CODE_PREFIX));
    assert.ok(code.length < 300, `${def.name}: ${code.length} chars`);
    const d = decodeTrack(code);
    assert.ok(d.ok);
    if (d.ok) {
      assert.equal(d.name, def.name);
      assert.deepEqual(d.dots, def.control);
    }
  }
});

test('names with any characters survive, and long names are trimmed', () => {
  const dots = [
    { x: -300, y: -170.5 },
    { x: 310.5, y: -120 },
    { x: 0, y: 175 },
  ];
  const d = decodeTrack(encodeTrack('Žluťoučký kůň 🏁', dots));
  assert.ok(d.ok);
  if (d.ok) {
    assert.equal(d.name, 'Žluťoučký kůň 🏁');
    assert.deepEqual(d.dots, dots);
  }
  const long = decodeTrack(encodeTrack('x'.repeat(200), dots));
  assert.ok(long.ok && long.name.length <= 64);
});

test('damaged or foreign codes are rejected with a reason', () => {
  const code = encodeTrack('Test', getSampleTrack(1).def.control);
  const flipped = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
  const bad = decodeTrack(flipped);
  assert.ok(!bad.ok && (bad.error === 'checksum' || bad.error === 'format'));
  assert.deepEqual(decodeTrack('hello world'), { ok: false, error: 'format' });
  assert.deepEqual(decodeTrack(code.slice(0, -5)).ok, false);
});

test('a pasted share link works as well as the bare code', () => {
  const def = getSampleTrack(2).def;
  const code = encodeTrack(def.name, def.control);
  const res = trackFromCode(`https://example.com/game/#track=${code}`);
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.track.def.id, def.id, 'a built-in sample keeps its identity');
});

test('a user track imported from a code gets the same id as the original', () => {
  const pts = Array.from({ length: 300 }, (_, i) => {
    const a = (i / 300) * Math.PI * 2.04;
    return { x: Math.cos(a) * 200, y: Math.sin(a) * 110 };
  });
  const made = trackFromStroke(pts, 'Oval');
  assert.ok(made.ok);
  if (!made.ok) return;
  const res = trackFromCode(encodeTrack('Oval', made.track.def.control));
  assert.ok(res.ok);
  if (res.ok) assert.equal(res.track.def.id, contentId(made.track.def.control));
});

test('stored ghosts are compact and replay within a few centimetres', () => {
  const n = 120 * 45; // a 45 s lap at 120 Hz
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    data.set([Math.cos(a) * 250, Math.sin(a) * 140, a + Math.PI / 2], i * 3);
  }
  const g: GhostLap = { t0: 0.004, rate: 120, data };
  const text = encodeGhost(g);
  assert.ok(text.length < 12000, `${text.length} chars`);
  const back = decodeGhost(text);
  assert.ok(back);
  if (!back) return;
  assert.equal(back.rate, 30);
  for (const t of [0.5, 10, 22.2, 44]) {
    const a = ghostPose(g, t);
    const b = ghostPose(back, t);
    assert.ok(a && b);
    if (a && b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.1, `t=${t}: ${Math.hypot(a.x - b.x, a.z - b.z)}`);
  }
  assert.equal(decodeGhost('not a ghost'), null);
});

test('records persist through storage', () => {
  const book = new RecordBook();
  const r = book.get('test-track');
  r.best = { time: 41.234, splits: [4, 8, 12] };
  r.bestScore = 1234;
  r.ghost = { t0: 0, rate: 120, data: new Float32Array([0, 0, 0, 1, 1, 0.1, 2, 2, 0.2, 3, 3, 0.3, 4, 4, 0.4]) };
  book.save('test-track');
  const again = new RecordBook().get('test-track');
  assert.equal(again.best?.time, 41.234);
  assert.equal(again.bestScore, 1234);
  assert.ok(again.ghost && again.ghost.data.length === 6, 'every 4th sample kept');
  book.forget('test-track');
  assert.equal(new RecordBook().get('test-track').best, null);
});

test('saved ghosts stay within budget: the least recently raced lose theirs first, keeping their best times', () => {
  const book = new RecordBook();
  // A 70 s lap: about 17 KB of ghost.
  const n = 120 * 70;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([Math.cos(i / 300) * 200, Math.sin(i / 300) * 120, i / 300], i * 3);
  const ids = Array.from({ length: 40 }, (_, k) => `budget-${k}`);
  for (const id of ids) {
    const r = book.get(id);
    r.best = { time: 70, splits: [] };
    r.ghost = { t0: 0, rate: 120, data };
    book.save(id);
  }
  const fresh = new RecordBook();
  const kept = ids.filter((id) => fresh.get(id).ghost);
  const size = encodeGhost({ t0: 0, rate: 120, data }).length;
  assert.ok(kept.length * size <= GHOST_BUDGET, `${kept.length} ghosts of ${size} chars`);
  assert.ok(kept.length >= 20, `most of them kept: ${kept.length}`);
  assert.ok(kept.includes(ids[ids.length - 1]) && !kept.includes(ids[0]), 'the newest kept, the oldest dropped');
  assert.ok(ids.every((id) => fresh.get(id).best?.time === 70), 'every best time kept');
  for (const id of ids) book.forget(id);
});

test('the library keeps each shape once, newest first, and can delete', () => {
  const lib = new TrackLibrary();
  const a = getSampleTrack(0).def.control.map((p) => ({ x: p.x + 1, y: p.y }));
  const b = getSampleTrack(1).def.control;
  lib.save({ id: contentId(a), name: 'A', control: a });
  lib.save({ id: contentId(b), name: 'B', control: b });
  lib.save({ id: contentId(a), name: 'A renamed', control: a });
  lib.save({ ...getSampleTrack(2).def }); // built-ins are not saved
  const list = new TrackLibrary().list();
  assert.deepEqual(
    list.map((e) => e.def.name),
    ['A renamed', 'B'],
  );
  lib.remove(contentId(b));
  assert.deepEqual(
    new TrackLibrary().list().map((e) => e.def.name),
    ['A renamed'],
  );
});
