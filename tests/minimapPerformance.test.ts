import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { Minimap } from '../src/ui/minimap.ts';

test('minimap avoids per-frame layout reads and still responds to resizing, visibility and pixel density', t => {
  const win = new Window();
  const originals = ['document', 'window', 'ResizeObserver'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
  Object.defineProperty(globalThis, 'document', { value:win.document, configurable:true });
  Object.defineProperty(globalThis, 'window', { value:win, configurable:true });
  let resized = () => {};
  class Observer {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value:Observer, configurable:true });
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  t.mock.method(win.HTMLCanvasElement.prototype, 'getContext', () => ctx);
  const map = new Minimap(), track = getSampleTrack(0);
  let width = 180, height = 140, reads = 0;
  Object.defineProperties(map.root, {
    clientWidth: { get: () => { reads++; return width; } },
    clientHeight: { get: () => { reads++; return height; } },
  });
  const draw = () => map.draw(track, { x:0, z:0 }, null);
  draw(); assert.equal(reads, 2); assert.equal(map.root.width, 180);
  for (let i = 0; i < 60; i++) draw();
  assert.equal(reads, 2, 'moving cars never force a layout measurement');
  width = 220; height = 160; resized(); draw();
  assert.equal(map.root.width, 220); assert.equal(map.root.height, 160);
  width = height = 0; resized(); draw();
  width = 180; height = 140; resized(); draw();
  assert.equal(map.root.width, 180, 'recovers after being hidden');
  Object.defineProperty(win, 'devicePixelRatio', { value:2, configurable:true }); draw();
  assert.equal(map.root.width, 360, 'rebuilds at the new display density');
});
