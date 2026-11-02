import { STR, fmt } from '../config/strings.ts';
import { DOTS, INK, TRACK, WORLD, type SmoothingLevel } from '../config/track.ts';
import { clamp, dist, dist2, polylineLength, type Vec2 } from '../core/math.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { inkLeftWhileDrawing, inkMultiplier } from '../track/ink.ts';
import { sampleOpenCatmullRom } from '../track/spline.ts';
import { buildTrack, contentId, type TrackDef } from '../track/track.ts';
import { EditorUI, type EditorMode, type MessageKind } from '../ui/editorUI.ts';
import { dotsFromStroke, getSampleTrack, SAMPLE_COUNT, trackFromControl, type BuildResult } from './pipeline.ts';
import {
  drawChain,
  drawCloseZone,
  drawDots,
  drawFlag,
  drawPaper,
  drawProblem,
  drawStroke,
  drawTrack,
  fitView,
  flagRect,
  toScreen,
  toWorld,
  type View,
} from './render2d.ts';
import { reverseDots, rotateDots, snapDot } from './smoothing.ts';
import { findCrossings, type TrackIssue } from './validation.ts';

type Failed = { stroke: Vec2[]; issue: TrackIssue | 'not-closed-ink'; at?: Vec2 };

/** One undo step. */
interface Snapshot {
  dots: Vec2[];
  closed: boolean;
  failed: Failed | null;
  name: string;
}

type Drag =
  | { kind: 'stroke' }
  | { kind: 'dot'; index: number; before: Snapshot; moved: boolean; sx: number; sy: number }
  | { kind: 'flag'; target: number; before: Snapshot };

const MAX_HISTORY = 80;
const DOUBLE_TAP_MS = 350;

/**
 * The track editor. A track is a closed loop of "dots" with a smooth spline
 * through them. Draw mode turns one freehand stroke into dots; Dots mode places
 * them one by one. In both modes every dot can be dragged afterwards, the start
 * flag can be moved, and the track is validated live. Every metre spends ink.
 */
export class EditorScreen implements Screen {
  readonly layer = '2d';
  private readonly game: GameContext;
  private readonly ui: EditorUI;
  private abort: AbortController | null = null;
  private view: View = { scale: 1, ox: 0, oy: 0 };

  // Settings (kept between visits).
  private mode: EditorMode = 'draw';
  private smoothing: SmoothingLevel = 'normal';
  private snapOn = false;
  private sampleIndex = 0;

  // The track being edited.
  private dots: Vec2[] = [];
  private closed = false;
  private failed: Failed | null = null;
  private name: string = STR.editor.customName;
  private base: TrackDef | null = null;
  private history: Snapshot[] = [];
  private future: Snapshot[] = [];
  private note: { text: string; kind: MessageKind } | null = null;

  // Derived, rebuilt when dirty.
  private dirty = true;
  private built: BuildResult | null = null;
  private crossings = 0;
  private openLine: Vec2[] = [];
  private dotSamples: number[] = [];

  // Interaction.
  private pointerId = -1;
  private drag: Drag | null = null;
  private hover = -1;
  private selected = -1;
  private hoverFlag = false;
  private lastTap = { index: -1, time: 0 };
  private stroke: Vec2[] | null = null;
  private strokeLen = 0;
  private outOfInk = false;
  private closing = false;

  constructor(game: GameContext) {
    this.game = game;
    this.ui = new EditorUI(
      {
        back: () => this.game.go('race'),
        undo: () => this.undo(),
        redo: () => this.redo(),
        clear: () => this.clear(),
        race: () => this.race(),
        setMode: (m) => this.setMode(m),
        setSmoothing: (s) => (this.smoothing = s),
        setSnap: (on) => (this.snapOn = on),
        reverse: () => this.reverse(),
        sample: (i) => this.loadSample(i),
        rename: (n) => (this.name = n.trim() || STR.editor.customName),
      },
      Array.from({ length: SAMPLE_COUNT }, (_, i) => getSampleTrack(i).def.name),
    );
  }

  enter(): void {
    // Open with the track you were racing, ready to tweak. Clear gives a blank page.
    const t = this.game.track;
    this.base = t.def;
    this.dots = t.def.control.map((p) => ({ ...p }));
    this.closed = true;
    this.failed = null;
    this.name = t.def.name;
    this.history = [];
    this.future = [];
    this.note = null;
    this.selected = this.hover = -1;
    this.dirty = true;
    this.cancelPointer();
    this.ui.toggleOptions(false);
    this.game.ui.append(this.ui.root);
    this.game.surface.canvas.classList.add('drawing');

    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    const c = this.game.surface.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e), opts);
    c.addEventListener('pointermove', (e) => this.onPointerMove(e), opts);
    c.addEventListener('pointerup', (e) => this.onPointerUp(e), opts);
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e), opts);
    c.addEventListener('lostpointercapture', (e) => this.onPointerUp(e), opts);
    c.addEventListener('pointerleave', () => (this.hover = -1), opts);
    window.addEventListener('keydown', (e) => this.onKey(e), opts);
    this.resize();
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.cancelPointer();
    this.ui.root.remove();
    this.game.surface.canvas.classList.remove('drawing');
    this.game.surface.canvas.style.cursor = '';
  }

  resize(): void {
    const s = this.game.surface;
    const inset = this.ui.insets();
    this.view = fitView(s.w, s.h, inset.top, inset.bottom);
  }

  // ------------------------------------------------------------- history

  private snapshot(): Snapshot {
    return {
      dots: this.dots.map((p) => ({ ...p })),
      closed: this.closed,
      failed: this.failed,
      name: this.name,
    };
  }

  private restore(s: Snapshot): void {
    this.dots = s.dots.map((p) => ({ ...p }));
    this.closed = s.closed;
    this.failed = s.failed;
    this.name = s.name;
    this.selected = this.hover = -1;
    this.dirty = true;
  }

  /** Records `before` as an undo step (call after changing the state). */
  private commit(before: Snapshot, note: { text: string; kind: MessageKind } | null = null): void {
    this.history.push(before);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.note = note;
    this.dirty = true;
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.restore(prev);
    this.note = { text: STR.editor.undone, kind: 'info' };
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(this.snapshot());
    this.restore(next);
    this.note = { text: STR.editor.redone, kind: 'info' };
  }

  // ------------------------------------------------------------- actions

  private setMode(m: EditorMode): void {
    this.mode = m;
    this.note = null;
  }

  private clear(): void {
    if (!this.dots.length && !this.failed) return;
    const before = this.snapshot();
    this.dots = [];
    this.closed = false;
    this.failed = null;
    this.name = STR.editor.customName;
    this.selected = -1;
    this.commit(before, { text: STR.editor.cleared, kind: 'info' });
  }

  private reverse(): void {
    if (this.dots.length < 2) return;
    const before = this.snapshot();
    this.dots = this.closed ? reverseDots(this.dots) : [...this.dots].reverse();
    this.selected = -1;
    this.commit(before, { text: STR.editor.reversed, kind: 'info' });
  }

  private loadSample(i: number): void {
    const t = getSampleTrack(i);
    this.sampleIndex = (i + 1) % SAMPLE_COUNT;
    const before = this.snapshot();
    this.dots = t.def.control.map((p) => ({ ...p }));
    this.closed = true;
    this.failed = null;
    this.name = t.def.name;
    this.selected = -1;
    this.commit(before, { text: fmt(STR.editor.sampleLoaded, { name: t.def.name }), kind: 'ok' });
  }

  private deleteDot(i: number): void {
    if (i < 0 || i >= this.dots.length) return;
    if (this.closed && this.dots.length <= 3) {
      this.note = { text: STR.editor.needThreeDots, kind: 'warn' };
      return;
    }
    const before = this.snapshot();
    this.dots.splice(i, 1);
    if (!this.dots.length) this.closed = false;
    this.selected = -1;
    this.hover = -1;
    this.commit(before, { text: STR.editor.dotDeleted, kind: 'info' });
  }

  private closeLoop(): void {
    if (this.closed || this.dots.length < 3) return;
    const before = this.snapshot();
    this.closed = true;
    this.commit(before);
  }

  private race(): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) return;
    const control = this.dots.map((p) => ({ ...p }));
    const same =
      this.base && this.base.control.length === control.length && this.base.control.every((p, i) => p.x === control[i].x && p.y === control[i].y);
    const def: TrackDef = {
      id: same && this.base ? this.base.id : contentId(control),
      name: this.name,
      control,
      builtIn: same ? this.base?.builtIn : undefined,
    };
    this.game.setTrack(buildTrack(def));
    this.game.go('race');
  }

  // ------------------------------------------------------------- derived

  private rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.built = null;
    this.openLine = [];
    this.dotSamples = [];
    this.crossings = 0;
    if (this.closed && this.dots.length >= 3) {
      this.built = trackFromControl({ id: 'editing', name: this.name, control: this.dots });
      const t = this.built.track;
      if (t) {
        this.crossings = findCrossings(t.center).length;
        // Where each dot sits on the centre line (for inserting dots on the road).
        const c = t.center;
        let from = 0;
        for (const d of this.dots) {
          let best = from;
          let bestD = Infinity;
          for (let k = 0; k < c.points.length; k++) {
            const i = (from + k) % c.points.length;
            const dd = dist2(d, c.points[i]);
            if (dd < bestD) {
              bestD = dd;
              best = i;
            }
            if (k > 200 && bestD < 1) break;
          }
          this.dotSamples.push(best);
          from = best;
        }
      }
    } else if (this.dots.length >= 2) {
      this.openLine = sampleOpenCatmullRom(this.dots);
    }
  }

  // ---------------------------------------------------------------- input

  private screenPos(e: PointerEvent): { x: number; y: number } {
    const r = this.game.surface.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private worldAt(sx: number, sy: number): Vec2 {
    const p = toWorld(this.view, sx, sy);
    return { x: clamp(p.x, -WORLD.width / 2, WORLD.width / 2), y: clamp(p.y, -WORLD.height / 2, WORLD.height / 2) };
  }

  private placeDot(w: Vec2): Vec2 {
    return snapDot(w, this.snapOn ? DOTS.snap : 0);
  }

  /** Index of the dot under a screen point, or -1. */
  private dotAt(sx: number, sy: number): number {
    let best = -1;
    let bestD = DOTS.grabPx * DOTS.grabPx;
    this.dots.forEach((d, i) => {
      const s = toScreen(this.view, d);
      const dd = (s.x - sx) ** 2 + (s.y - sy) ** 2;
      if (dd <= bestD) {
        bestD = dd;
        best = i;
      }
    });
    return best;
  }

  private onFlag(sx: number, sy: number): boolean {
    if (!this.closed || !this.dots.length) return false;
    const r = flagRect(this.view, this.dots[0]);
    return sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h;
  }

  /** If the screen point is on the road, the dot index to insert before, else -1. */
  private insertIndexAt(sx: number, sy: number): number {
    const t = this.built?.track;
    if (!t || this.dotSamples.length !== this.dots.length) return -1;
    const w = toWorld(this.view, sx, sy);
    const c = t.center;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < c.points.length; i++) {
      const d = dist2(w, c.points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const reach = TRACK.roadWidth / 2 + 6 / this.view.scale;
    if (bestD > reach * reach) return -1;
    // Insert after the last dot at or before sample `best`.
    const n = c.points.length;
    let after = this.dots.length - 1;
    let bestGap = Infinity;
    this.dotSamples.forEach((s, j) => {
      const gap = (best - s + n) % n;
      if (gap < bestGap) {
        bestGap = gap;
        after = j;
      }
    });
    return after + 1;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== -1 || !e.isPrimary) return;
    const { x, y } = this.screenPos(e);
    if (this.ui.optionsOpen) {
      this.ui.toggleOptions(false);
      return;
    }
    this.rebuild();
    const hit = this.dotAt(x, y);
    if (e.pointerType === 'mouse' && e.button === 2) {
      e.preventDefault();
      if (hit >= 0) this.deleteDot(hit);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    // Double-tap / double-click on a dot deletes it.
    const now = performance.now();
    if (hit >= 0 && this.lastTap.index === hit && now - this.lastTap.time < DOUBLE_TAP_MS) {
      this.lastTap.index = -1;
      this.deleteDot(hit);
      return;
    }

    this.game.surface.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.note = null;
    const w = this.worldAt(x, y);

    if (this.closed && this.dots.length) {
      if (this.onFlag(x, y)) {
        this.drag = { kind: 'flag', target: 0, before: this.snapshot() };
      } else if (hit >= 0) {
        this.drag = { kind: 'dot', index: hit, before: this.snapshot(), moved: false, sx: x, sy: y };
      } else if (this.mode === 'dots' && this.insertIndexAt(x, y) >= 0) {
        const at = this.insertIndexAt(x, y);
        const before = this.snapshot();
        this.dots.splice(at, 0, this.placeDot(w));
        this.dirty = true;
        this.drag = { kind: 'dot', index: at, before, moved: true, sx: x, sy: y };
      } else if (this.mode === 'draw') {
        this.startStroke(w);
      } else {
        this.selected = -1;
        this.releasePointer();
      }
      return;
    }

    if (this.dots.length && !this.closed && this.mode === 'dots') {
      if (hit === 0 && this.dots.length >= 3) {
        this.closeLoop();
        this.releasePointer();
      } else if (hit >= 0) {
        this.drag = { kind: 'dot', index: hit, before: this.snapshot(), moved: false, sx: x, sy: y };
      } else {
        const before = this.snapshot();
        this.dots.push(this.placeDot(w));
        this.dirty = true;
        this.drag = { kind: 'dot', index: this.dots.length - 1, before, moved: true, sx: x, sy: y };
      }
      return;
    }

    if (this.mode === 'draw') {
      this.startStroke(w);
    } else {
      // First dot of a new track.
      const before = this.snapshot();
      this.dots = [this.placeDot(w)];
      this.closed = false;
      this.failed = null;
      this.dirty = true;
      this.drag = { kind: 'dot', index: 0, before, moved: true, sx: x, sy: y };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y } = this.screenPos(e);
    if (e.pointerId !== this.pointerId) {
      // Hover feedback for mouse users.
      if (this.pointerId === -1 && e.pointerType === 'mouse') this.updateHover(x, y);
      return;
    }
    e.preventDefault();
    const d = this.drag;
    if (this.stroke) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) {
        const p = this.screenPos(ce);
        this.addPoint(this.worldAt(p.x, p.y));
      }
    } else if (d?.kind === 'dot') {
      if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 4) return;
      d.moved = true;
      this.dots[d.index] = this.placeDot(this.worldAt(x, y));
      this.selected = d.index;
      this.dirty = true;
    } else if (d?.kind === 'flag') {
      const w = this.worldAt(x, y);
      let best = 0;
      let bestD = Infinity;
      this.dots.forEach((p, i) => {
        const dd = dist2(p, w);
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      });
      d.target = best;
    }
  }

  private updateHover(x: number, y: number): void {
    this.hover = this.dotAt(x, y);
    this.hoverFlag = this.hover < 0 && this.onFlag(x, y);
    const onRoad = this.hover < 0 && !this.hoverFlag && this.mode === 'dots' && this.closed && this.insertIndexAt(x, y) >= 0;
    const cursor = this.hover >= 0 ? 'grab' : this.hoverFlag ? 'ew-resize' : onRoad ? 'copy' : '';
    this.game.surface.canvas.style.cursor = cursor;
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    const d = this.drag;
    this.drag = null;
    if (this.stroke) {
      this.finishStroke();
      return;
    }
    if (d?.kind === 'dot') {
      if (d.moved) this.commit(d.before);
      else {
        this.selected = d.index;
        this.lastTap = { index: d.index, time: performance.now() };
      }
    } else if (d?.kind === 'flag' && d.target > 0) {
      this.dots = rotateDots(this.dots, d.target);
      this.commit(d.before, { text: STR.editor.startMoved, kind: 'ok' });
    }
  }

  private releasePointer(): void {
    const c = this.game.surface.canvas;
    if (this.pointerId !== -1 && c.hasPointerCapture(this.pointerId)) c.releasePointerCapture(this.pointerId);
    this.pointerId = -1;
  }

  private cancelPointer(): void {
    this.releasePointer();
    this.drag = null;
    this.stroke = null;
  }

  // ------------------------------------------------------------ freehand

  private startStroke(w: Vec2): void {
    this.drag = { kind: 'stroke' };
    this.stroke = [w];
    this.strokeLen = 0;
    this.outOfInk = false;
    this.closing = false;
    this.selected = -1;
  }

  private addPoint(p: Vec2): void {
    const s = this.stroke;
    if (!s || this.outOfInk) return;
    const last = s[s.length - 1];
    const d = dist(last, p);
    if (d < INK.minStep) return;
    const remaining = INK.max - this.strokeLen;
    if (d >= remaining) {
      const t = remaining / d;
      s.push({ x: last.x + (p.x - last.x) * t, y: last.y + (p.y - last.y) * t });
      this.strokeLen = INK.max;
      this.outOfInk = true;
    } else {
      s.push(p);
      this.strokeLen += d;
    }
    this.closing = this.strokeLen > TRACK.minLength * 0.5 && dist(s[s.length - 1], s[0]) <= TRACK.closeRadius;
  }

  private finishStroke(): void {
    const stroke = this.stroke;
    const outOfInk = this.outOfInk;
    this.stroke = null;
    if (!stroke || stroke.length < 3) return; // a tap: keep what was there
    const before = this.snapshot();
    const res = dotsFromStroke(stroke, this.smoothing);
    if (res.ok) {
      this.dots = res.dots;
      this.closed = true;
      this.failed = null;
      this.name = STR.editor.customName;
      this.commit(before, res.autoClosed ? { text: STR.editor.autoClosed, kind: 'ok' } : null);
    } else {
      const issue = res.issue === 'not-closed' && outOfInk ? 'not-closed-ink' : res.issue;
      this.dots = [];
      this.closed = false;
      this.failed = { stroke, issue, at: res.at };
      this.commit(before);
    }
  }

  // ------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    // With Ctrl/Cmd only undo/redo are ours; everything else belongs to the browser.
    if (mod && e.code !== 'KeyZ' && e.code !== 'KeyY') return;
    const busy = !!this.stroke || !!this.drag;
    const actions: Record<string, () => void> = {
      KeyZ: () => (e.shiftKey ? this.redo() : this.undo()),
      KeyY: () => this.redo(),
      KeyC: () => this.clear(),
      KeyM: () => this.setMode(this.mode === 'draw' ? 'dots' : 'draw'),
      KeyO: () => this.ui.toggleOptions(),
      KeyR: () => this.reverse(),
      KeyG: () => (this.snapOn = !this.snapOn),
      KeyS: () => this.loadSample(this.sampleIndex),
      Delete: () => this.deleteDot(this.selected),
      Backspace: () => this.deleteDot(this.selected),
      Enter: () => (this.closed ? this.race() : this.closeLoop()),
      NumpadEnter: () => (this.closed ? this.race() : this.closeLoop()),
      Escape: () => {
        if (this.ui.optionsOpen) this.ui.toggleOptions(false);
        else if (this.selected >= 0) this.selected = -1;
        else this.game.go('race');
      },
    };
    const action = actions[e.code];
    if (!action) return;
    e.preventDefault();
    if (!e.repeat && !busy) action();
  }

  // ------------------------------------------------------------------- UI

  private refreshUI(): void {
    const ui = this.ui;
    const t = this.built?.track;
    ui.setState({
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      canRace: !!this.built?.ok && this.closed && !this.stroke,
      mode: this.mode,
      smoothing: this.smoothing,
      snap: this.snapOn,
      name: this.name,
    });

    if (this.stroke) {
      const left = inkLeftWhileDrawing(this.strokeLen);
      ui.setInk(left, this.outOfInk);
      ui.setProjectedMultiplier(inkMultiplier(left));
      if (this.closing) ui.setMessage(STR.editor.releaseToClose, 'ok');
      else if (this.outOfInk) ui.setMessage(STR.editor.outOfInk, 'warn');
      else ui.setMessage(STR.editor.drawing, 'info');
      return;
    }

    if (t) {
      ui.setInk(1 - t.center.length / INK.max, t.center.length > INK.max);
      ui.setMultiplier(t.ink);
    } else if (this.openLine.length) {
      const left = inkLeftWhileDrawing(polylineLength(this.openLine));
      ui.setInk(left, left <= 0);
      ui.setProjectedMultiplier(inkMultiplier(left));
    } else {
      ui.setInk(1);
      ui.setMultiplier(null);
    }

    if (this.note) ui.setMessage(this.note.text, this.note.kind);
    else if (this.failed) ui.setMessage(STR.editor.errors[this.failed.issue], 'error');
    else if (this.built && !this.built.ok) ui.setMessage(STR.editor.errors[this.built.issue], 'error');
    else if (this.built?.ok && t) {
      const crossings = this.crossings ? fmt(STR.editor.readyCrossings, { n: this.crossings }) : '';
      ui.setMessage(fmt(STR.editor.ready, { len: Math.round(t.center.length), corners: t.ink.tightCorners, crossings }), 'ok');
    } else if (this.dots.length) ui.setMessage(fmt(STR.editor.openPath, { n: this.dots.length }), 'info');
    else ui.setMessage(`${this.mode === 'draw' ? STR.editor.hintDraw : STR.editor.hintDots} ${STR.editor.hintInk}`, 'info');
  }

  // --------------------------------------------------------------- render

  frame(_dt: number, time: number): void {
    this.rebuild();
    this.refreshUI();
    const s = this.game.surface;
    const ctx = s.begin();
    const v = this.view;
    drawPaper(ctx, v, s.w, s.h);

    if (this.stroke) {
      if (this.strokeLen > TRACK.minLength * 0.3) drawCloseZone(ctx, v, this.stroke[0], this.closing, time);
      drawStroke(ctx, v, this.stroke);
      drawFlag(ctx, v, this.stroke[0]);
      return;
    }
    if (this.failed) {
      drawStroke(ctx, v, this.failed.stroke, true);
      drawFlag(ctx, v, this.failed.stroke[0]);
      if (this.failed.at) drawProblem(ctx, v, this.failed.at, time);
      return;
    }
    const dotR = this.mode === 'dots' ? 5 : 3.5;
    const t = this.built?.track;
    if (this.closed && t) {
      drawTrack(ctx, v, t);
      if (this.built && !this.built.ok && this.built.at) drawProblem(ctx, v, this.built.at, time);
      const d = this.drag;
      const startPreview = d?.kind === 'flag' ? d.target : -1;
      drawDots(ctx, v, this.dots, { r: dotR, hover: this.hover, selected: this.selected, startPreview });
      drawFlag(ctx, v, this.dots[startPreview >= 0 ? startPreview : 0]);
    } else if (this.dots.length) {
      if (this.openLine.length) drawChain(ctx, v, this.openLine, this.dots);
      const closeTarget = this.dots.length >= 3 && this.hover === 0 ? 0 : -1;
      drawDots(ctx, v, this.dots, { r: 5, hover: this.hover, selected: this.selected, closeTarget });
      drawFlag(ctx, v, this.dots[0]);
    }
  }
}
