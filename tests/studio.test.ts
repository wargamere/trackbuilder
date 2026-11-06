import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STARTERS, starterTrack, surpriseTrack } from '../src/editor/starters.ts';
import { readDraft, writeDraft } from '../src/editor/draft.ts';
import { builtInTracks, trackFromControl } from '../src/editor/pipeline.ts';
import { scoreFor, RecordBook } from '../src/race/records.ts';
import { saveJSON, storage } from '../src/platform/storage.ts';
import { trackOptions } from '../src/track/track.ts';
import { encodeTrack, decodeTrack } from '../src/track/code.ts';

test('all four starters are valid, shareable, editable copies of their layouts', () => {
  for (const { id } of STARTERS) {
    const def = starterTrack(id);
    assert.ok(trackFromControl(def).ok, id);
    assert.equal(def.builtIn, undefined);
    const before = starterTrack(id).control[0].x;
    def.control[0].x += 5;
    assert.equal(starterTrack(id).control[0].x, before, 'template was not mutated');
    assert.ok(decodeTrack(encodeTrack(def.name, def.control, def.options)).ok);
  }
});

test('surprise layouts are reproducible, varied and valid after mirroring and reversing', () => {
  const shapes = new Set<string>();
  for (let seed = 1; seed <= 40; seed++) {
    const def = surpriseTrack(seed);
    assert.deepEqual(def, surpriseTrack(seed));
    assert.ok(trackFromControl(def).ok, `seed ${seed}`);
    assert.equal(def.builtIn, false);
    shapes.add(JSON.stringify(def.control));
  }
  assert.ok(shapes.size > 15);
  const original = JSON.stringify(builtInTracks()[3].def);
  surpriseTrack(1).control[0].x += 20;
  assert.equal(JSON.stringify(builtInTracks()[3].def), original);
});

test('drafts retain unfinished points, heights, name and options independently of saved tracks', () => {
  storage.removeItem('editor.draft.v1');
  assert.equal(readDraft(), null);
  const t = starterTrack('oval');
  const dots = [{ x: 1, y: 2, h: 3, b: 5 }, { x: 20, y: 30 }];
  writeDraft({ dots, closed: false, name: 'Work in progress', options: { ...trackOptions(t), width: 13.5 } });
  const restored = readDraft();
  assert.ok(restored);
  assert.deepEqual(restored.dots, dots);
  assert.equal(restored.closed, false);
  assert.equal(restored.options.width, 13.5);
  assert.equal(restored.name, 'Work in progress');
  writeDraft({ ...restored, dots: [] });
  assert.equal(readDraft()?.name, 'Work in progress', 'a blank page keeps the useful draft');
});

test('corrupt or out-of-bounds drafts cannot break editor startup', () => {
  for (const invalid of [null, {}, { dots: 'oops' }, { dots: [null], closed: true, name: 'x', options: {}, savedAt: 1 }, { dots: [{ x: 900, y: 0 }], closed: true, name: 'x', options: {}, savedAt: 1 }]) {
    saveJSON('editor.draft.v1', invalid);
    assert.equal(readDraft(), null);
  }
  storage.removeItem('editor.draft.v1');
});

test('speed scores have no layout multiplier and legacy lap records survive score migration', () => {
  assert.deepEqual(scoreFor(1000, 50), { avg: 72, score: 720 });
  saveJSON('records.legacy-studio', { best: { time: 50, splits: [10, 20] }, bestScore: 9999, ghost: null });
  const record = new RecordBook().get('legacy-studio');
  assert.equal(record.best?.time, 50);
  assert.equal(record.bestScore, 0, 'legacy multiplied scores do not compete with speed scores');
  record.bestScore = 720;
  const book = new RecordBook();
  book.get('new-studio').bestScore = 720;
  book.save('new-studio');
  assert.equal(new RecordBook().get('new-studio').bestScore, 720);
  book.forget('legacy-studio');
  book.forget('new-studio');
});
