import { STR } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { settings } from '../core/settings.ts';
import { button, h } from '../ui/dom.ts';

/**
 * PREVIEW state: the track being edited, in 3D, seen from an orbiting camera.
 * Drag to look around, wheel or pinch to zoom; it turns slowly on its own
 * until touched. Back returns to the editor with the edit untouched.
 */
export class PreviewScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;
  private yaw = 0.8;
  private pitch = 0.62;
  private dist = 400;
  private minDist = 40;
  private maxDist = 900;
  private target = { x: 0, y: 0, z: 0 };
  private spin = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  constructor(game: GameContext) {
    this.game = game;
    this.root = h(
      'div',
      { class: 'screen preview' },
      h(
        'div',
        { class: 'preview-bar' },
        button(STR.preview.back, () => this.back(), { icon: '←', key: 'Esc' }),
        h('div', { class: 'preview-title', text: STR.preview.title }),
        h('div', { class: 'spacer' }),
        button(STR.buttons.raceIt, () => this.game.preview?.race(), { icon: '▶', key: 'Enter', class: 'primary' }),
      ),
      h('div', { class: 'preview-hint', text: STR.preview.hint }),
    );
  }

  private back(): void {
    const p = this.game.preview;
    if (p) p.back();
    else this.game.go('editor');
  }

  enter(): void {
    const p = this.game.preview;
    const v = this.game.view3d;
    if (!p || !v) {
      this.game.go('editor');
      return;
    }
    v.setTrack(p.track);
    this.restore = v.hideExtras();
    // Frame the whole track.
    const pts = p.track.center.points;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    let hSum = 0;
    for (const q of pts) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      z0 = Math.min(z0, q.y);
      z1 = Math.max(z1, q.y);
    }
    for (const hgt of p.track.center.height) hSum += hgt;
    this.target = { x: (x0 + x1) / 2, y: hSum / pts.length, z: (z0 + z1) / 2 };
    const radius = Math.max(60, Math.hypot(x1 - x0, z1 - z0) / 2);
    this.dist = radius * 1.35;
    this.minDist = 25;
    this.maxDist = radius * 3;
    this.spin = true;
    v.setFog(this.dist * 1.2, this.dist * 4 + 600);
    this.game.ui.append(this.root);

    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    const c = v.renderer.domElement;
    c.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.spin = false;
      if (this.pointers.size === 2) this.pinch = this.spread();
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointers can't be captured */
      }
    }, opts);
    c.addEventListener('pointermove', (e) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, now);
      if (this.pointers.size === 2) {
        const d = this.spread();
        if (this.pinch > 0) this.zoomBy(this.pinch / d);
        this.pinch = d;
      } else {
        this.yaw -= (now.x - last.x) * 0.006;
        this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + (now.y - last.y) * 0.004));
      }
    }, opts);
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
    };
    c.addEventListener('pointerup', up, opts);
    c.addEventListener('pointercancel', up, opts);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.spin = false;
      this.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.0012));
    }, { signal: this.abort.signal, passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.back();
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.game.preview?.race();
      }
    }, opts);
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  private zoomBy(f: number): void {
    this.dist = Math.max(this.minDist, Math.min(this.maxDist, this.dist * f));
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.pointers.clear();
    this.root.remove();
    this.restore?.();
    this.restore = null;
    this.game.view3d?.setQuality(settings().graphics); // puts the fog back
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  frame(dt: number): void {
    const v = this.game.view3d;
    if (!v) return;
    if (this.spin) this.yaw += dt * 0.12;
    const t = this.target;
    const cam = v.camera;
    const r = this.dist;
    cam.position.set(t.x + Math.sin(this.yaw) * Math.cos(this.pitch) * r, t.y + Math.sin(this.pitch) * r, t.z + Math.cos(this.yaw) * Math.cos(this.pitch) * r);
    cam.up.set(0, 1, 0);
    cam.lookAt(t.x, t.y, t.z);
    if (Math.abs(cam.fov - 55) > 0.01) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    v.render();
  }
}
