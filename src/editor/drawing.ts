import { PAINTS } from '../config/paint.ts';
import { STR, fmt } from '../config/strings.ts';
import { DOTS, TRACK, WORLD, type SmoothingLevel, type TrackOptions } from '../config/track.ts';
import { clamp, dist, dist2, type Dot, type Vec2 } from '../core/math.ts';
import { rng } from '../core/random.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings, updateSettings } from '../core/settings.ts';
import { readDraft, writeDraft, type EditorDraft } from './draft.ts';
import { starterTrack, surpriseTrack, type StarterId } from './starters.ts';
import { sampleAt, sampleOpenCatmullRom } from '../track/spline.ts';
import { buildTrack, contentId, trackOptions, type TrackDef } from '../track/track.ts';
import { EditorUI, type CornerInfo, type DisplaySettings, type EditorMode, type MessageKind, type Terrain } from '../ui/editorUI.ts';
import { pitLayout } from '../track/pits.ts';
import { trackStats } from '../track/stats.ts';
import { transformDots, type Transform } from './transform.ts';
import { medalTimes } from '../race/medals.ts';
import { ShareDialog } from '../ui/shareDialog.ts';
import { PreviewCar } from './previewCar.ts';
import { liftCrossings, repairTrack, type Fix } from './repair.ts';
import { clampHeight, fitCrossings, pathPositions, rollingHeights, smoothHeights, softWeights, withHeights } from './heights.ts';
import { LazyPen } from './pen.ts';
import { builtInTracks, dotsFromStroke, getSampleTrack, SAMPLE_COUNT, trackFromCode, trackFromControl, type BuildResult } from './pipeline.ts';
import { drawProfile, inRect, profileDotAt, profileMetresPerPx, profileS, type Rect } from './profile.ts';
import {
  confettiBurst,
  drawCar,
  drawChain,
  drawConfetti,
  drawCornerLabels,
  drawCloseZone,
  drawDots,
  drawFlag,
  drawHeightTags,
  drawMarker,
  drawPaper,
  drawPenString,
  drawPlaced,
  drawProblem,
  drawReplaced,
  drawStartLine,
  drawStroke,
  drawTrack,
  flagRect,
  stepConfetti,
  toScreen,
  type Confetto,
} from './render2d.ts';
import { quantizeControl, relaxTightCorners, quantizeBank, reverseDots, rotateDots, snapDot } from './smoothing.ts';
import { generateTrack, type GenStyle } from './generate.ts';
import {
  axes,
  bumpFor,
  bumpNear,
  chicaneCorners,
  cleanExtras,
  paintCell,
  paintCorner,
  paintDab,
  paintGrid,
  PLACED_SPEC,
  placedClear,
  quantizeRot,
  roadDistance,
  withPaint,
  type Placed,
  type PlacedKind,
  type TrackExtras,
} from '../track/extras.ts';
import { nearestSample, planSection, spliceSection } from './splice.ts';
import { crossingKind, crossingsOf, type TrackIssue } from './validation.ts';
import { Viewport, ZOOM } from './viewport.ts';

type Failed = { stroke: Vec2[]; issue: TrackIssue; at?: Vec2 };

/** One undo step. */
interface Snapshot {
  dots: Dot[];
  closed: boolean;
  failed: Failed | null;
  name: string;
  options: TrackOptions;
  extras: TrackExtras;
}

/** A copy of extras that can be changed without touching the original. */
const copyExtras = (e: TrackExtras | undefined): TrackExtras => ({
  ...(e?.placed ? { placed: e.placed.map((p) => ({ ...p })) } : {}),
  ...(e?.paint ? { paint: [...e.paint] } : {}),
});

/** A hand tool on the map: painting run-off (paint value, brush radius in m) or placing scenery. */
type Tool = { kind: 'paint'; value: number } | { kind: 'place'; what: PlacedKind };

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
  | { kind: 'paint'; before: Snapshot; last: Vec2 }
  | { kind: 'pinch'; d: number; x: number; y: number };

const MAX_HISTORY = 80;

/** The player's car colour, as CSS. */
const paintColor = (): string => `#${(PAINTS.find((p) => p.id === settings().paint) ?? PAINTS[0]).hex.toString(16).padStart(6, '0')}`;

/** The player asked for less motion (no confetti). */
const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
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
 * paper can be zoomed and panned, and the track is validated live. Unfinished edits are backed up automatically.
 */
export class EditorScreen implements Screen {
  readonly layer = '2d';
  private readonly game: GameContext;
  private readonly ui: EditorUI;
  private readonly share = new ShareDialog();
  /** The little car lapping the track (the gold-medal lap). */
  private readonly car = new PreviewCar();
  private confetti: Confetto[] = [];
  /** Throw confetti once the next rebuild shows the track is good (a loop just closed, or fixed). */
  private celebrate = false;
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
  /** Placed scenery, bump kerbs and painted run-off. */
  private extras: TrackExtras = {};
  /** The hand tool in use on the map (null: the usual editing). */
  private tool: Tool | null = null;
  /** Run-off brush radius (m). */
  private brush = 6;
  /** Where the pointer is over the map while a tool is in use (for the brush outline). */
  private toolAt: Vec2 | null = null;
  /** The numbered corner last picked (‹ › or its row), or -1. */
  private pickedCorner = -1;
  private options: TrackOptions = trackOptions({});
  private base: TrackDef | null = null;
  private history: Snapshot[] = [];
  private future: Snapshot[] = [];
  private note: { text: string; kind: MessageKind } | null = null;

  // Derived, rebuilt when dirty.
  private dirty = true;
  private recoverableDraft: EditorDraft | null = null;
  private draftDue = 0;
  private draftSaved = false;
  private built: BuildResult | null = null;
  private crossings = 0;
  private bridges = 0;
  private openLine: Vec2[] = [];
  private dotSamples: number[] = [];
  /** Position of each dot along the track (m). */
  private dotPos: number[] = [];

  // Interaction.
  private panActive = false;
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
  private closing = false;
  private spaceDown = false;
  private pointerType = 'mouse';
  /** Set when leaving for the 3D view, so coming back keeps the edit. */
  private keepState = false;
  /** State before a slider drag started (undone as one step). */
  private liveBefore: Snapshot | null = null;
  /** The dots a shape slider (length, climb, corner smoothing) started from, with their length, height pattern (0..1) and climb. */
  private shapeBase: { dots: Dot[]; length: number; pattern: number[]; climb: number } | null = null;
  /** An image to trace over (it stays in this tab: never uploaded or saved), and how it's shown. */
  private trace: { img: HTMLImageElement; url: string; opacity: number; size: number } | null = null;
  /** The corner whose bank slider is being dragged, its dots, and its bank = a0 + slope × override. */
  private cornerEdit: { corner: number; dots: number[]; a0: number; slope: number } | null = null;
  /** Track position highlighted by the profile cursor (Height mode). */
  private cursor: number | null = null;

  constructor(game: GameContext) {
    this.game = game;
    this.ui = new EditorUI(
      {
        back: () => this.game.go('menu'),
        starter: (id) => this.loadStarter(id),
        surprise: () => this.loadLayout(surpriseTrack(Date.now() ^ Math.floor(Math.random() * 0x7fffffff))),
        restoreDraft: () => this.restoreDraft(),
        closeLoop: () => this.closeLoop(),
        locateIssue: () => this.locateIssue(),
        fixIt: () => this.fixIt(),
        soften: () => this.softenCorners(),
        selectPoint: (direction) => this.selectPoint(direction),
        nudgePoint: (dx, dy, dh) => this.nudgePoint(dx, dy, dh),
        deletePoint: () => this.deleteDot(this.selected),
        practice: () => this.race('practice'),
        undo: () => this.undo(),
        redo: () => this.redo(),
        clear: () => this.clear(),
        race: () => this.race(),
        setMode: (m) => this.setMode(m),
        pan: () => { if (!this.drag) this.panActive = !this.panActive; },
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
        rename: (n) => { this.name = n.trim() || STR.editor.customName; this.scheduleDraft(); },
        myTracks: () => this.game.go('library'),
        share: () => this.shareTrack(),
        hills: () => this.randomHills(),
        flatten: () => this.setAllHeights(() => 0, STR.editor.flattened),
        smoothHeights: () => this.smoothAllHeights(),
        zoom: (how) => this.zoom(how),
        preview: () => this.preview(),
        save: () => this.saveTrack(),
        terrain: (t) => this.terrainPreset(t),
        transform: (how) => this.transform(how),
        focusCorner: (i) => this.focusCorner(i),
        setDisplay: (d) => this.setDisplay(d),
        previewOptions: (o) => this.previewOptions(o),
        commitLive: () => this.commitLive(),
        cornerBank: (i, deg) => this.setCornerBank(i, deg),
        moveStart: (m) => this.moveStartBy(m),
        generate: (style) => this.generate(style),
        trackList: (group) => this.trackList(group),
        loadTrack: (group, id) => this.loadListed(group, id),
        loadCode: (text) => this.loadCode(text),
        traceImage: (file) => this.traceImage(file),
        traceLook: (look) => this.traceLook(look),
        setLength: (m) => this.setLength(m),
        setClimb: (m) => this.setClimb(m),
        setCornerSmoothing: (r) => this.setCornerSmoothing(r),
        bankAll: (deg) => this.bankAll(deg),
        placeTool: (what) => this.setTool(what ? { kind: 'place', what } : null),
        paintTool: (value) => this.setTool(value === null ? null : { kind: 'paint', value }),
        brushSize: (m) => { this.brush = m; },
        cornerRunoff: (which, value) => this.cornerRunoff(which === 'picked' ? this.pickedCorner : which, value),
        cornerBump: (on) => this.cornerBump(this.pickedCorner, on),
        chicaneBumps: () => this.chicaneBumps(),
        clearExtras: (what) => this.clearExtras(what),
        liftCrossings: () => this.liftCrossings(),
      },
      Array.from({ length: SAMPLE_COUNT }, (_, i) => getSampleTrack(i).def.name),
      settings().sidebarSection,
    );
  }

  enter(): void {
    if (this.keepState) {
      // Back from the 3D view: carry on exactly where we were.
      this.keepState = false;
    } else {
      // Open with the track you were racing, ready to tweak. Clear gives a blank page.
      const t = this.game.track;
      this.base = t.def;
      this.dots = t.def.control.map((p) => ({ ...p }));
      this.closed = true;
      this.failed = null;
      this.name = t.def.name;
      this.options = { ...t.options };
      this.extras = copyExtras(t.def.extras);
      this.tool = null;
      this.pickedCorner = -1;
      this.draftDue = 0;
      this.draftSaved = false;
      this.history = [];
      this.future = [];
      this.note = this.modeTip();
      this.selected = this.hover = -1;
      this.cursor = null;
      this.dirty = true;
      this.vp.reset();
    }
    this.recoverableDraft = readDraft();
    this.cancelPointer();
    this.ui.closeOverlay();
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
    window.addEventListener('pagehide', () => this.flushDraft(), opts);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flushDraft(); }, opts);
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    }, opts);
    window.addEventListener('blur', () => (this.spaceDown = false), opts);
    this.resize();
  }

  exit(): void {
    this.flushDraft();
    this.ui.closeHelp();
    updateSettings({ sidebarSection: this.ui.openSection });
    this.abort?.abort();
    this.abort = null;
    this.share.close();
    this.cancelPointer();
    this.car.set(null);
    this.confetti = [];
    this.ui.root.remove();
    this.game.surface.canvas.classList.remove('drawing');
    this.game.surface.canvas.style.cursor = '';
  }

  resize(): void {
    const s = this.game.surface;
    const heights = this.mode === 'height';
    this.ui.setLayout(s.w);
    const inset = this.ui.insets();
    const profH = heights ? clamp(Math.round(s.h * 0.2), 72, 150) : 0;
    const gap = profH ? 8 : 0;
    this.profile = heights ? { x: inset.left + 8, y: s.h - inset.bottom - profH - 2, w: s.w - inset.left - 16, h: profH } : null;
    // Leave room on the right for the zoom buttons.
    this.vp.setScreen(s.w, s.h, inset.top, inset.bottom + profH + gap, inset.left, 44);
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
      extras: copyExtras(this.extras),
    };
  }

  /** The id of the track as it is now (the same shape, options and extras always give the same id). */
  private id(): string {
    return contentId(this.dots, this.options, cleanExtras(this.extras));
  }

  private restore(s: Snapshot): void {
    this.dots = s.dots.map((p) => ({ ...p }));
    this.closed = s.closed;
    this.failed = s.failed;
    this.name = s.name;
    this.options = { ...s.options };
    this.extras = copyExtras(s.extras);
    this.selected = this.hover = -1;
    this.dirty = true;
    this.scheduleDraft();
  }

  /** Records `before` as an undo step (call after changing the state). */
  private commit(before: Snapshot, note: { text: string; kind: MessageKind } | null = null): void {
    this.history.push(before);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.future = [];
    this.note = note;
    this.dirty = true;
    this.scheduleDraft();
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

  private scheduleDraft(): void {
    this.draftDue = this.dots.length ? performance.now() + 700 : 0;
    this.draftSaved = false;
  }

  private flushDraft(): void {
    if (!this.draftDue || !this.dots.length) return;
    writeDraft({ dots: this.dots, closed: this.closed, name: this.name, options: this.options, extras: cleanExtras(this.extras) });
    this.draftDue = 0;
    this.draftSaved = true;
  }

  private restoreDraft(): void {
    const draft = this.recoverableDraft;
    if (!draft) return;
    const before = this.snapshot();
    this.restore({ ...draft, extras: draft.extras ?? {}, failed: null });
    this.base = null;
    this.commit(before, { text: STR.studio.draftRestored, kind: 'ok' });
    this.recoverableDraft = null;
    this.vp.reset();
    this.ui.closeOverlay();
  }

  private loadStarter(id: StarterId): void { this.loadLayout(starterTrack(id)); }

  private loadLayout(def: TrackDef): void {
    const before = this.snapshot();
    this.dots = def.control.map((p) => ({ ...p }));
    this.options = trackOptions(def);
    this.extras = copyExtras(def.extras);
    this.name = def.name;
    this.closed = true;
    this.failed = null;
    this.selected = this.hover = -1;
    this.pickedCorner = -1;
    this.base = null;
    this.setMode('dots');
    this.commit(before, { text: fmt(STR.studio.loaded, { name: def.name }), kind: 'ok' });
    this.vp.reset();
    this.ui.closeOverlay();
  }

  private locateIssue(): void {
    this.rebuild();
    const at = this.failed?.at ?? (this.built && !this.built.ok ? this.built.at : undefined);
    if (at) this.vp.centerOn(at, 3);
    this.ui.closeOverlay();
  }

  private softenCorners(): void {
    if (!this.closed || this.dots.length < 3) return;
    const before = this.snapshot();
    this.dots = relaxTightCorners(this.dots, 12);
    this.commit(before, { text: STR.studio.softened, kind: 'ok' });
  }

  private selectPoint(direction: number): void {
    if (!this.dots.length) return;
    this.setMode(this.mode === 'height' ? 'height' : 'dots');
    this.selected = this.selected < 0 ? (direction > 0 ? 0 : this.dots.length - 1) : (this.selected + direction + this.dots.length) % this.dots.length;
    this.note = null;
    this.vp.centerOn(this.dots[this.selected], this.vp.zoom);
  }

  private nudgePoint(dx: number, dy: number, dh = 0): void {
    if (this.selected < 0 || this.selected >= this.dots.length) return;
    const before = this.snapshot();
    const p = this.dots[this.selected];
    this.dots[this.selected] = { ...p,
      x: clamp(p.x + dx, -WORLD.width / 2, WORLD.width / 2),
      y: clamp(p.y + dy, -WORLD.height / 2, WORLD.height / 2),
      ...(dh ? { h: clampHeight((p.h ?? 0) + dh) } : {}),
    };
    this.commit(before);
  }

  private setMode(m: EditorMode): void {
    if (this.drag) return;
    const layout = (m === 'height') !== (this.mode === 'height');
    this.panActive = false;
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
    if ((Object.keys(next) as (keyof TrackOptions)[]).every((k) => next[k] === this.options[k])) return;
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
    this.flushDraft();
    const before = this.snapshot();
    this.dots = [];
    this.closed = false;
    this.failed = null;
    this.name = STR.editor.customName;
    this.extras = {};
    this.tool = null;
    this.selected = -1;
    this.commit(before, { text: STR.editor.cleared, kind: 'info' });
    this.setMode('draw');
    this.ui.closeOverlay();
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
    this.celebrate = true;
  }

  /** A line that didn't make a loop, as one: ends joined, and a scribble too small to drive grown to size. */
  private loopFromStroke(stroke: readonly Vec2[]): Dot[] | null {
    let pts = [...stroke, stroke[0]];
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
    if (len < TRACK.minLength * 0.6) {
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const f = (TRACK.minLength * 0.75) / Math.max(1, len);
      pts = pts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
    }
    const res = dotsFromStroke(pts, this.smoothing);
    return res.ok ? res.dots : null;
  }

  /** Whether "Fix it" has something to try. */
  private canFix(): boolean {
    if (this.stroke || this.drag) return false;
    if (this.failed) return this.failed.stroke.length >= 3;
    return this.closed && !!this.built && !this.built.ok;
  }

  /** "Fix it": mends the track (or the line that didn't close) as little as it can, as one undo step. */
  private fixIt(): void {
    this.rebuild();
    if (!this.canFix()) return;
    const fixes: Fix[] = [];
    let dots: Dot[] | null = this.dots;
    if (this.failed) {
      dots = this.loopFromStroke(this.failed.stroke);
      fixes.push('closed');
    }
    let options = this.options;
    if (dots && !trackFromControl({ id: 'fix', name: '', control: dots, options }).ok) {
      const r = repairTrack(dots, options);
      dots = r?.dots ?? null;
      if (r) {
        options = r.options;
        fixes.push(...r.fixes);
      }
    }
    if (!dots) {
      this.note = { text: STR.studio.cantFix, kind: 'warn' };
      return;
    }
    const before = this.snapshot();
    this.dots = dots;
    this.closed = true;
    this.failed = null;
    this.options = options;
    this.selected = this.hover = -1;
    const what = fixes.map((f) => STR.studio.fixes[f]);
    const list = what.length > 1 ? `${what.slice(0, -1).join(', ')}${STR.studio.and}${what[what.length - 1]}` : what[0];
    this.commit(before, { text: fmt(STR.studio.fixed, { what: list }), kind: 'ok' });
    this.celebrate = true;
  }

  /** The track definition as it is being edited. */
  private currentDef(id: string): TrackDef {
    const extras = cleanExtras(this.extras);
    return { id, name: this.name, control: this.dots.map((p) => ({ ...p })), options: { ...this.options }, ...(extras ? { extras } : {}) };
  }

  /** Opens the share dialog for the track as it is now (only when it's raceable). */
  private shareTrack(): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) return;
    this.ui.closeOverlay();
    this.share.open(this.currentDef(this.id()), this.game.ui);
  }

  /**
   * "Race it": opens the race setup for the track as it is now (Back returns
   * here with the edit kept). "Practice" drives it straight away.
   */
  private race(mode: 'setup' | 'practice' = 'setup'): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) return;
    const def = this.currentDef('');
    const b = this.base;
    const same = !!b && contentId(b.control, b.options, b.extras) === contentId(def.control, def.options, def.extras);
    def.id = same && b ? b.id : contentId(def.control, def.options, def.extras);
    if (same) {
      def.builtIn = b?.builtIn;
      def.place = b?.place;
    }
    this.game.setTrack(buildTrack(def));
    if (mode === 'practice') {
      this.game.drive('practice');
      return;
    }
    this.game.openSetup({
      back: () => {
        this.keepState = true;
        this.game.go('editor');
      },
    });
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
  private randomHills(peakRange?: [number, number]): void {
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
      let hs = rollingHeights(pos, L, rand, peakRange);
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

  /** Terrain presets from the sidebar: flat, or new random hills of a size. */
  private terrainPreset(t: Terrain): void {
    if (t === 'flat') this.setAllHeights(() => 0, STR.editor.flattened);
    else this.randomHills(t === 'rolling' ? [4, 10] : [14, 28]);
  }

  /** Resize, rotate or mirror the whole track (undoable). */
  private transform(how: Transform): void {
    if (this.dots.length < 2) return;
    const before = this.snapshot();
    this.dots = transformDots(this.dots, how);
    this.selected = -1;
    this.commit(before);
  }

  /** Zooms the map in on numbered corner `i`. */
  private focusCorner(i: number): void {
    const t = this.built?.track;
    const k = t?.kerbs[i];
    if (!t || !k) return;
    this.pickedCorner = i;
    this.vp.centerOn(t.center.points[k.apex], 3);
    this.ui.closeOverlay();
  }

  private setDisplay(d: Partial<DisplaySettings>): void {
    updateSettings(d);
    if (d.graphics) this.game.view3d?.setQuality(d.graphics);
  }

  /** Saves the track to My tracks without racing it. */
  private saveTrack(): void {
    this.rebuild();
    if (!this.built?.ok || !this.closed) {
      this.note = { text: STR.editor.needLoop, kind: 'warn' };
      return;
    }
    this.game.library.save(this.currentDef(this.id()));
    this.note = { text: STR.sidebar.saved, kind: 'ok' };
  }

  /** Shows the track being edited in 3D (orbit camera), keeping the edit for when we come back. */
  private preview(): void {
    this.rebuild();
    if (!this.closed || !this.built?.track) {
      this.note = { text: STR.editor.needLoop, kind: 'warn' };
      return;
    }
    if (!this.game.view3d) return;
    const track = buildTrack(this.currentDef(this.id()));
    this.game.preview = {
      track,
      race: () => {
        this.keepState = true;
        this.game.go('editor');
        this.race();
      },
      back: () => {
        this.keepState = true;
        this.game.go('editor');
      },
    };
    this.keepState = true;
    this.game.go('preview');
  }

  /** The numbered corners, for the sidebar list. */
  private cornerInfo(): CornerInfo[] {
    const t = this.built?.track;
    if (!t) return [];
    const c = t.center;
    const n = c.points.length;
    return t.kerbs.map((k) => {
      const custom = this.dotSamples.some((s, j) => this.dots[j]?.b !== undefined && (s - (k.start - 4) + n) % n <= k.count + 8);
      return {
        dir: k.sign > 0 ? 'R' : 'L',
        radius: 1 / Math.max(1e-6, Math.abs(c.curvature[k.apex])),
        bank: (Math.abs(c.bank[k.apex]) * 180) / Math.PI,
        custom,
      };
    });
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
      this.built = trackFromControl({ id: 'editing', name: this.name, control: this.dots, options: this.options, extras: this.extras });
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

  private placeDot(w: Vec2, h?: number, b?: number): Dot {
    const d: Dot = h ? { x: w.x, y: w.y, h } : { x: w.x, y: w.y };
    if (b !== undefined) d.b = b;
    return snapDot(d, this.snapOn ? DOTS.snap : 0);
  }

  /** How close to the road centre a point must be to count as "on the road" (m). */
  private roadReach(px = 8): number {
    return (this.built?.track?.center.width ?? TRACK.roadWidth) / 2 + px / this.view.scale;
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
    const grab = this.pointerType === 'touch' ? 22 : this.mode === 'draw' && this.closed ? 10 : DOTS.grabPx;
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

  /** True over the start flag, or the start/finish line itself on the road. */
  private onFlag(sx: number, sy: number): boolean {
    if (!this.closed || !this.dots.length) return false;
    const r = flagRect(this.view, this.dots[0]);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return true;
    const t = this.built?.track;
    if (!t) return false;
    const s = toScreen(this.view, t.center.points[0]);
    return Math.hypot(sx - s.x, sy - s.y) <= Math.max(9, (t.center.width / 2) * this.view.scale);
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
    if (this.ui.overlayOpen) {
      this.ui.closeOverlay();
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
    if ((e.button === 0 && this.panActive) || (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && this.spaceDown)))) {
      e.preventDefault();
      this.capture(e);
      this.drag = { kind: 'pan', x, y };
      this.game.surface.canvas.style.cursor = 'grabbing';
      return;
    }

    // Placing scenery or painting run-off.
    if (this.tool && this.closed && (e.pointerType !== 'mouse' || e.button === 0)) {
      e.preventDefault();
      const w = this.worldAt(x, y);
      if (this.tool.kind === 'place') {
        this.placeAt(w);
        return;
      }
      this.capture(e);
      this.drag = { kind: 'paint', before: this.snapshot(), last: w };
      this.paintStroke(w, w);
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
    if (this.tool) this.toolAt = this.worldAt(x, y);
    if (e.pointerId !== this.pointerId) {
      // Hover feedback for mouse users.
      if (this.pointerId === -1 && !this.drag && e.pointerType === 'mouse') this.updateHover(x, y);
      return;
    }
    if (d?.kind === 'paint') {
      e.preventDefault();
      const w = this.worldAt(x, y);
      this.paintStroke(d.last, w);
      d.last = w;
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
      if (d.kind === 'dot') this.moveDots(d, this.placeDot(this.worldAt(x, y), d.orig[d.index].h, d.orig[d.index].b), weights);
      else this.raiseDots(d, -(y - d.sy) * d.perPx, weights);
      this.selected = d.index;
      this.dirty = true;
    } else if (d?.kind === 'flag') {
      // The start line slides along the road to wherever the pointer is nearest.
      const t = this.built?.track;
      if (t) d.target = nearestSample(t.center, this.worldAt(x, y)).index;
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
      const r: Dot = h ? { x: p.x, y: p.y, h } : { x: p.x, y: p.y };
      if (p.b !== undefined) r.b = p.b;
      return r;
    });
  }

  private updateHover(x: number, y: number): void {
    const canvas = this.game.surface.canvas;
    if (this.tool) {
      canvas.style.cursor = this.tool.kind === 'place' && this.placedAt(this.worldAt(x, y)) >= 0 ? 'not-allowed' : 'crosshair';
      return;
    }
    if (this.spaceDown || this.panActive) {
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
    if (d?.kind === 'paint') {
      this.commit(d.before, { text: STR.editorScenery.painted, kind: 'ok' });
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
      this.moveStartTo(d.target, d.before);
    }
  }

  /**
   * Inserts a dot on the centre line at sample `i` (at the road's height there,
   * with the bank override of its neighbours if both have one) and returns its
   * index, or the index of a dot already within a few metres.
   */
  private dotAtSample(i: number): number {
    this.rebuild();
    const t = this.built?.track;
    if (!t || this.dotSamples.length !== this.dots.length) return -1;
    const c = t.center;
    const n = c.points.length;
    let near = -1;
    let nearD = Infinity;
    this.dotSamples.forEach((s, j) => {
      const d = Math.min(Math.abs(s - i), n - Math.abs(s - i));
      if (d < nearD) {
        nearD = d;
        near = j;
      }
    });
    if (near >= 0 && nearD * c.spacing <= 4) return near;
    // After the last dot at or before sample i.
    let after = this.dots.length - 1;
    let bestGap = Infinity;
    this.dotSamples.forEach((s, j) => {
      const gap = (i - s + n) % n;
      if (gap < bestGap) {
        bestGap = gap;
        after = j;
      }
    });
    const a = this.dots[after];
    const b = this.dots[(after + 1) % this.dots.length];
    const bank = a.b !== undefined && b.b !== undefined ? (a.b + b.b) / 2 : undefined;
    const h = c.height[i];
    this.dots.splice(after + 1, 0, snapDot(bank !== undefined ? { x: c.points[i].x, y: c.points[i].y, h, b: bank } : { x: c.points[i].x, y: c.points[i].y, h }));
    this.dirty = true;
    return after + 1;
  }

  /** Moves the start/finish line to centre-line sample `i` (adding a dot there if needed). */
  private moveStartTo(i: number, before: Snapshot = this.snapshot()): void {
    const k = this.dotAtSample(i);
    if (k <= 0) {
      if (k === 0) this.restore(before);
      return;
    }
    this.dots = rotateDots(this.dots, k);
    this.selected = -1;
    this.commit(before, { text: STR.editor.startMoved, kind: 'ok' });
  }

  /** Sidebar buttons: slides the start line `metres` along the road (negative = back). */
  private moveStartBy(metres: number): void {
    this.rebuild();
    const t = this.built?.track;
    if (!t || !this.closed) return;
    const n = t.center.points.length;
    const i = (((Math.round(metres / t.center.spacing)) % n) + n) % n;
    if (i) this.moveStartTo(i);
  }

  // -------------------------------------------------------- live sliders

  /** Changes options while a slider is being dragged (one undo step when it's let go). */
  private previewOptions(o: Partial<TrackOptions>): void {
    this.liveBefore ??= this.snapshot();
    this.options = { ...this.options, ...o };
    this.dirty = true;
  }

  /** Ends a slider drag: records the undo step. */
  private commitLive(): void {
    this.cornerEdit = null;
    this.shapeBase = null;
    if (!this.liveBefore) return;
    this.commit(this.liveBefore);
    this.liveBefore = null;
  }

  /**
   * Sets numbered corner `i` to bank `deg` degrees at its apex (null = back to
   * the track's banking level). The override lives on the corner's dots (one is
   * added at the apex if the corner has none). The apex angle is linear in the
   * override, so two quick probes give the exact value to store.
   */
  private setCornerBank(i: number, deg: number | null): void {
    this.rebuild();
    const t = this.built?.track;
    if (!t) return;
    if (!this.cornerEdit || this.cornerEdit.corner !== i) {
      const k = t.kerbs[i];
      if (!k) return;
      this.liveBefore ??= this.snapshot();
      const n = t.center.points.length;
      const inCorner = (s: number) => {
        const off = (s - (k.start - 4) + n) % n;
        return off <= k.count + 8;
      };
      let dots = this.dotSamples.map((s, j) => (inCorner(s) ? j : -1)).filter((j) => j >= 0);
      if (!dots.length) {
        dots = [this.dotAtSample(k.apex)];
        this.rebuild();
      }
      // Probe: apex bank with the override at 0 and at 30 degrees.
      const probe = (b: number) => {
        const ds = this.dots.map((d, j) => (dots.includes(j) ? { ...d, b } : d));
        const c = buildTrack({ id: 'probe', name: '', control: ds, options: this.options }).center;
        return (Math.abs(c.bank[k.apex]) * 180) / Math.PI;
      };
      const a0 = probe(0);
      const a30 = probe(30);
      this.cornerEdit = { corner: i, dots, a0, slope: (a30 - a0) / 30 };
    }
    const e = this.cornerEdit;
    const b = deg === null ? undefined : quantizeBank(e.slope > 1e-4 ? (deg - e.a0) / e.slope : deg);
    this.dots = this.dots.map((d, j) => {
      if (!e.dots.includes(j)) return d;
      const r = { ...d };
      if (b === undefined) delete r.b;
      else r.b = b;
      return r;
    });
    this.dirty = true;
  }

  // ---------------------------------------------------------- new tracks

  /** A made-up track in `style` (see editor/generate.ts). */
  private generate(style: GenStyle): void {
    const name = STR.editorPlus.genNames[style];
    const def = generateTrack(style, (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, name);
    if (!def) {
      this.note = { text: STR.editorPlus.genFailed, kind: 'warn' };
      return;
    }
    this.loadLayout(def);
  }

  /** The tracks in a list (your saved ones, the game's or the real circuits), for the picker. */
  private trackList(group: 'saved' | 'builtIn' | 'world'): { id: string; name: string; note: string }[] {
    if (group === 'saved') return this.game.library.list().map((e) => ({ id: e.def.id, name: e.def.name, note: '' }));
    return builtInTracks()
      .filter((b) => b.group === group)
      .map((b) => ({ id: b.def.id, name: b.def.name, note: b.def.place ?? '' }));
  }

  /** Loads a listed track to edit: a copy (editing a built-in makes a track of your own). */
  private loadListed(group: 'saved' | 'builtIn' | 'world', id: string): void {
    const def = group === 'saved' ? this.game.library.list().find((e) => e.def.id === id)?.def : builtInTracks().find((b) => b.def.id === id)?.def;
    if (!def) return;
    this.loadLayout({ ...def, id: 'editing', builtIn: false, control: def.control.map((p) => ({ ...p })), options: { ...def.options } });
  }

  /** Loads a pasted track code; returns the problem, or null when it loaded. */
  private loadCode(text: string): string | null {
    const res = trackFromCode(text);
    if (!res.ok) return res.error === 'format' ? STR.editorPlus.codeBad : STR.editorPlus.codeDamaged;
    const def = res.track.def;
    this.loadLayout({ ...def, id: 'editing', builtIn: false, control: def.control.map((p) => ({ ...p })), options: { ...res.track.options } });
    return null;
  }

  /** An image to trace over (null removes it). It's only read into this tab: never uploaded, saved or shared. */
  private traceImage(file: File | null): void {
    if (this.trace) URL.revokeObjectURL(this.trace.url);
    this.trace = null;
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      this.trace = { img, url, opacity: 0.45, size: 1 };
      this.note = { text: STR.editorPlus.traceLoaded, kind: 'ok' };
      if (this.mode !== 'draw') this.setMode('draw');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.note = { text: STR.editorPlus.traceBad, kind: 'warn' };
    };
    img.src = url;
  }

  private traceLook(look: { opacity?: number; size?: number }): void {
    if (this.trace) Object.assign(this.trace, look);
  }

  // ---------------------------------------------------------- shape sliders

  /** Starts (or continues) a shape slider's drag: the dots it works from. */
  private shapeEdit(): NonNullable<EditorScreen['shapeBase']> | null {
    if (this.shapeBase) return this.shapeBase;
    this.rebuild();
    if (!this.closed || this.dots.length < 3) return null;
    this.liveBefore ??= this.snapshot();
    const hs = this.dots.map((d) => d.h ?? 0);
    const lo = Math.min(...hs);
    const climb = Math.max(...hs) - lo;
    let pattern = hs.map((h) => (climb > 0 ? (h - lo) / climb : 0));
    if (climb < TRACK.heightStep) {
      // A flat track: the climb slider raises a fresh set of rolling hills.
      const pos = pathPositions([...this.dots, this.dots[0]]);
      const hills = rollingHeights(pos.slice(0, this.dots.length), pos[this.dots.length], rng((Math.random() * 2 ** 31) | 0), [10, 10]);
      const low = Math.min(...hills);
      const span = Math.max(1e-6, Math.max(...hills) - low);
      pattern = hills.map((h) => (h - low) / span);
    }
    this.shapeBase = { dots: this.dots.map((d) => ({ ...d })), length: this.trackLength(), pattern, climb };
    return this.shapeBase;
  }

  /** Track length slider: the whole track scaled about its middle to `metres` (as far as the drawing area allows). */
  private setLength(metres: number): void {
    const b = this.shapeEdit();
    if (!b || b.length < 1) return;
    const xs = b.dots.map((d) => d.x);
    const ys = b.dots.map((d) => d.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const w = Math.max(...xs) - Math.min(...xs);
    const hgt = Math.max(...ys) - Math.min(...ys);
    const s = Math.min(metres / b.length, (WORLD.width - 20) / Math.max(1, w), (WORLD.height - 20) / Math.max(1, hgt));
    this.dots = quantizeControl(b.dots.map((d) => ({ ...d, x: (d.x - cx) * s, y: (d.y - cy) * s })));
    this.dirty = true;
  }

  /** Terrain slider: the climb (lowest to highest point, m), the hills' shape kept (a flat track gets new ones). */
  private setClimb(metres: number): void {
    const b = this.shapeEdit();
    if (!b) return;
    const top = Math.min(TRACK.maxHeight, metres);
    this.dots = withHeights(b.dots, b.pattern.map((p) => Math.round((p * top) / TRACK.heightStep) * TRACK.heightStep));
    this.dirty = true;
  }

  /** Corner smoothing slider: corners opened up to at least `radius` m (0: as they were). */
  private setCornerSmoothing(radius: number): void {
    const b = this.shapeEdit();
    if (!b) return;
    this.dots = radius <= 0 ? b.dots.map((d) => ({ ...d })) : relaxTightCorners(b.dots, radius);
    this.dirty = true;
  }

  /** Banking, every corner: every dot's bank set to `deg` (as the banking level's angle; null: back to the level, 0: flat). */
  private bankAll(deg: number | null): void {
    if (!this.dots.length) return;
    this.liveBefore ??= this.snapshot();
    this.dots = this.dots.map((d) => {
      const r = { ...d };
      if (deg === null) delete r.b;
      else r.b = quantizeBank(deg);
      return r;
    });
    this.dirty = true;
  }

  // -------------------------------------------------- scenery, run-off, bumps

  /** Starts or stops a hand tool on the map (null: back to the usual editing). */
  private setTool(t: Tool | null): void {
    if (this.drag) return;
    this.tool = t;
    this.toolAt = null;
    if (t) this.panActive = false;
    this.note = t ? { text: t.kind === 'paint' ? STR.editorScenery.paintHint : fmt(STR.editorScenery.placeHint, { what: STR.editorScenery.kinds[t.what].toLowerCase() }), kind: 'info' } : null;
  }

  /** The placed thing under world point `w` (index), or -1. */
  private placedAt(w: Vec2): number {
    const list = this.extras.placed ?? [];
    const pad = 6 / this.view.scale;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      const s = PLACED_SPEC[p.kind];
      const { ax, ay, nx, ny } = axes(p);
      const u = (w.x - p.x) * ax + (w.y - p.y) * ay;
      const v = (w.x - p.x) * nx + (w.y - p.y) * ny;
      if (Math.abs(u) <= s.w / 2 + pad && Math.abs(v) <= s.d / 2 + pad) return i;
    }
    return -1;
  }

  /**
   * Place tool: taps beside the track put the chosen thing there, facing the
   * road (brake boards and bump kerbs run along it), moved out just far enough
   * to clear the road (or the barriers); a tap on one takes it away again.
   */
  private placeAt(w: Vec2): void {
    const tool = this.tool;
    this.rebuild();
    const t = this.built?.track;
    if (tool?.kind !== 'place' || !t || !this.closed) return;
    const list = this.extras.placed ?? [];
    const hit = this.placedAt(w);
    if (hit >= 0) {
      const before = this.snapshot();
      const gone = list[hit];
      this.extras = { ...this.extras, placed: list.filter((_, i) => i !== hit) };
      this.commit(before, { text: fmt(STR.editorScenery.removed, { what: STR.editorScenery.kinds[gone.kind] }), kind: 'info' });
      return;
    }
    const kind = tool.what;
    const near = roadDistance(t, w.x, w.y);
    const q = t.center.points[near.i];
    const tg = t.center.tangents[near.i];
    let ox = w.x - q.x;
    let oy = w.y - q.y;
    const len = Math.hypot(ox, oy);
    if (len < 1e-3) {
      ox = -tg.y;
      oy = tg.x;
    } else {
      ox /= len;
      oy /= len;
    }
    // Along the road, or facing it (its front towards the road).
    const along = kind === 'brakeboards' || kind === 'bump';
    const rot = quantizeRot(along ? Math.atan2(tg.y, tg.x) : Math.atan2(-oy, -ox) - Math.PI / 2);
    const q5 = TRACK.quantize;
    const at = (d: number): Placed => ({ kind, x: Math.round((q.x + ox * d) / q5) * q5, y: Math.round((q.y + oy * d) / q5) * q5, rot });
    let d = Math.max(near.d, kind === 'bump' ? t.center.width / 2 + 1 : 0);
    if (kind === 'bump') d = Math.min(d, t.center.wallOffset - 0.5);
    let p = at(d);
    for (let k = 0; k < 120 && !placedClear(t, p); k++) p = at((d += 0.5));
    if (!placedClear(t, p) || Math.abs(p.x) > WORLD.width / 2 + 40 || Math.abs(p.y) > WORLD.height / 2 + 40) {
      this.note = { text: STR.editorScenery.noRoom, kind: 'warn' };
      return;
    }
    const before = this.snapshot();
    this.extras = { ...this.extras, placed: [...list, p] };
    this.commit(before, { text: fmt(STR.editorScenery.placed, { what: STR.editorScenery.kinds[kind] }), kind: 'ok' });
  }

  /** Paint tool: a stroke of run-off from `a` to `b` (dabs every half brush). */
  private paintStroke(a: Vec2, b: Vec2): void {
    if (this.tool?.kind !== 'paint') return;
    const g = paintGrid(this.extras.paint).slice();
    const steps = Math.max(1, Math.ceil(dist(a, b) / Math.max(1, this.brush / 2)));
    for (let k = 0; k <= steps; k++) paintDab(g, a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, this.brush, this.tool.value);
    this.extras = withPaint(this.extras, g);
    this.dirty = true;
  }

  /** Run-off at numbered corner `which` (or every corner): paint value 0 = as the track, else grass, gravel, tarmac. */
  private cornerRunoff(which: number | 'all', value: number): void {
    this.rebuild();
    const t = this.built?.track;
    if (!t || !this.closed) return;
    const corners = which === 'all' ? t.kerbs.map((_, i) => i) : [which];
    if (!corners.length || (which !== 'all' && !t.kerbs[which])) return;
    const before = this.snapshot();
    const g = paintGrid(this.extras.paint).slice();
    for (const i of corners) paintCorner(g, t, i, value);
    this.extras = withPaint(this.extras, g);
    this.commit(before, { text: STR.editorScenery.runoffSet, kind: 'ok' });
  }

  /** What run-off numbered corner `i` has: its painted value at the outside of the apex (0: as the track). */
  private cornerRunoffValue(i: number): number {
    const t = this.built?.track;
    const k = t?.kerbs[i];
    if (!t || !k || !this.extras.paint?.length) return 0;
    const c = t.center;
    const side = k.sign > 0 ? 1 : -1;
    const l = { x: -c.tangents[k.apex].y, y: c.tangents[k.apex].x };
    const lat = (c.width / 2 + c.wallOffset) / 2;
    const cell = paintCell(c.points[k.apex].x + l.x * lat * side, c.points[k.apex].y + l.y * lat * side);
    return cell >= 0 ? paintGrid(this.extras.paint)[cell] : 0;
  }

  /** Bump kerb on the inside of numbered corner `i`: on or off. */
  private cornerBump(i: number, on: boolean): void {
    this.rebuild();
    const t = this.built?.track;
    if (!t) return;
    const spot = bumpFor(t, i);
    if (!spot) {
      this.note = { text: STR.editorScenery.bumpNoRoom, kind: 'warn' };
      return;
    }
    const list = this.extras.placed ?? [];
    const at = bumpNear(list, spot);
    if (on === at >= 0) return;
    const before = this.snapshot();
    this.extras = { ...this.extras, placed: on ? [...list, spot] : list.filter((_, k) => k !== at) };
    this.commit(before, { text: on ? STR.editorScenery.bumpOn : STR.editorScenery.bumpOff, kind: 'ok' });
  }

  /** Bump kerbs on the inside of every corner that's part of a chicane. */
  private chicaneBumps(): void {
    this.rebuild();
    const t = this.built?.track;
    if (!t) return;
    const list = [...(this.extras.placed ?? [])];
    let added = 0;
    for (const i of chicaneCorners(t)) {
      const spot = bumpFor(t, i);
      if (!spot || bumpNear(list, spot) >= 0) continue;
      list.push(spot);
      added++;
    }
    if (!added) {
      this.note = { text: STR.editorScenery.noChicanes, kind: 'info' };
      return;
    }
    const before = this.snapshot();
    this.extras = { ...this.extras, placed: list };
    this.commit(before, { text: fmt(STR.editorScenery.chicaneBumps, { n: added }), kind: 'ok' });
  }

  /** Every level crossing becomes a road over a road (bridges or tunnels, as the track's option says). */
  private liftCrossings(): void {
    if (!this.closed || this.dots.length < 3) return;
    const lifted = liftCrossings(this.dots, this.options);
    if (!lifted) {
      this.note = { text: STR.sidebar.noLevelCrossings, kind: 'info' };
      return;
    }
    const before = this.snapshot();
    this.dots = lifted;
    this.commit(before, { text: STR.sidebar.lifted, kind: 'ok' });
  }

  /** Takes away all bump kerbs, all placed scenery (not bumps), or all painted run-off. */
  private clearExtras(what: 'bumps' | 'placed' | 'paint'): void {
    const list = this.extras.placed ?? [];
    const keep = what === 'bumps' ? list.filter((p) => p.kind !== 'bump') : what === 'placed' ? list.filter((p) => p.kind === 'bump') : list;
    if (what === 'paint' ? !this.extras.paint?.length : keep.length === list.length) return;
    const before = this.snapshot();
    this.extras = what === 'paint' ? { ...this.extras, paint: undefined } : { ...this.extras, placed: keep };
    this.commit(before, { text: STR.editorScenery.cleared[what], kind: 'info' });
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
    if (d?.kind === 'paint') this.restore(d.before);
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
    this.closing = false;
    this.selected = -1;
  }

  private addPoint(p: Vec2): void {
    const s = this.stroke;
    if (!s) return;
    const last = s[s.length - 1];
    const d = dist(last, p);
    if (d < TRACK.strokeMinStep) return;
    s.push(p);
    this.strokeLen += d;
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
      this.celebrate = true;
    } else {
      this.dots = [];
      this.closed = false;
      this.failed = { stroke, issue: res.issue, at: res.at };
      this.commit(before);
    }
  }

  // ------------------------------------------------------------- keyboard

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || this.share.isOpen) return;
    if (e.target instanceof Element && e.target.closest('summary, select, [contenteditable="true"]')) return;
    if (e.altKey || (e.target instanceof Element && e.target.closest('dialog[open]'))) return;
    // Focused controls retain their native Enter/Space activation.
    if (e.target instanceof HTMLButtonElement && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
    const mod = e.ctrlKey || e.metaKey;
    // With Ctrl/Cmd only undo/redo are ours; everything else (browser zoom included) belongs to the browser.
    if (mod && e.code === 'KeyS') { e.preventDefault(); this.saveTrack(); return; }
    if (mod && e.code !== 'KeyZ' && e.code !== 'KeyY') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.spaceDown = true;
      return;
    }
    const busy = !!this.stroke || !!this.drag;
    if (!busy && this.selected >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      if (this.mode === 'height' && ['ArrowUp', 'ArrowDown'].includes(e.code)) this.nudgePoint(0, 0, (e.code === 'ArrowUp' ? 0.5 : -0.5) * step);
      else this.nudgePoint(e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0, e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0);
      return;
    }
    const nextMode: Record<EditorMode, EditorMode> = { draw: 'dots', dots: 'height', height: 'draw' };
    const actions: Record<string, () => void> = {
      KeyZ: () => (e.shiftKey ? this.redo() : this.undo()),
      KeyY: () => this.redo(),
      KeyC: () => this.clear(),
      KeyM: () => this.setMode(nextMode[this.mode]),
      KeyO: () => this.ui.toggleSidebar(),
      KeyV: () => this.preview(),
      KeyR: () => this.reverse(),
      KeyG: () => this.setSnap(!this.snapOn),
      KeyS: () => this.loadSample(this.sampleIndex),
      KeyH: () => this.randomHills(),
      KeyX: () => this.fixIt(),
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
        if (this.tool) {
          this.setTool(null);
          return;
        }
        if (this.ui.overlayOpen) this.ui.closeOverlay();
        else if (this.selected >= 0) this.selected = -1;
        else this.game.go('menu');
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
      panActive: this.panActive,
      empty: !this.dots.length && !this.failed,
      drawing: !!this.stroke,
      closed: this.closed,
      pointCount: this.dots.length,
      selected: this.selected,
      selectedHeight: this.dots[this.selected]?.h ?? 0,
      hasProblem: !!this.failed?.at || !!(this.built && !this.built.ok && this.built.at),
      canFix: this.canFix(),
      // As the race shows it (rounded up to the hundredth).
      lap: this.closed && this.built?.ok && this.car.lap !== null ? medalTimes(this.car.lap).gold : null,
      hasDraft: !!this.recoverableDraft,
      draftSaved: this.draftSaved,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      canRace: !!this.built?.ok && this.closed && !this.stroke,
      mode: this.mode,
      smoothing: this.smoothing,
      snap: this.snapOn,
      soft: this.soft,
      options: this.options,
      display: { graphics: settings().graphics, units: settings().units, minimap: settings().minimap, cornerLabels: settings().cornerLabels, editorCar: settings().editorCar },
      name: this.name,
      stats: this.closed && t ? trackStats(t) : null,
      corners: this.closed && t ? this.cornerInfo() : [],
      pitsNoRoom: !!t && this.closed && this.options.pits && !pitLayout(t),
      saved: this.closed && !!t && this.game.library.has(this.id()),
      climb: this.dots.length ? Math.max(...this.dots.map((d) => d.h ?? 0)) - Math.min(...this.dots.map((d) => d.h ?? 0)) : 0,
      bankAll: this.bankAllState(),
      tracing: !!this.trace,
      tool: this.tool ? (this.tool.kind === 'paint' ? { paint: this.tool.value } : { place: this.tool.what }) : null,
      brush: this.brush,
      picked: this.closed && t && this.pickedCorner >= 0 && this.pickedCorner < t.kerbs.length ? { n: this.pickedCorner, runoff: this.cornerRunoffValue(this.pickedCorner), bump: this.pickedBump(t) } : null,
      placedCount: (this.extras.placed ?? []).filter((p) => p.kind !== 'bump').length,
      bumpCount: (this.extras.placed ?? []).filter((p) => p.kind === 'bump').length,
      painted: !!this.extras.paint?.length,
    });

    if (this.stroke && !this.section) {
      if (this.closing) ui.setMessage(STR.editor.releaseToClose, 'ok');
      else ui.setMessage(STR.editor.drawing, 'info');
      return;
    }
    if (this.stroke) {
      const joins = this.sectionEnd() >= 0;
      ui.setMessage(joins ? STR.editor.redrawJoin : STR.editor.redrawing, joins ? 'ok' : 'info');
      return;
    }

    // A problem with the track beats a tip or an "Undone." note.
    const problem = !!this.failed || (!!this.built && !this.built.ok);
    if (this.note && !problem) ui.setMessage(this.note.text, this.note.kind);
    else if (this.failed) ui.setMessage(STR.editor.errors[this.failed.issue], 'error');
    else if (this.built && !this.built.ok) ui.setMessage(STR.editor.errors[this.built.issue], 'error');
    else if (this.built?.ok && t) {
      const crossings =
        (this.crossings ? fmt(STR.editor.readyCrossings, { n: this.crossings }) : '') +
        (this.bridges ? (this.bridges === 1 ? STR.editor.readyBridge : fmt(STR.editor.readyBridges, { n: this.bridges })) : '') +
        (t.center.eased > 0.25 ? STR.editor.readyEased : '');
      // The same numbers as the stats strip: km, and the numbered corners.
      ui.setMessage(fmt(STR.editor.ready, { len: (t.center.length / 1000).toFixed(2), corners: t.kerbs.length, crossings }), 'ok');
    } else if (this.dots.length) ui.setMessage(fmt(STR.editor.openPath, { n: this.dots.length }), 'info');
    else ui.setMessage(this.mode === 'draw' ? STR.editor.hintDraw : STR.editor.hintDots, 'info');
  }

  /** The brush outline (painting) or a crosshair ring (placing) under the pointer. */
  private drawToolCursor(ctx: CanvasRenderingContext2D, v: { ox: number; oy: number; scale: number }, w: Vec2): void {
    const x = v.ox + w.x * v.scale;
    const y = v.oy + w.y * v.scale;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#1b3a8a';
    ctx.beginPath();
    ctx.arc(x, y, this.tool?.kind === 'paint' ? Math.max(4, this.brush * v.scale) : 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** True if the picked corner has a bump kerb. */
  private pickedBump(t: NonNullable<BuildResult['track']>): boolean {
    const spot = bumpFor(t, this.pickedCorner);
    return !!spot && bumpNear(this.extras.placed ?? [], spot) >= 0;
  }

  /** Every dot's bank if they're all set the same (degrees), 'mixed', or null (all on the track's level). */
  private bankAllState(): number | 'mixed' | null {
    const bs = this.dots.map((d) => d.b);
    if (bs.every((b) => b === undefined)) return null;
    return bs.every((b) => b === bs[0]) ? (bs[0] as number) : 'mixed';
  }

  /** Typical distance between neighbouring dots on screen (px). */
  private dotSpacingPx(): number {
    const n = this.dots.length;
    if (n < 2) return Infinity;
    const gaps = this.dots.map((d, i) => dist(d, this.dots[(i + 1) % n])).sort((a, b) => a - b);
    return gaps[Math.floor(n / 2)] * this.view.scale;
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

  frame(dt: number, time: number): void {
    if (this.draftDue && performance.now() >= this.draftDue && !this.drag) this.flushDraft();
    this.rebuild();
    const good = this.closed && this.built?.ok ? this.built.track : null;
    this.car.set(settings().editorCar ? good : null);
    this.car.update(dt, !!this.drag || !!this.stroke);
    this.refreshUI();
    const s = this.game.surface;
    const ctx = s.begin();
    const v = this.view;
    drawPaper(ctx, v, s.w, s.h);
    if (this.trace) {
      // The image to trace, fitted to the drawing area (× its size), under everything else.
      const { img, opacity, size } = this.trace;
      const fitS = Math.min(WORLD.width / img.width, WORLD.height / img.height) * size;
      const w = img.width * fitS;
      const hh = img.height * fitS;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(img, v.ox - (w / 2) * v.scale, v.oy - (hh / 2) * v.scale, w * v.scale, hh * v.scale);
      ctx.restore();
    }
    if (this.celebrate) {
      this.celebrate = false;
      if (good && !reducedMotion()) {
        const p = toScreen(v, good.center.points[0]);
        this.confetti.push(...confettiBurst(p.x, p.y));
      }
    }
    this.drawScene(ctx, time);
    if (this.confetti.length) {
      this.confetti = stepConfetti(this.confetti, dt);
      drawConfetti(ctx, this.confetti);
    }
  }

  private drawScene(ctx: CanvasRenderingContext2D, time: number): void {
    const v = this.view;
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
    // Dots shrink when they'd crowd each other (zoomed out, or on a phone), so the road stays visible.
    const dotR = Math.min(this.mode === 'draw' ? 3.5 : 5, Math.max(2.5, this.dotSpacingPx() * 0.22));
    if (this.closed && t) {
      drawTrack(ctx, v, t, { heights, walls: this.options.walls });
      if (this.extras.placed?.length && !heights) drawPlaced(ctx, v, t, this.extras.placed);
      if (this.tool && this.toolAt) this.drawToolCursor(ctx, v, this.toolAt);
      if (settings().cornerLabels && !heights) drawCornerLabels(ctx, v, t);
      if (this.built && !this.built.ok && this.built.at) drawProblem(ctx, v, this.built.at, time);
      const d = this.drag;
      const startPreview = d?.kind === 'flag' ? d.target : -1;
      const pose = this.car.pose();
      if (pose && !heights) drawCar(ctx, v, pose.x, pose.y, pose.heading, paintColor(), pose.alpha);
      drawDots(ctx, v, this.dots, { r: dotR, hover: this.hover, selected: this.selected });
      if (startPreview > 0) {
        drawStartLine(ctx, v, t.center.points[startPreview], t.center.tangents[startPreview], t.center.width);
        drawMarker(ctx, v, t.center.points[startPreview]);
      }
      drawFlag(ctx, v, startPreview > 0 ? t.center.points[startPreview] : this.dots[0]);
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
