import { STR, fmt } from '../config/strings.ts';
import { DOTS, INK, TRACK, WORLD, type SmoothingLevel, type TrackOptions } from '../config/track.ts';
import { clamp, dist, dist2, polylineLength, type Dot, type Vec2 } from '../core/math.ts';
import { rng } from '../core/random.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { inkLeftWhileDrawing, inkMultiplier } from '../track/ink.ts';
import { sampleAt, sampleOpenCatmullRom } from '../track/spline.ts';
import { buildTrack, contentId, trackOptions, type TrackDef } from '../track/track.ts';
import { EditorUI, type EditorMode, type MessageKind } from '../ui/editorUI.ts';
import { ShareDialog } from '../ui/shareDialog.ts';
import { clampHeight, fitCrossings, pathPositions, rollingHeights, smoothHeights, softWeights, withHeights } from './heights.ts';
import { LazyPen } from './pen.ts';
import { dotsFromStroke, getSampleTrack, SAMPLE_COUNT, trackFromControl, type BuildResult } from './pipeline.ts';
import { drawProfile, inRect, profileDotAt, profileMetresPerPx, profileS, type Rect } from './profile.ts';
import {
  drawChain,
  drawCloseZone,
  drawDots,
  drawFlag,
  drawHeightTags,
  drawMarker,
  drawPaper,
  drawPenString,
  drawProblem,
  drawReplaced,
  drawStroke,
  drawTrack,
  flagRect,
  toScreen,
} from './render2d.ts';
import { reverseDots, rotateDots, snapDot } from './smoothing.ts';
import { nearestSample, planSection, spliceSection } from './splice.ts';
import { crossingKind, crossingsOf, type TrackIssue } from './validation.ts';
import { Viewport, ZOOM } from './viewport.ts';

type Failed = { stroke: Vec2[]; issue: TrackIssue | 'not-closed-ink'; at?: Vec2 };

/** One undo step. */
interface Snapshot {
  dots: Dot[];
  closed: boolean;
  failed: Failed | null;
  name: string;
  options: TrackOptions;
}

/** Moving one dot (and, with soft editing, its neighbours) on the map or in height. */
interface DotDrag {
  kind: 'dot' | 'height';
  index: number;
  before: Snapshot;
  moved: boolean;
  sx: number;
  sy: number;
  /** Dots as they were when the drag started. */
  orig: Dot[];
  /** Share of the move each dot takes (soft editing), or null for one dot only. */
  weights: Float32Array | null;
  /** Height drags: metres per pixel of vertical movement. */
  perPx: number;
}

type Drag =
  | { kind: 'stroke' }
  | DotDrag
  | { kind: 'flag'; target: number; before: Snapshot }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'pinch'; d: number; x: number; y: number };

const MAX_HISTORY = 80;
const DOUBLE_TAP_MS = 350;
/** Soft editing reach along the track (m). */
const SOFT_RADIUS = 50;
const SOFT_HEIGHT_RADIUS = 70;
/** Height change per pixel when dragging a dot on the map. */
const MAP_METRES_PER_PX = 0.1;
/** Pen string length (CSS px) for each smoothing level. */
const PEN_PX: Record<SmoothingLevel, number> = { sharp: 3, normal: 7, smooth: 12 };

/**
 * The track editor. A track is a closed loop of "dots" with a smooth spline
 * through them. Draw mode turns one freehand stroke into dots (or redraws part
 * of the track); Dots mode places them one by one; Height mode raises and
 * lowers them. Every dot can be dragged, the start flag can be moved, the
 * paper can be zoomed and panned, and the track is validated live. Every metre
 * spends ink.
 */
export class EditorScreen implements Screen {
  readonly layer = '2d';
  private readonly game: GameContext;
  private readonly ui: EditorUI;
  private readonly share = new ShareDialog();
  private abort: AbortController | null = null;
  private readonly vp = new Viewport();
  private profile: Rect | null = null;

  // Settings (kept between visits).
  private mode: EditorMode = settings().editorMode;
  private smoothing: SmoothingLevel = settings().smoothing;
  private snapOn = settings().snap;
  private soft = settings().softEdit;
  private sampleIndex = 0;

  // The track being edited.
  private dots: Dot[] = [];
  private closed = false;
  private failed: Failed | null = null;
  private name: string = STR.editor.customName;
  private options: TrackOptions = trackOptions({});
  private base: TrackDef | null = null;
  private history: Snapshot[] = [];
  private future: Snapshot[] = [];
  private note: { text: string; kind: MessageKind } | null = null;

  // Derived, rebuilt when dirty.
  private dirty = true;
  private built: BuildResult | null = null;
  private crossings = 0;
  private bridges = 0;
  private openLine: Vec2[] = [];
  private dotSamples: number[] = [];
  /** Position of each dot along the track (m). */
  private dotPos: number[] = [];

  // Interaction.
  private pointerId = -1;
  private readonly pointers = new Map<number, Vec2>();
  private drag: Drag | null = null;
  private hover = -1;
  private selected = -1;
  private hoverFlag = false;
  private lastTap = { index: -1, time: 0 };
  private stroke: Vec2[] | null = null;
  private readonly pen = new LazyPen(1);
  /** The current stroke started on the road: it redraws a section. */
  private section = false;
  private strokeLen = 0;
  private outOfInk = false;
  private closing = false;
  private spaceDown = false;
  private pointerType = 'mouse';
  /** Track position highlighted by the profile cursor (Height mode). */
  private cursor: number | null = null;

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
        setSmoothing: (s) => {
          this.smoothing = s;
          updateSettings({ smoothing: s });
        },
        setSnap: (on) => this.setSnap(on),
        setSoft: (on) => {
          this.soft = on;
          updateSettings({ softEdit: on });
        },
        setOptions: (o) => this.setOptions(o),
        reverse: () => this.reverse(),
        sample: (i) => this.loadSample(i),
        rename: (n) => (this.name = n.trim() || STR.editor.customName),
        myTracks: () => this.game.go('library'),
        share: () => this.shareTrack(),
        hills: () => this.randomHills(),
        flatten: () => this.setAllHeights(() => 0, STR.editor.flattened),
        smoothHeights: () => this.smoothAllHeights(),
        zoom: (how) => this.zoom(how),
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
    this.options = { ...t.options };
    this.history = [];
    this.future = [];
    this.note = this.modeTip();
    this.selected = this.hover = -1;
    this.cursor = null;
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
    c.addEventListener('pointerleave', () => {
      this.hover = -1;
      if (!this.drag) this.cursor = null;
    }, opts);
    c.addEventListener('wheel', (e) => this.onWheel(e), { signal: this.abort.signal, passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    window.addEventListener('keydown', (e) => this.onKey(e), opts);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    }, opts);
    window.addEventListener('blur', () => (this.spaceDown = false), opts);
    this.vp.reset();
    this.resize();
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.share.close();
    this.cancelPointer();
    this.ui.root.remove();
    this.game.surface.canvas.classList.remove('drawing');
    this.game.surface.canvas.style.cursor = '';
  }

  resize(): void {
    const s = this.game.surface;
    const heights = this.mode === 'height';
    this.ui.showTools(heights);
    const inset = this.ui.insets();
    const profH = heights ? clamp(Math.round(s.h * 0.2), 72, 150) : 0;
    const gap = profH ? 8 : 0;
    this.profile = heights ? { x: 8, y: s.h - inset.bottom - profH - 2, w: s.w - 16, h: profH } : null;
    this.vp.setScreen(s.w, s.h, inset.top, inset.bottom + profH + gap);
    this.ui.placeZoom(inset.top + 8, inset.bottom + profH + gap + 8);
  }

  private get view() {
    return this.vp.view;
  }

  // ------------------------------------------------------------- history

  private snapshot(): Snapshot {
    return {
      dots: this.dots.map((p) => ({ ...p })),
      closed: this.closed,
      failed: this.failed,
      name: this.name,
      options: { ...this.options },
    };
  }

  private restore(s: Snapshot): void {
    this.dots = s.dots.map((p) => ({ ...p }));
    this.closed = s.closed;
    this.failed = s.failed;
    this.name = s.name;
    this.options = { ...s.options };
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
    if (this.drag) return;
    const layout = (m === 'height') !== (this.mode === 'height');
    this.mode = m;
    this.note = this.modeTip();
    this.cursor = null;
    updateSettings({ editorMode: m });
    if (layout) this.resize();
  }

  /** A one-line tip shown when entering a mode with a finished track. */
  private modeTip(): { text: string; kind: MessageKind } | null {
    if (!this.closed || this.dots.length < 3) return null;
    if (this.mode === 'height') return { text: STR.editor.hintHeight, kind: 'info' };
    if (this.mode === 'draw') return { text: STR.editor.hintRedraw, kind: 'info' };
    return null;
  }

  private setSnap(on: boolean): void {
    this.snapOn = on;
    updateSettings({ snap: on });
  }

  private setOptions(o: Partial<TrackOptions>): void {
    const next = { ...this.options, ...o };
    if (next.banking === this.options.banking && next.walls === this.options.walls && next.theme === this.options.theme) return;
    const before = this.snapshot();
    this.options = next;
    this.commit(before);
  }

  private zoom(how: 'in' | 'out' | 'fit'): void {
    if (how === 'fit') this.vp.reset();
    else this.vp.zoomCentre(how === 'in' ? ZOOM.step : 1 / ZOOM.step);
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
    if (this.mode === 'height') this.setMode('draw');
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
    this.options = { ...t.options };
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

  /** The track definition as it is being edited. */
  private currentDef(id: string): TrackDef {
    return { id, name: this.name, control: this.dots.map((p) => ({ ...p })), options: { ...this.options } };
  }

  /** Opens the share dialog for the track as it is now (only when it's raceable). */
  private shareTrack(): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) return;
    this.ui.toggleOptions(false);
    this.share.open(this.currentDef(contentId(this.dots, this.options)), this.game.ui);
  }

  private race(): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) return;
    const def = this.currentDef('');
    const b = this.base;
    const same = !!b && contentId(b.control, b.options) === contentId(def.control, def.options);
    def.id = same && b ? b.id : contentId(def.control, def.options);
    if (same) def.builtIn = b?.builtIn;
    this.game.setTrack(buildTrack(def));
    this.game.go('race');
  }

  // -------------------------------------------------------------- heights

  /** Replaces every dot's height (undoable). */
  private setAllHeights(f: (i: number, h: number) => number, text: string): void {
    if (!this.dots.length) return;
    const before = this.snapshot();
    this.dots = withHeights(
      this.dots,
      this.dots.map((d, i) => f(i, d.h ?? 0)),
    );
    this.commit(before, { text, kind: 'info' });
  }

  private smoothAllHeights(): void {
    this.rebuild();
    const length = this.trackLength();
    const hs = smoothHeights(
      this.dots.map((d) => d.h ?? 0),
      this.dotPos,
      length,
      this.closed,
    );
    this.setAllHeights((i) => hs[i], STR.editor.smoothed);
  }

  /** Rolling hills that keep every crossing either level or a proper bridge. */
  private randomHills(): void {
    if (this.mode !== 'height') this.setMode('height');
    this.rebuild();
    const t = this.built?.track;
    if (!this.closed || !t) {
      this.note = { text: STR.editor.needLoop, kind: 'warn' };
      return;
    }
    const wasOk = !!this.built?.ok;
    const L = t.center.length;
    const pos = this.dotPos;
    const seed = (Math.random() * 2 ** 31) | 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      const rand = rng(seed + attempt * 7919);
      let hs = rollingHeights(pos, L, rand);
      for (let fix = 0; fix < 5; fix++) {
        const dots = withHeights(this.dots, hs);
        const res = trackFromControl({ id: 'hills', name: this.name, control: dots, options: this.options });
        if (res.ok || !wasOk) {
          const before = this.snapshot();
          this.dots = dots;
          this.commit(before, { text: STR.editor.hillsDone, kind: 'ok' });
          return;
        }
        if (res.issue !== 'crossing-height' && res.issue !== 'too-steep') break;
        if (!res.track) break;
        hs = fitCrossings(hs, pos, L, res.track.center.spacing, crossingsOf(res.track.center));
        if (res.issue === 'too-steep') hs = smoothHeights(hs, pos, L, true, 1);
      }
    }
    this.note = { text: STR.editor.hillsFailed, kind: 'warn' };
  }

  // ------------------------------------------------------------- derived

  private trackLength(): number {
    const t = this.built?.track;
    if (this.closed && t) return t.center.length;
    return this.dotPos.length ? this.dotPos[this.dotPos.length - 1] : 0;
  }

  private rebuild(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.built = null;
    this.openLine = [];
    this.dotSamples = [];
    this.dotPos = [];
    this.crossings = 0;
    this.bridges = 0;
    if (this.closed && this.dots.length >= 3) {
      this.built = trackFromControl({ id: 'editing', name: this.name, control: this.dots, options: this.options });
      const t = this.built.track;
      if (t) {
        for (const x of crossingsOf(t.center)) {
          if (crossingKind(x.dh) === 'bridge') this.bridges++;
          else this.crossings++;
        }
        // Where each dot sits on the centre line (for inserting dots and soft editing).
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
          this.dotPos.push(best * c.spacing);
          from = best;
        }
      }
    } else if (this.dots.length >= 2) {
      this.openLine = sampleOpenCatmullRom(this.dots);
      this.dotPos = pathPositions(this.dots);
    } else {
      this.dotPos = this.dots.map(() => 0);
    }
  }

  // ---------------------------------------------------------------- input

  private screenPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.game.surface.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private worldAt(sx: number, sy: number): Vec2 {
    const p = this.vp.toWorld(sx, sy);
    return { x: clamp(p.x, -WORLD.width / 2, WORLD.width / 2), y: clamp(p.y, -WORLD.height / 2, WORLD.height / 2) };
  }

  private placeDot(w: Vec2, h?: number): Dot {
    return snapDot(h ? { x: w.x, y: w.y, h } : w, this.snapOn ? DOTS.snap : 0);
  }

  /** How close to the road centre a point must be to count as "on the road" (m). */
  private roadReach(px = 8): number {
    return TRACK.roadWidth / 2 + px / this.view.scale;
  }

  /** Nearest centre-line sample if the screen point is on the road, else -1. */
  private roadSampleAt(sx: number, sy: number, px = 8): number {
    const t = this.built?.track;
    if (!t || !this.closed) return -1;
    const near = nearestSample(t.center, this.vp.toWorld(sx, sy));
    return near.d <= this.roadReach(px) ? near.index : -1;
  }

  /** Index of the dot under a screen point, or -1. */
  private dotAt(sx: number, sy: number): number {
    let best = -1;
    // In Draw mode dots are small and a press near one more often starts a line on the road.
    const grab = this.mode === 'draw' && this.closed ? 8 : DOTS.grabPx;
    let bestD = grab * grab;
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
    const best = this.roadSampleAt(sx, sy, 6);
    if (best < 0) return -1;
    // Insert after the last dot at or before sample `best`.
    const n = t.center.points.length;
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

  /** Inserts a dot on the road at the screen point (at the road's height there); returns its index. */
  private insertOnRoad(sx: number, sy: number): number {
    const at = this.insertIndexAt(sx, sy);
    const t = this.built?.track;
    if (at < 0 || !t) return -1;
    const w = this.worldAt(sx, sy);
    const h = t.center.height[nearestSample(t.center, w).index];
    this.dots.splice(at, 0, this.placeDot(w, h > 0 ? h : undefined));
    this.dirty = true;
    return at;
  }

  private startDotDrag(kind: 'dot' | 'height', index: number, before: Snapshot, x: number, y: number, moved: boolean, perPx = MAP_METRES_PER_PX): void {
    this.rebuild();
    const radius = kind === 'height' ? SOFT_HEIGHT_RADIUS : SOFT_RADIUS;
    const weights =
      this.soft && this.dotPos.length === this.dots.length ? softWeights(this.dotPos, index, radius, this.trackLength(), this.closed) : null;
    this.drag = { kind, index, before, moved, sx: x, sy: y, orig: this.dots.map((p) => ({ ...p })), weights, perPx };
    this.selected = index;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (this.drag?.kind === 'stroke') return;
    const { x, y } = this.screenPos(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (!e.ctrlKey && Math.abs(e.deltaX) > 0) {
      // Two-finger trackpad scroll: move around.
      this.vp.panBy(-e.deltaX * unit, -e.deltaY * unit);
      return;
    }
    this.vp.zoomAt(x, y, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)));
  }

  private onPointerDown(e: PointerEvent): void {
    const { x, y } = this.screenPos(e);
    this.pointers.set(e.pointerId, { x, y });
    this.pointerType = e.pointerType;
    if (this.ui.optionsOpen) {
      this.ui.toggleOptions(false);
      return;
    }
    // A second finger turns whatever the first one started into a pinch (zoom and pan).
    if (e.pointerType === 'touch' && this.pointers.size === 2) {
      this.abandonDrag();
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', d: Math.max(1, dist(a, b)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointerId !== -1 || this.drag || this.pointers.size > 1) return;

    // Pan: middle button, or Space held.
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown))) {
      e.preventDefault();
      this.capture(e);
      this.drag = { kind: 'pan', x, y };
      this.game.surface.canvas.style.cursor = 'grabbing';
      return;
    }

    this.rebuild();
    const prof = this.profile && this.closed && this.built?.track && inRect(this.profile, x, y) ? this.profile : null;
    const hit = prof ? profileDotAt(prof, this.dots, this.dotPos, this.trackLength(), x, y) : this.dotAt(x, y);
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

    this.capture(e);
    this.note = null;
    const w = this.worldAt(x, y);

    // The height profile strip.
    if (prof) {
      if (hit >= 0) this.startDotDrag('height', hit, this.snapshot(), x, y, false, profileMetresPerPx(prof));
      else {
        this.cursor = profileS(prof, x, this.trackLength());
        this.releasePointer();
      }
      return;
    }

    if (this.closed && this.dots.length) {
      const heights = this.mode === 'height';
      if (this.onFlag(x, y)) {
        this.drag = { kind: 'flag', target: 0, before: this.snapshot() };
      } else if (hit >= 0) {
        this.startDotDrag(heights ? 'height' : 'dot', hit, this.snapshot(), x, y, false);
      } else if ((this.mode === 'dots' || heights) && this.insertIndexAt(x, y) >= 0) {
        const before = this.snapshot();
        const at = this.insertOnRoad(x, y);
        this.startDotDrag(heights ? 'height' : 'dot', at, before, x, y, true);
      } else if (this.mode === 'draw') {
        this.startStroke(w, this.roadSampleAt(x, y) >= 0);
      } else {
        this.selected = -1;
        this.releasePointer();
      }
      return;
    }

    if (this.dots.length && !this.closed && this.mode !== 'draw') {
      if (hit === 0 && this.dots.length >= 3) {
        this.closeLoop();
        this.releasePointer();
      } else if (hit >= 0) {
        this.startDotDrag('dot', hit, this.snapshot(), x, y, false);
      } else {
        const before = this.snapshot();
        this.dots.push(this.placeDot(w));
        this.dirty = true;
        this.startDotDrag('dot', this.dots.length - 1, before, x, y, true);
      }
      return;
    }

    if (this.mode === 'draw') {
      this.startStroke(w, false);
    } else {
      // First dot of a new track.
      const before = this.snapshot();
      this.dots = [this.placeDot(w)];
      this.closed = false;
      this.failed = null;
      this.dirty = true;
      this.startDotDrag('dot', 0, before, x, y, true);
    }
  }

  private capture(e: PointerEvent): void {
    this.game.surface.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
  }

  private onPointerMove(e: PointerEvent): void {
    const { x, y } = this.screenPos(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    const d = this.drag;
    if (d?.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dd = Math.max(1, dist(a, b));
      this.vp.panBy(mx - d.x, my - d.y);
      this.vp.zoomAt(mx, my, dd / d.d);
      Object.assign(d, { d: dd, x: mx, y: my });
      return;
    }
    if (e.pointerId !== this.pointerId) {
      // Hover feedback for mouse users.
      if (this.pointerId === -1 && !this.drag && e.pointerType === 'mouse') this.updateHover(x, y);
      return;
    }
    e.preventDefault();
    if (d?.kind === 'pan') {
      this.vp.panBy(x - d.x, y - d.y);
      d.x = x;
      d.y = y;
    } else if (this.stroke) {
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ce of events.length ? events : [e]) {
        const p = this.screenPos(ce);
        const tip = this.pen.move(this.worldAt(p.x, p.y));
        if (tip) this.addPoint(tip);
      }
    } else if (d?.kind === 'dot' || d?.kind === 'height') {
      if (!d.moved && Math.hypot(x - d.sx, y - d.sy) < 4) return;
      d.moved = true;
      const weights = e.shiftKey ? null : d.weights;
      if (d.kind === 'dot') this.moveDots(d, this.placeDot(this.worldAt(x, y), d.orig[d.index].h), weights);
      else this.raiseDots(d, -(y - d.sy) * d.perPx, weights);
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

  /** Moves the dragged dot to `to`; with soft editing its neighbours follow part of the way. */
  private moveDots(d: DotDrag, to: Dot, weights: Float32Array | null): void {
    const o = d.orig[d.index];
    const dx = to.x - o.x;
    const dy = to.y - o.y;
    this.dots = d.orig.map((p, j) => {
      if (j === d.index) return to;
      const wgt = weights ? weights[j] : 0;
      return wgt > 0.001 ? snapDot({ x: p.x + dx * wgt, y: p.y + dy * wgt, h: p.h }) : { ...p };
    });
  }

  /** Raises the dragged dot by `dh` metres; with soft editing its neighbours rise as a smooth hill. */
  private raiseDots(d: DotDrag, dh: number, weights: Float32Array | null): void {
    this.dots = d.orig.map((p, j) => {
      const wgt = j === d.index ? 1 : weights ? weights[j] : 0;
      if (wgt <= 0.001) return { ...p };
      const h = clampHeight((p.h ?? 0) + dh * wgt);
      return h ? { x: p.x, y: p.y, h } : { x: p.x, y: p.y };
    });
  }

  private updateHover(x: number, y: number): void {
    const canvas = this.game.surface.canvas;
    if (this.spaceDown) {
      canvas.style.cursor = 'grab';
      return;
    }
    const prof = this.profile && this.closed && this.built?.track && inRect(this.profile, x, y) ? this.profile : null;
    if (prof) {
      this.hover = profileDotAt(prof, this.dots, this.dotPos, this.trackLength(), x, y);
      this.hoverFlag = false;
      this.cursor = profileS(prof, x, this.trackLength());
      canvas.style.cursor = this.hover >= 0 ? 'ns-resize' : '';
      return;
    }
    this.hover = this.dotAt(x, y);
    this.hoverFlag = this.hover < 0 && this.onFlag(x, y);
    const road = this.hover < 0 && !this.hoverFlag ? this.roadSampleAt(x, y) : -1;
    const t = this.built?.track;
    this.cursor = this.mode === 'height' && t ? (road >= 0 ? road * t.center.spacing : this.hover >= 0 ? (this.dotPos[this.hover] ?? null) : null) : null;
    const heights = this.mode === 'height';
    const cursor =
      this.hover >= 0
        ? heights
          ? 'ns-resize'
          : 'grab'
        : this.hoverFlag
          ? 'ew-resize'
          : road >= 0 && this.closed
            ? this.mode === 'draw'
              ? 'crosshair'
              : 'copy'
            : '';
    canvas.style.cursor = cursor;
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d?.kind === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.drag = null;
    if (d?.kind === 'pan') {
      this.game.surface.canvas.style.cursor = '';
      return;
    }
    if (this.stroke) {
      this.finishStroke();
      return;
    }
    if (d?.kind === 'dot' || d?.kind === 'height') {
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

  /** Drops whatever the pointer was doing without recording it (a second finger arrived). */
  private abandonDrag(): void {
    const d = this.drag;
    if ((d?.kind === 'dot' || d?.kind === 'height') && d.moved) this.restore(d.before);
    if (d?.kind === 'pan') this.game.surface.canvas.style.cursor = '';
    this.stroke = null;
    this.pen.finish();
    this.releasePointer();
    this.drag = null;
  }

  private cancelPointer(): void {
    this.releasePointer();
    this.pointers.clear();
    this.drag = null;
    this.stroke = null;
    this.pen.finish();
  }

  // ------------------------------------------------------------ freehand

  private startStroke(w: Vec2, section: boolean): void {
    this.drag = { kind: 'stroke' };
    // Fingers wobble more than a mouse: a slightly longer string for touch.
    const px = PEN_PX[this.smoothing] + (this.pointerType === 'touch' ? 3 : 0);
    this.stroke = [this.pen.start(w, px / this.view.scale)];
    this.section = section;
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
    this.closing = !this.section && this.strokeLen > TRACK.minLength * 0.5 && dist(s[s.length - 1], s[0]) <= TRACK.closeRadius;
  }

  /** Where a section redraw would join the road if the pen lifted now, or -1. */
  private sectionEnd(): number {
    const t = this.built?.track;
    const s = this.stroke;
    if (!t || !s || s.length < 2 || this.strokeLen < 15) return -1;
    const near = nearestSample(t.center, this.pen.pointer ?? s[s.length - 1]);
    return near.d <= this.roadReach() ? near.index : -1;
  }

  private finishStroke(): void {
    const tail = this.pen.finish();
    if (tail) this.addPoint(tail);
    const stroke = this.stroke;
    const outOfInk = this.outOfInk;
    this.stroke = null;
    if (!stroke || stroke.length < 3) return; // a tap: keep what was there
    const before = this.snapshot();

    if (this.section) {
      const t = this.built?.track;
      const end = stroke[stroke.length - 1];
      if (t && nearestSample(t.center, end).d <= this.roadReach()) {
        const res = spliceSection(t, this.dots, this.dotSamples, stroke, this.smoothing);
        if (res.ok) {
          this.dots = res.dots;
          this.commit(before, { text: STR.editor.redrawn, kind: 'ok' });
          return;
        }
        if (!res.whole) return;
        // It went all the way round: treat it as a whole new track below.
      } else if (dist(end, stroke[0]) > TRACK.closeRadius || this.strokeLen < TRACK.minLength * 0.5) {
        this.note = { text: STR.editor.redrawNeedsEnd, kind: 'warn' };
        return;
      }
    }

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
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || this.share.isOpen) return;
    if (e.altKey) return;
    const mod = e.ctrlKey || e.metaKey;
    // With Ctrl/Cmd only undo/redo are ours; everything else (browser zoom included) belongs to the browser.
    if (mod && e.code !== 'KeyZ' && e.code !== 'KeyY') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceDown = true;
      return;
    }
    const busy = !!this.stroke || !!this.drag;
    const nextMode: Record<EditorMode, EditorMode> = { draw: 'dots', dots: 'height', height: 'draw' };
    const actions: Record<string, () => void> = {
      KeyZ: () => (e.shiftKey ? this.redo() : this.undo()),
      KeyY: () => this.redo(),
      KeyC: () => this.clear(),
      KeyM: () => this.setMode(nextMode[this.mode]),
      KeyO: () => this.ui.toggleOptions(),
      KeyR: () => this.reverse(),
      KeyG: () => this.setSnap(!this.snapOn),
      KeyS: () => this.loadSample(this.sampleIndex),
      KeyH: () => this.randomHills(),
      KeyF: () => this.zoom('fit'),
      Equal: () => this.zoom('in'),
      NumpadAdd: () => this.zoom('in'),
      Minus: () => this.zoom('out'),
      NumpadSubtract: () => this.zoom('out'),
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
      soft: this.soft,
      options: this.options,
      name: this.name,
    });

    if (this.stroke && !this.section) {
      const left = inkLeftWhileDrawing(this.strokeLen);
      ui.setInk(left, this.outOfInk);
      ui.setProjectedMultiplier(inkMultiplier(left));
      if (this.closing) ui.setMessage(STR.editor.releaseToClose, 'ok');
      else if (this.outOfInk) ui.setMessage(STR.editor.outOfInk, 'warn');
      else ui.setMessage(STR.editor.drawing, 'info');
      return;
    }
    if (this.stroke) {
      const joins = this.sectionEnd() >= 0;
      ui.setMessage(joins ? STR.editor.redrawJoin : STR.editor.redrawing, joins ? 'ok' : 'info');
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

    // A problem with the track beats a tip or an "Undone." note.
    const problem = !!this.failed || (!!this.built && !this.built.ok);
    if (this.note && (this.note.kind !== 'info' || !problem)) ui.setMessage(this.note.text, this.note.kind);
    else if (this.failed) ui.setMessage(STR.editor.errors[this.failed.issue], 'error');
    else if (this.built && !this.built.ok) ui.setMessage(STR.editor.errors[this.built.issue], 'error');
    else if (this.built?.ok && t) {
      const crossings =
        (this.crossings ? fmt(STR.editor.readyCrossings, { n: this.crossings }) : '') +
        (this.bridges ? (this.bridges === 1 ? STR.editor.readyBridge : fmt(STR.editor.readyBridges, { n: this.bridges })) : '') +
        (t.center.eased > 0.25 ? STR.editor.readyEased : '');
      ui.setMessage(fmt(STR.editor.ready, { len: Math.round(t.center.length), corners: t.ink.tightCorners, crossings }), 'ok');
    } else if (this.dots.length) ui.setMessage(fmt(STR.editor.openPath, { n: this.dots.length }), 'info');
    else ui.setMessage(`${this.mode === 'draw' ? STR.editor.hintDraw : STR.editor.hintDots} ${STR.editor.hintInk}`, 'info');
  }

  /** Dots worth a height tag: the one being worked on, and the tops of hills. */
  private taggedDots(): number[] {
    const out = new Set<number>();
    for (const i of [this.hover, this.selected]) if (i >= 0) out.add(i);
    const n = this.dots.length;
    if (this.closed && n >= 3) {
      for (let i = 0; i < n && out.size < 14; i++) {
        const h = this.dots[i].h ?? 0;
        const a = this.dots[(i - 1 + n) % n].h ?? 0;
        const b = this.dots[(i + 1) % n].h ?? 0;
        if (h >= 2 && h > a && h >= b) out.add(i);
      }
    }
    return [...out];
  }

  // --------------------------------------------------------------- render

  frame(_dt: number, time: number): void {
    this.rebuild();
    this.refreshUI();
    const s = this.game.surface;
    const ctx = s.begin();
    const v = this.view;
    drawPaper(ctx, v, s.w, s.h);
    const t = this.built?.track;

    if (this.stroke) {
      if (this.section && t) {
        drawTrack(ctx, v, t, { walls: this.options.walls });
        const end = this.sectionEnd();
        if (end >= 0) {
          const plan = planSection(t.center, [...this.stroke, this.pen.pointer ?? this.stroke[this.stroke.length - 1]]);
          if (plan) drawReplaced(ctx, v, t, plan.from, plan.to);
          drawMarker(ctx, v, t.center.points[end]);
        }
      } else if (this.strokeLen > TRACK.minLength * 0.3) drawCloseZone(ctx, v, this.stroke[0], this.closing, time);
      drawStroke(ctx, v, this.stroke);
      if (this.pen.tip && this.pen.pointer) drawPenString(ctx, v, this.pen.tip, this.pen.pointer);
      if (!this.section) drawFlag(ctx, v, this.stroke[0]);
      return;
    }
    if (this.failed) {
      drawStroke(ctx, v, this.failed.stroke, true);
      drawFlag(ctx, v, this.failed.stroke[0]);
      if (this.failed.at) drawProblem(ctx, v, this.failed.at, time);
      return;
    }
    const heights = this.mode === 'height';
    const dotR = this.mode === 'draw' ? 3.5 : 5;
    if (this.closed && t) {
      drawTrack(ctx, v, t, { heights, walls: this.options.walls });
      if (this.built && !this.built.ok && this.built.at) drawProblem(ctx, v, this.built.at, time);
      const d = this.drag;
      const startPreview = d?.kind === 'flag' ? d.target : -1;
      drawDots(ctx, v, this.dots, { r: dotR, hover: this.hover, selected: this.selected, startPreview });
      drawFlag(ctx, v, this.dots[startPreview >= 0 ? startPreview : 0]);
      if (heights) {
        if (this.cursor !== null) drawMarker(ctx, v, sampleAt(t.center, this.cursor).p);
        drawHeightTags(ctx, v, this.dots, this.taggedDots());
        if (this.profile) {
          drawProfile(ctx, this.profile, t, { dots: this.dots, pos: this.dotPos, hover: this.hover, selected: this.selected, cursor: this.cursor });
        }
      }
    } else if (this.dots.length) {
      if (this.openLine.length) drawChain(ctx, v, this.openLine, this.dots);
      const closeTarget = this.dots.length >= 3 && this.hover === 0 ? 0 : -1;
      drawDots(ctx, v, this.dots, { r: 5, hover: this.hover, selected: this.selected, closeTarget });
      drawFlag(ctx, v, this.dots[0]);
    }
  }
}
