import { DEFAULT_OPTIONS, TRACK, type ThemeId, type TrackOptions } from '../config/track.ts';
import { fromBase64Url, toBase64Url } from '../core/base64.ts';
import type { Dot } from '../core/math.ts';

/**
 * TRACK CODES — a short text form of a track that players copy and paste.
 *
 * A track rebuilds deterministically from its dots (the control points the
 * centre-line spline runs through) and options, so the code stores just those
 * plus the name:
 *   "IC1." + base64url(
 *     version (2), name length, name (UTF-8), options byte, dot count (varint),
 *     first dot (2 × int16 + uint8 height), then each next dot as zig-zag
 *     varint deltas of x, y and height, checksum byte)
 * Positions and heights are in 0.5 m steps, so most deltas fit in a byte or
 * two. A 30-dot track is about 100-200 characters. Version 1 codes (no
 * heights or options) still decode.
 */
export const CODE_PREFIX = 'IC1.';
const VERSION = 2;
const THEMES: ThemeId[] = ['meadow', 'desert', 'snow'];
const MAX_NAME_BYTES = 64;
const MAX_DOTS = 2000;

export type DecodeResult =
  | { ok: true; name: string; dots: Dot[]; options: TrackOptions }
  | { ok: false; error: 'format' | 'checksum' };

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

const optionsByte = (o: TrackOptions) => (o.banking & 3) | (o.walls ? 4 : 0) | (Math.max(0, THEMES.indexOf(o.theme)) << 3);
const optionsFrom = (b: number): TrackOptions => ({
  banking: Math.min(2, b & 3) as 0 | 1 | 2,
  walls: (b & 4) !== 0,
  theme: THEMES[(b >> 3) & 3] ?? 'meadow',
});

export function encodeTrack(name: string, dots: readonly Dot[], options: Partial<TrackOptions> = {}): string {
  const q = TRACK.quantize;
  const out: number[] = [VERSION];
  let nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > MAX_NAME_BYTES) nameBytes = nameBytes.slice(0, MAX_NAME_BYTES);
  out.push(nameBytes.length, ...nameBytes);
  out.push(optionsByte({ ...DEFAULT_OPTIONS, ...options }));
  pushVarint(out, dots.length);
  let px = 0;
  let py = 0;
  let ph = 0;
  dots.forEach((d, i) => {
    const x = Math.round(d.x / q);
    const y = Math.round(d.y / q);
    const hgt = Math.max(0, Math.min(255, Math.round((d.h ?? 0) / TRACK.heightStep)));
    if (i === 0) {
      out.push(x & 0xff, (x >> 8) & 0xff, y & 0xff, (y >> 8) & 0xff, hgt);
    } else {
      pushVarint(out, zigzag(x - px));
      pushVarint(out, zigzag(y - py));
      pushVarint(out, zigzag(hgt - ph));
    }
    px = x;
    py = y;
    ph = hgt;
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
  const version = byte();
  if (version !== 1 && version !== 2) return { ok: false, error: 'format' };
  const nameLen = byte();
  if (nameLen < 0 || nameLen > MAX_NAME_BYTES || i + nameLen > end) return { ok: false, error: 'format' };
  const name = new TextDecoder().decode(bytes.slice(i, i + nameLen));
  i += nameLen;
  const options = version >= 2 ? optionsFrom(byte()) : { ...DEFAULT_OPTIONS };
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
  const h0 = version >= 2 ? byte() : 0;
  if (x0 === null || y0 === null || h0 < 0) return { ok: false, error: 'format' };
  const hs = TRACK.heightStep;
  const dot = (x: number, y: number, hgt: number): Dot => (hgt ? { x: x * q, y: y * q, h: hgt * hs } : { x: x * q, y: y * q });
  const dots: Dot[] = [dot(x0, y0, h0)];
  let x = x0;
  let y = y0;
  let hgt = h0;
  for (let k = 1; k < count; k++) {
    const dx = varint();
    const dy = varint();
    const dh = version >= 2 ? varint() : 0;
    if (dx < 0 || dy < 0 || dh < 0) return { ok: false, error: 'format' };
    x += unzigzag(dx);
    y += unzigzag(dy);
    hgt += unzigzag(dh);
    dots.push(dot(x, y, hgt));
  }
  if (i !== end) return { ok: false, error: 'format' };
  return { ok: true, name, dots, options };
}
