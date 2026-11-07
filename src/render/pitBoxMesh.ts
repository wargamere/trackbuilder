import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { wrap } from '../core/math.ts';
import type { PitBox } from '../race/pitStop.ts';
import { leftOf, sampleAt, surfaceY } from '../track/spline.ts';
import type { Track } from '../track/track.ts';

let texture: CanvasTexture | null = null;

/** Yellow box lines with "PIT" painted across the middle (u across the box, v along it). */
function pitTexture(): CanvasTexture {
  if (texture) return texture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(242, 183, 5, 0.16)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#f2b705';
    ctx.lineWidth = 12;
    ctx.strokeRect(6, 6, c.width - 12, c.height - 12);
    // Upright to a car driving in (the top of the canvas is the far end of the box).
    ctx.fillStyle = '#f2b705';
    ctx.font = '900 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PIT', c.width / 2, c.height / 2);
  }
  texture = new CanvasTexture(c);
  texture.anisotropy = 4;
  return texture;
}

/** Road height at track position `s` (m), `lat` metres left of the centre line, between samples. */
function roadY(track: Track, s: number, lat: number): number {
  const c = track.center;
  const n = c.points.length;
  const f = wrap(s, c.length) / c.spacing;
  const i = Math.floor(f) % n;
  const u = f - Math.floor(f);
  return surfaceY(c, i, lat) * (1 - u) + surfaceY(c, (i + 1) % n, lat) * u;
}

/**
 * The pit box painted on the road: a yellow outline and "PIT", following the
 * road's rise and bank. One draw call, drawn just over the road.
 */
export function buildPitBoxMesh(track: Track, box: PitBox): Mesh {
  const c = track.center;
  const steps = 10;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = box.s - box.length / 2 + (box.length * k) / steps;
    const { p, t } = sampleAt(c, s);
    const l = leftOf(t);
    // u runs from the box's left-hand edge (as you drive in) to its right.
    for (const side of [1, -1]) {
      const lat = box.lateral + (side * box.width) / 2;
      pos.push(p.x + l.x * lat, roadY(track, s, lat) + 0.035, p.y + l.y * lat);
      uv.push((1 - side) / 2, k / steps);
    }
  }
  for (let k = 0; k < steps; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new Mesh(
    g,
    new MeshBasicMaterial({ map: pitTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide }),
  );
  m.renderOrder = 1.6;
  return m;
}
