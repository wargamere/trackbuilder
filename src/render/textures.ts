import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { STR } from '../config/strings.ts';
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
export function makeAsphaltTexture(): Texture {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const rand = rng(7);
  ctx.fillStyle = '#54575d';
  ctx.fillRect(0, 0, W, H);
  speckle(ctx, W, H, 9000, rand, (v) => {
    const g = Math.round(60 + v * 50);
    return `rgb(${g},${g},${g + 3})`;
  });
  // Two darker racing-line bands where tyres wear the surface.
  const band = (x: number, w: number) => {
    const grad = ctx.createLinearGradient(x - w, 0, x + w, 0);
    grad.addColorStop(0, 'rgba(20,20,24,0)');
    grad.addColorStop(0.5, 'rgba(20,20,24,0.16)');
    grad.addColorStop(1, 'rgba(20,20,24,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - w, 0, w * 2, H);
  };
  band(W * 0.32, 22);
  band(W * 0.68, 22);
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

/** Tiling grass. Large-scale colour variation comes from the ground's vertex colours. */
export function makeGrassTexture(): Texture {
  const S = 128;
  const [c, ctx] = canvas(S, S);
  const rand = rng(11);
  ctx.fillStyle = '#6a9a48';
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, 5000, rand, (v) => {
    const g = Math.round(120 + v * 70);
    return `rgb(${Math.round(g * 0.55)},${g},${Math.round(g * 0.35)})`;
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
