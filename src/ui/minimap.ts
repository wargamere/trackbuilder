import { wrap } from '../core/math.ts';
import { overpasses } from '../editor/render2d.ts';
import type { Track } from '../track/track.ts';
import { h } from './dom.ts';

/**
 * Small map of the track in a corner of the HUD with the car, the ghost and
 * the AI cars on it. The track is drawn once into an offscreen canvas; each frame only copies
 * it and adds two dots.
 */
export class Minimap {
  readonly root: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly bg = document.createElement('canvas');
  private track: Track | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor() {
    this.root = h('canvas', { class: 'minimap' });
    this.ctx = this.root.getContext('2d');
  }

  /** Redraws the background when the track or the minimap's size changes. */
  private prepare(track: Track): void {
    const cssW = this.root.clientWidth;
    const cssH = this.root.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (track === this.track && cssW === this.w && cssH === this.h && dpr === this.dpr) return;
    this.track = track;
    this.w = cssW;
    this.h = cssH;
    this.dpr = dpr;
    if (!cssW || !cssH) return;
    for (const c of [this.root, this.bg]) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    const pts = track.center.points;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const pad = 9;
    this.scale = Math.min((cssW - pad * 2) / Math.max(1, x1 - x0), (cssH - pad * 2) / Math.max(1, y1 - y0));
    this.ox = cssW / 2 - ((x0 + x1) / 2) * this.scale;
    this.oy = cssH / 2 - ((y0 + y1) / 2) * this.scale;

    const g = this.bg.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const n = pts.length;
    const run = (from: number, count: number) => {
      g.beginPath();
      for (let k = 0; k <= count; k++) {
        const p = pts[wrap(from + k, n)];
        const x = this.ox + p.x * this.scale;
        const y = this.oy + p.y * this.scale;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    };
    const road = Math.max(3, track.center.width * this.scale);
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.lineWidth = road + 3;
    run(0, n);
    g.strokeStyle = '#3b4250';
    g.lineWidth = road;
    run(0, n);
    // Bridges drawn again on top, with a dark edge.
    g.lineCap = 'butt';
    for (const o of overpasses(track)) {
      g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      g.lineWidth = road + 4;
      run(o.from, o.count);
      g.strokeStyle = '#5a6272';
      g.lineWidth = road;
      run(o.from, o.count);
    }
    // Start line.
    const s = pts[0];
    const t = track.center.tangents[0];
    const half = road * 0.9;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.ox + s.x * this.scale + t.y * half, this.oy + s.y * this.scale - t.x * half);
    g.lineTo(this.ox + s.x * this.scale - t.y * half, this.oy + s.y * this.scale + t.x * half);
    g.stroke();
  }

  /** Draws the map with the car (and the ghost, if any) at world (x, z). */
  draw(track: Track, car: { x: number; z: number }, ghost: { x: number; z: number } | null, others: readonly { x: number; z: number; color: string }[] = []): void {
    const g = this.ctx;
    if (!g) return;
    this.prepare(track);
    if (!this.w || !this.h) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.root.width, this.root.height);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const dot = (x: number, z: number, r: number, fill: string, edge: string) => {
      g.beginPath();
      g.arc(this.ox + x * this.scale, this.oy + z * this.scale, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = edge;
      g.stroke();
    };
    if (ghost) dot(ghost.x, ghost.z, 3.5, 'rgba(255, 255, 255, 0.75)', 'rgba(0, 0, 0, 0.5)');
    for (const o of others) dot(o.x, o.z, 3.5, o.color, 'rgba(0, 0, 0, 0.6)');
    dot(car.x, car.z, 4.5, '#ffcc1a', '#1b1b1b');
  }
}
