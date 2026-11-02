import { STR, fmt } from '../config/strings.ts';
import { INK, TRACK, WORLD } from '../config/track.ts';
import { clamp, dist, type Vec2 } from '../core/math.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { inkLeftWhileDrawing, inkMultiplier } from '../track/ink.ts';
import type { Track } from '../track/track.ts';
import { EditorUI, type MessageKind } from '../ui/editorUI.ts';
import { SAMPLE_COUNT, getSampleTrack, trackFromStroke } from './pipeline.ts';
import {
  drawCloseZone,
  drawFlag,
  drawPaper,
  drawProblem,
  drawStroke,
  drawTrack,
  fitView,
  toWorld,
  type View,
} from './render2d.ts';
import type { TrackIssue } from './validation.ts';

/** One entry of the undo history. */
interface EditorState {
  track: Track | null;
  failed: { stroke: Vec2[]; issue: TrackIssue | 'not-closed-ink'; at?: Vec2 } | null;
}

const EMPTY: EditorState = { track: null, failed: null };
const MAX_HISTORY = 50;

/**
 * The track editor: the player draws one continuous stroke, which is smoothed
 * into a closed loop and validated on release. Every stroke spends ink.
 */
export class EditorScreen implements Screen {
  private readonly game: GameContext;
  private readonly ui: EditorUI;
  private abort: AbortController | null = null;
  private view: View = { scale: 1, ox: 0, oy: 0 };

  private history: EditorState[] = [];
  private state: EditorState = EMPTY;
  private note: { text: string; kind: MessageKind } | null = null;
  private sampleIndex = 0;

  // The stroke being drawn right now.
  private stroke: Vec2[] | null = null;
  private strokeLen = 0;
  private outOfInk = false;
  private closing = false;
  private pointerId = -1;

  constructor(game: GameContext) {
    this.game = game;
    this.ui = new EditorUI({
      back: () => this.game.go('race'),
      undo: () => this.undo(),
      clear: () => this.clear(),
      sample: () => this.loadSample(),
      race: () => this.race(),
    });
  }

  enter(): void {
    // Start on a blank page; Undo brings back the track you came from.
    this.history = [{ track: this.game.track, failed: null }];
    this.state = EMPTY;
    this.note = null;
    this.cancelStroke();
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
    window.addEventListener('keydown', (e) => this.onKey(e), opts);
    this.resize();
    this.refreshUI();
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.cancelStroke();
    this.ui.root.remove();
    this.game.surface.canvas.classList.remove('drawing');
  }

  resize(): void {
    const s = this.game.surface;
    const inset = this.ui.insets();
    this.view = fitView(s.w, s.h, inset.top, inset.bottom);
  }

  // ---------------------------------------------------------------- input

  private worldFromEvent(e: PointerEvent): Vec2 {
    const r = this.game.surface.canvas.getBoundingClientRect();
    const p = toWorld(this.view, e.clientX - r.left, e.clientY - r.top);
    return { x: clamp(p.x, -WORLD.width / 2, WORLD.width / 2), y: clamp(p.y, -WORLD.height / 2, WORLD.height / 2) };
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId !== -1 || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.game.surface.canvas.setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;
    this.stroke = [this.worldFromEvent(e)];
    this.strokeLen = 0;
    this.outOfInk = false;
    this.closing = false;
    this.note = null;
    this.refreshUI();
  }

  private onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.stroke) return;
    e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ce of events.length ? events : [e]) this.addPoint(this.worldFromEvent(ce));
    this.refreshUI();
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    const stroke = this.stroke;
    const outOfInk = this.outOfInk;
    this.stroke = null;
    if (!stroke || stroke.length < 3) {
      this.refreshUI(); // just a tap: keep what was there
      return;
    }
    const res = trackFromStroke(stroke, STR.editor.customName);
    if (res.ok) {
      this.push({ track: res.track, failed: null });
    } else {
      const issue = res.issue === 'not-closed' && outOfInk ? 'not-closed-ink' : res.issue;
      this.push({ track: null, failed: { stroke, issue, at: res.at } });
    }
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

  private cancelStroke(): void {
    if (this.pointerId !== -1 && this.game.surface.canvas.hasPointerCapture(this.pointerId)) {
      this.game.surface.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = -1;
    this.stroke = null;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // never steal browser shortcuts
    const actions: Record<string, () => void> = {
      KeyZ: () => this.undo(),
      KeyC: () => this.clear(),
      KeyS: () => this.loadSample(),
      Enter: () => this.race(),
      NumpadEnter: () => this.race(),
      Escape: () => this.game.go('race'),
    };
    const action = actions[e.code];
    if (!action) return;
    e.preventDefault();
    if (!e.repeat && !this.stroke) action();
  }

  // -------------------------------------------------------------- actions

  private push(next: EditorState, note: { text: string; kind: MessageKind } | null = null): void {
    this.history.push(this.state);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.state = next;
    this.note = note;
    this.refreshUI();
  }

  private undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.state = prev;
    this.note = { text: STR.editor.undone, kind: 'info' };
    this.refreshUI();
  }

  private clear(): void {
    if (this.state === EMPTY) return;
    this.push(EMPTY, { text: STR.editor.cleared, kind: 'info' });
  }

  private loadSample(): void {
    const track = getSampleTrack(this.sampleIndex);
    this.sampleIndex = (this.sampleIndex + 1) % SAMPLE_COUNT;
    this.push({ track, failed: null }, { text: fmt(STR.editor.sampleLoaded, { name: track.def.name }), kind: 'ok' });
  }

  private race(): void {
    if (!this.state.track) return;
    this.game.setTrack(this.state.track);
    this.game.go('race');
  }

  // ------------------------------------------------------------------- UI

  private refreshUI(): void {
    const ui = this.ui;
    ui.setCanUndo(this.history.length > 0);
    ui.setCanRace(!!this.state.track && !this.stroke);

    if (this.stroke) {
      const left = inkLeftWhileDrawing(this.strokeLen);
      ui.setInk(left, this.outOfInk);
      ui.setProjectedMultiplier(inkMultiplier(left));
      if (this.closing) ui.setMessage(STR.editor.releaseToClose, 'ok');
      else if (this.outOfInk) ui.setMessage(STR.editor.outOfInk, 'warn');
      else ui.setMessage(STR.editor.drawing, 'info');
      return;
    }

    const { track, failed } = this.state;
    ui.setInk(track ? track.ink.left : 1);
    ui.setMultiplier(track ? track.ink : null);
    if (this.note) ui.setMessage(this.note.text, this.note.kind);
    else if (track) {
      ui.setMessage(
        fmt(STR.editor.ready, { len: Math.round(track.center.length), corners: track.ink.tightCorners }),
        'ok',
      );
    } else if (failed) ui.setMessage(STR.editor.errors[failed.issue], 'error');
    else ui.setMessage(`${STR.editor.hint} ${STR.editor.hintInk}`, 'info');
  }

  // --------------------------------------------------------------- render

  frame(_dt: number, time: number): void {
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
    const { track, failed } = this.state;
    if (track) {
      drawTrack(ctx, v, track);
      drawFlag(ctx, v, track.center.points[0]);
    } else if (failed) {
      drawStroke(ctx, v, failed.stroke, true);
      drawFlag(ctx, v, failed.stroke[0]);
      if (failed.at) drawProblem(ctx, v, failed.at, time);
    }
  }
}
