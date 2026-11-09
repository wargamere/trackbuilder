import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { STR } from '../config/strings.ts';
import type { RoadSurface } from '../config/track.ts';
import { rng } from '../core/random.ts';

/**
 * Procedural textures, drawn once on small canvases at start-up. Nothing is
 * downloaded, and the textures are shared by every track.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, wrapS: boolean, wrapT: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = wrapS ? RepeatWrapping : ClampToEdgeWrapping;
  t.wrapT = wrapT ? RepeatWrapping : ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

/** Sprinkles `count` small specks of random brightness around `base` (0-255 grey). */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, rand: () => number, rgb: (v: number) => string): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rgb(rand());
    const s = rand() < 0.85 ? 1 : 2;
    ctx.fillRect(Math.floor(rand() * w), Math.floor(rand() * h), s, s);
  }
}

/**
 * Asphalt for the road ribbon. U runs across the road (0 = left edge,
 * 1 = right edge) and has the white edge lines baked in. V runs along the road
 * and repeats; one tile is about as long as the road is wide.
 */
export function makeAsphaltTexture(kind: RoadSurface = 'tarmac'): Texture {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const rand = rng(7);
  const look = ROAD_LOOKS[kind];
  ctx.fillStyle = look.base;
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 9000, rand, (v) => {
    const g = look.lo + v * (look.hi - look.lo);
    return `rgb(${Math.round(g * look.tint[0])},${Math.round(g * look.tint[1])},${Math.round(g * look.tint[2])})`;
  });
  // Two darker racing-line bands where tyres wear the surface (ruts in dirt, packed tracks in snow).
  const band = (x: number, w: number) => {
    const grad = ctx.createLinearGradient(x - w, 0, x + w, 0);
    grad.addColorStop(0, `rgba(${look.band},0)`);
    grad.addColorStop(0.5, `rgba(${look.band},${look.bandAlpha})`);
    grad.addColorStop(1, `rgba(${look.band},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - w, 0, w * 2, H);
  };
  band(W * 0.32, 22);
  band(W * 0.68, 22);
  if (!look.lines) return finish(c, false, true);
  // Edge lines (~0.45 m wide, ~0.35 m in from the edge on a 12 m road).
  ctx.fillStyle = '#f2f2ee';
  ctx.fillRect(Math.round(W * 0.03), 0, Math.round(W * 0.04), H);
  ctx.fillRect(W - Math.round(W * 0.07), 0, Math.round(W * 0.04), H);
  // A thin dark gutter at the very edge.
  ctx.fillStyle = 'rgba(30,30,30,0.6)';
  ctx.fillRect(0, 0, 3, H);
  ctx.fillRect(W - 3, 0, 3, H);
  return finish(c, false, true);
}

/** How each road surface looks: base colour, speckle brightness and tint, the tyre bands, and whether it has painted edge lines. */
const ROAD_LOOKS: Record<RoadSurface, { base: string; lo: number; hi: number; tint: [number, number, number]; band: string; bandAlpha: number; lines: boolean }> = {
  tarmac: { base: '#54575d', lo: 60, hi: 110, tint: [1, 1, 1.03], band: '20,20,24', bandAlpha: 0.16, lines: true },
  dirt: { base: '#8a6744', lo: 95, hi: 165, tint: [1.08, 0.82, 0.58], band: '60,40,22', bandAlpha: 0.3, lines: false },
  snow: { base: '#e3e9ef', lo: 200, hi: 250, tint: [0.97, 0.99, 1.03], band: '120,132,152', bandAlpha: 0.38, lines: false },
};

/** Tiling ground (grass, sand or snow). Large-scale colour variation comes from the terrain's vertex colours. */
export function makeGroundTexture(g: { base: string; speck: [number, number, number]; lo: number; hi: number }): Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rand = rng(11);
  ctx.fillStyle = g.base;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 5000, rand, (v) => {
    const b = g.lo + v * (g.hi - g.lo);
    return `rgb(${Math.round(Math.min(255, b * g.speck[0]))},${Math.round(Math.min(255, b * g.speck[1]))},${Math.round(Math.min(255, b * g.speck[2]))})`;
  });
  return finish(c, true, true);
}

/**
 * One atlas for the start/finish props, so they share a single material:
 *  - top half: the gantry banner,
 *  - bottom half: the chequered start line (8 x 2 squares).
 */
export const ATLAS = {
  banner: { u0: 0, u1: 1, v0: 0.5 + 2 / 256, v1: 1 - 2 / 256 },
  checker: { u0: 0, u1: 1, v0: 2 / 256, v1: 0.5 - 2 / 256 },
  /** Width / height of the banner as built in 3D. The text is pre-squashed to match. */
  bannerAspect: 8,
} as const;

export function makeAtlasTexture(): Texture {
  const W = 512;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  // Banner (canvas top = texture v 1).
  ctx.fillStyle = '#1b3a8a';
  ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#f2b705';
  ctx.fillRect(0, 6, W, 8);
  ctx.fillRect(0, H / 2 - 14, W, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 54px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The banner region is 512x124 px but is shown at ATLAS.bannerAspect, so squash the text.
  const stretch = ATLAS.bannerAspect / (W / (H / 2 - 4));
  ctx.save();
  ctx.translate(W / 2, H / 4 + 2);
  ctx.scale(1 / stretch, 1);
  ctx.fillText(STR.race.gantry, 0, 0, (W - 40) * stretch);
  ctx.restore();
  // Chequered line.
  const cols = 8;
  const rows = 2;
  const cw = W / cols;
  const ch = H / 2 / rows;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      ctx.fillStyle = (r + k) % 2 === 0 ? '#111111' : '#f4f4f4';
      ctx.fillRect(k * cw, H / 2 + r * ch, cw, ch);
    }
  }
  return finish(c, false, false);
}
