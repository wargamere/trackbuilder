import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmp = new Color();

/** Gives every vertex of `g` the same colour (sRGB hex), for vertex-coloured props. */
export function tint(g: BufferGeometry, hex: number): BufferGeometry {
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  tmp.setHex(hex);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = tmp.r;
    arr[i * 3 + 1] = tmp.g;
    arr[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3));
  return g;
}

/** Merges geometries that share the same attributes, dropping UVs so primitives with and without them mix. */
export function merge(parts: BufferGeometry[], keepUv = false): BufferGeometry {
  for (const p of parts) if (!keepUv) p.deleteAttribute('uv');
  const out = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  if (!out) throw new Error('mergeGeometries failed: attribute mismatch');
  for (const p of parts) p.dispose();
  return out;
}

/**
 * Collects flat-coloured, up-facing quads into a non-indexed geometry
 * (used for kerbs, where every stripe needs hard colour edges).
 */
export class QuadBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private readonly c = new Color();

  /** Adds quad a-b-c-d (any winding; it is flipped to face up). */
  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, hex: number): void {
    const e1 = new Vector3().subVectors(b, a);
    const e2 = new Vector3().subVectors(c, a);
    const up = e1.cross(e2).y >= 0;
    const verts = up ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    this.c.setHex(hex);
    for (const v of verts) {
      this.pos.push(v.x, v.y, v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  get empty(): boolean {
    return this.pos.length === 0;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}
