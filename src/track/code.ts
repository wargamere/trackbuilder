import { TRACK } from '../config/track.ts';
import { fromBase64Url, toBase64Url } from '../core/base64.ts';
import type { Vec2 } from '../core/math.ts';

/**
 * TRACK CODES — a short text form of a track that players copy and paste.
 *
 * A track rebuilds deterministically from its dots (the control points the
 * centre-line spline runs through), so the code stores just those plus the
 * name:
 *   "IC1." + base64url(
 *     version, name length, name (UTF-8), dot count (varint),
 *     first dot (2 × int16), then each next dot as a zig-zag varint delta,
 *     checksum byte)
 * Coordinates are in TRACK.quantize (0.5 m) steps, so most deltas fit in one
 * or two bytes. A 30-dot track is about 100-130 characters.
 */
export const CODE_PREFIX = 'IC1.';
const VERSION = 1;
const MAX_NAME_BYTES = 64;
const MAX_DOTS = 2000;

export type DecodeResult = { ok: true; name: string; dots: Vec2[] } | { ok: false; error: 'format' | 'checksum' };

function pushVarint(out: number[], v: number): void {
  let u = v >>> 0;
  while (u >= 0x80) {
    out.push((u & 0x7f) | 0x80);
    u >>>= 7;
  }
  out.push(u);
}

const zigzag = (v: number) => (v << 1) ^ (v >> 31);
const unzigzag = (u: number) => (u >>> 1) ^ -(u & 1);

function checksum(bytes: ArrayLike<number>, n: number): number {
  let h = 0x5a;
  for (let i = 0; i < n; i++) h = (Math.imul(h, 31) + bytes[i]) & 0xff;
  return h;
}

export function encodeTrack(name: string, dots: readonly Vec2[]): string {
  const q = TRACK.quantize;
  const out: number[] = [VERSION];
  let nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > MAX_NAME_BYTES) nameBytes = nameBytes.slice(0, MAX_NAME_BYTES);
  out.push(nameBytes.length, ...nameBytes);
  pushVarint(out, dots.length);
  let px = 0;
  let py = 0;
  dots.forEach((d, i) => {
    const x = Math.round(d.x / q);
    const y = Math.round(d.y / q);
    if (i === 0) {
      out.push(x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff);
    } else {
      pushVarint(out, zigzag(x - px));
      pushVarint(out, zigzag(y - py));
    }
    px = x;
    py = y;
  });
  out.push(checksum(out, out.length));
  return CODE_PREFIX + toBase64Url(Uint8Array.from(out));
}

/** Pulls a code out of whatever was pasted: the bare code, or a link with #track=… */
export function extractCode(text: string): string {
  const t = text.trim();
  const m = /(?:#|&|\?)track=([^&\s]+)/.exec(t);
  return (m ? decodeURIComponent(m[1]) : t).replace(/\s+/g, '');
}

export function decodeTrack(text: string): DecodeResult {
  const code = extractCode(text);
  if (!code.startsWith(CODE_PREFIX)) return { ok: false, error: 'format' };
  const res = decodeBody(code);
  // It has our prefix, so any other failure means it was cut short or mangled.
  return res.ok || res.error === 'checksum' ? res : { ok: false, error: 'checksum' };
}

function decodeBody(code: string): DecodeResult {
  const bytes = fromBase64Url(code.slice(CODE_PREFIX.length));
  if (!bytes || bytes.length < 8) return { ok: false, error: 'format' };
  if (checksum(bytes, bytes.length - 1) !== bytes[bytes.length - 1]) return { ok: false, error: 'checksum' };
  let i = 0;
  const end = bytes.length - 1;
  const byte = () => (i < end ? bytes[i++] : -1);
  const varint = (): number => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = byte();
      if (b < 0 || shift > 28) return -1;
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
      shift += 7;
    }
  };
  if (byte() !== VERSION) return { ok: false, error: 'format' };
  const nameLen = byte();
  if (nameLen < 0 || nameLen > MAX_NAME_BYTES || i + nameLen > end) return { ok: false, error: 'format' };
  const name = new TextDecoder().decode(bytes.slice(i, i + nameLen));
  i += nameLen;
  const count = varint();
  if (count < 3 || count > MAX_DOTS) return { ok: false, error: 'format' };
  const q = TRACK.quantize;
  const int16 = () => {
    const lo = byte();
    const hi = byte();
    if (lo < 0 || hi < 0) return null;
    const v = lo | (hi << 8);
    return v >= 0x8000 ? v - 0x10000 : v;
  };
  const x0 = int16();
  const y0 = int16();
  if (x0 === null || y0 === null) return { ok: false, error: 'format' };
  const dots: Vec2[] = [{ x: x0 * q, y: y0 * q }];
  let x = x0;
  let y = y0;
  for (let k = 1; k < count; k++) {
    const dx = varint();
    const dy = varint();
    if (dx < 0 || dy < 0) return { ok: false, error: 'format' };
    x += unzigzag(dx);
    y += unzigzag(dy);
    dots.push({ x: x * q, y: y * q });
  }
  if (i !== end) return { ok: false, error: 'format' };
  return { ok: true, name, dots };
}
