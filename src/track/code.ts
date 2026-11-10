import { DEFAULT_OPTIONS, OPTION_CHOICES, THEME_IDS, TRACK, type TrackOptions } from '../config/track.ts';
import { fromBase64Url, toBase64Url } from '../core/base64.ts';
import type { Dot } from '../core/math.ts';
import { cleanExtras, PLACED_KINDS, ROT_STEPS, type Placed, type TrackExtras } from './extras.ts';

/**
 * TRACK CODES — a short text form of a track that players copy and paste.
 *
 * A track rebuilds deterministically from its dots (the control points the
 * centre-line spline runs through) and options, so the code stores just those
 * plus the name:
 *   "IC1." + base64url(
 *     version (5), name length, name (UTF-8), options (varint), road width
 *     (byte, 0.5 m steps), flags (bit 0: per-corner banking follows), dot count
 *     (varint), first dot (2 × int16 + uint8 height), then each next dot as
 *     zig-zag varint deltas of x, y and height, [one varint per dot: 0 = the
 *     track's banking, else bank degrees + 1], extras, checksum byte)
 * Positions and heights are in 0.5 m steps, so most deltas fit in a byte or
 * two. A 30-dot track is about 100-200 characters. Version 1 codes (no
 * heights or options), version 2 codes (an options byte with just banking,
 * barriers and scenery), version 3 codes (preset widths, no per-corner
 * banking) and version 4 codes (no extras) still decode.
 *
 * Options bits: banking 0-1, barriers on 2, theme 3-4, then each field of
 * OPTION_CHOICES up to trees in order (index 0 = the default), then (version
 * 5) the theme's third bit, the barrier style's second bit, the road surface
 * (2 bits), the barrier distance (5 bits, whole metres) and bridges or
 * tunnels (1 bit). Older codes, whose
 * higher bits are all zero, get the defaults for everything newer.
 *
 * Extras (version 5): a varint count, then that many blocks of a varint tag,
 * a varint length and that many bytes. Blocks with a tag this version doesn't
 * know are skipped, so later versions can add things older ones ignore.
 *   tag 1, placed scenery: a varint count, then per thing its kind (byte),
 *          x and y (int16, 0.5 m steps) and rotation (byte, 1/64 turns);
 *   tag 2, painted run-off: a varint count of numbers, then the paint grid's
 *          run-length code as varints (see track/extras.ts).
 */
export const CODE_PREFIX = 'IC1.';
const VERSION = 5;
const THEMES = THEME_IDS;
const MAX_NAME_BYTES = 64;
const MAX_DOTS = 2000;

export type DecodeResult =
  | { ok: true; name: string; dots: Dot[]; options: TrackOptions; extras?: TrackExtras }
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

/** The fields stored in order after the theme, and their bits (the barrier style's second bit comes later). */
type Field = Exclude<keyof typeof OPTION_CHOICES, 'road' | 'crossing'>;
const FIELD_BITS: Record<Field, number> = { width: 2, kerbs: 2, runoff: 2, barrier: 1, pits: 1, time: 2, laps: 2, trees: 2 };
const FIELDS = Object.keys(FIELD_BITS) as Field[];
/** Where the version 5 bits start. */
const V5_SHIFT = 19;
const GAP_BITS = 5;

const indexIn = (choices: readonly unknown[], v: unknown) => Math.max(0, choices.indexOf(v));

function optionsBits(o: TrackOptions): number {
  const theme = indexIn(THEMES, o.theme);
  let v = (o.banking & 3) | (o.walls ? 4 : 0) | ((theme & 3) << 3);
  let shift = 5;
  for (const f of FIELDS) {
    v |= (indexIn(OPTION_CHOICES[f], o[f]) & ((1 << FIELD_BITS[f]) - 1)) << shift;
    shift += FIELD_BITS[f];
  }
  const gap = Math.max(0, Math.min((1 << GAP_BITS) - 1, Math.round(o.barrierGap)));
  v |= ((theme >> 2) & 1) << V5_SHIFT;
  v |= ((indexIn(OPTION_CHOICES.barrier, o.barrier) >> 1) & 1) << (V5_SHIFT + 1);
  v |= indexIn(OPTION_CHOICES.road, o.road) << (V5_SHIFT + 2);
  v |= gap << (V5_SHIFT + 4);
  v |= indexIn(OPTION_CHOICES.crossing, o.crossing) << (V5_SHIFT + 4 + GAP_BITS);
  return v >>> 0;
}

function optionsFrom(v: number): TrackOptions {
  const pickFrom = <T>(choices: readonly T[], idx: number): T => choices[idx] ?? choices[0];
  const o: TrackOptions = {
    ...DEFAULT_OPTIONS,
    banking: Math.min(2, v & 3) as 0 | 1 | 2,
    walls: (v & 4) !== 0,
    theme: pickFrom(THEMES, ((v >> 3) & 3) | (((v >>> V5_SHIFT) & 1) << 2)),
  };
  let shift = 5;
  for (const f of FIELDS) {
    const idx = (v >>> shift) & ((1 << FIELD_BITS[f]) - 1);
    (o as unknown as Record<string, unknown>)[f] = pickFrom(OPTION_CHOICES[f] as readonly unknown[], idx);
    shift += FIELD_BITS[f];
  }
  o.barrier = pickFrom(OPTION_CHOICES.barrier, indexIn(OPTION_CHOICES.barrier, o.barrier) | (((v >>> (V5_SHIFT + 1)) & 1) << 1));
  o.road = pickFrom(OPTION_CHOICES.road, (v >>> (V5_SHIFT + 2)) & 3);
  o.barrierGap = Math.min(TRACK.maxBarrierGap, (v >>> (V5_SHIFT + 4)) & ((1 << GAP_BITS) - 1));
  o.crossing = pickFrom(OPTION_CHOICES.crossing, (v >>> (V5_SHIFT + 4 + GAP_BITS)) & 1);
  return o;
}

export function encodeTrack(name: string, dots: readonly Dot[], options: Partial<TrackOptions> = {}, extras?: TrackExtras): string {
  const q = TRACK.quantize;
  const out: number[] = [VERSION];
  let nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > MAX_NAME_BYTES) nameBytes = nameBytes.slice(0, MAX_NAME_BYTES);
  out.push(nameBytes.length, ...nameBytes);
  const o = { ...DEFAULT_OPTIONS, ...options };
  pushVarint(out, optionsBits(o));
  out.push(Math.max(0, Math.min(255, Math.round(o.width * 2))));
  const banks = dots.some((d) => d.b !== undefined);
  out.push(banks ? 1 : 0);
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
  if (banks) for (const d of dots) pushVarint(out, d.b === undefined ? 0 : Math.max(0, Math.round(d.b)) + 1);
  const blocks = extraBlocks(cleanExtras(extras));
  pushVarint(out, blocks.length);
  for (const [tag, body] of blocks) {
    pushVarint(out, tag);
    pushVarint(out, body.length);
    out.push(...body);
  }
  out.push(checksum(out, out.length));
  return CODE_PREFIX + toBase64Url(Uint8Array.from(out));
}

const int16Bytes = (v: number): number[] => {
  const u = Math.max(-0x8000, Math.min(0x7fff, Math.round(v))) & 0xffff;
  return [u & 0xff, u >> 8];
};

/** The extras as tagged blocks. */
function extraBlocks(e: TrackExtras | undefined): [number, number[]][] {
  const out: [number, number[]][] = [];
  const q = TRACK.quantize;
  if (e?.placed?.length) {
    const body: number[] = [];
    pushVarint(body, e.placed.length);
    for (const p of e.placed) {
      body.push(Math.max(0, PLACED_KINDS.indexOf(p.kind)), ...int16Bytes(p.x / q), ...int16Bytes(p.y / q));
      body.push(((Math.round((p.rot / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS) + ROT_STEPS) % ROT_STEPS);
    }
    out.push([1, body]);
  }
  if (e?.paint?.length) {
    const body: number[] = [];
    pushVarint(body, e.paint.length);
    for (const v of e.paint) pushVarint(body, v);
    out.push([2, body]);
  }
  return out;
}

/** Reads the extras' tagged blocks; null if one is malformed. Unknown tags are skipped. */
function readExtras(blocks: { tag: number; bytes: Uint8Array }[]): TrackExtras | null {
  const e: TrackExtras = {};
  const q = TRACK.quantize;
  for (const { tag, bytes } of blocks) {
    let i = 0;
    const byte = () => (i < bytes.length ? bytes[i++] : -1);
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
    const int16 = () => {
      const lo = byte();
      const hi = byte();
      if (lo < 0 || hi < 0) return null;
      const v = lo | (hi << 8);
      return v >= 0x8000 ? v - 0x10000 : v;
    };
    if (tag === 1) {
      const count = varint();
      if (count < 0 || count > 500) return null;
      const placed: Placed[] = [];
      for (let k = 0; k < count; k++) {
        const kind = PLACED_KINDS[byte()];
        const x = int16();
        const y = int16();
        const rot = byte();
        if (!kind || x === null || y === null || rot < 0) return null;
        placed.push({ kind, x: x * q, y: y * q, rot: ((rot % ROT_STEPS) * Math.PI * 2) / ROT_STEPS });
      }
      e.placed = placed;
    } else if (tag === 2) {
      const count = varint();
      if (count < 0 || count > 100000) return null;
      const paint: number[] = [];
      for (let k = 0; k < count; k++) {
        const v = varint();
        if (v < 0) return null;
        paint.push(v);
      }
      e.paint = paint;
    }
  }
  return e.placed || e.paint ? e : {};
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
  if (version < 1 || version > VERSION) return { ok: false, error: 'format' };
  const nameLen = byte();
  if (nameLen < 0 || nameLen > MAX_NAME_BYTES || i + nameLen > end) return { ok: false, error: 'format' };
  const name = new TextDecoder().decode(bytes.slice(i, i + nameLen));
  i += nameLen;
  const rawOptions = version >= 3 ? varint() : version === 2 ? byte() : 0;
  if (rawOptions < 0) return { ok: false, error: 'format' };
  const options = version >= 2 ? optionsFrom(rawOptions) : { ...DEFAULT_OPTIONS };
  let banks = false;
  if (version >= 4) {
    const w = byte();
    const flags = byte();
    if (w < 0 || flags < 0) return { ok: false, error: 'format' };
    options.width = Math.max(TRACK.minWidth, Math.min(TRACK.maxWidth, w / 2));
    banks = (flags & 1) !== 0;
  }
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
  if (banks) {
    for (const d of dots) {
      const v = varint();
      if (v < 0) return { ok: false, error: 'format' };
      if (v > 0) d.b = v - 1;
    }
  }
  let extras: TrackExtras | undefined;
  if (version >= 5) {
    const count = varint();
    if (count < 0 || count > 64) return { ok: false, error: 'format' };
    const blocks: { tag: number; bytes: Uint8Array }[] = [];
    for (let b = 0; b < count; b++) {
      const tag = varint();
      const len = varint();
      if (tag < 0 || len < 0 || i + len > end) return { ok: false, error: 'format' };
      blocks.push({ tag, bytes: bytes.slice(i, i + len) });
      i += len;
    }
    const e = readExtras(blocks);
    if (!e) return { ok: false, error: 'format' };
    if (e.placed || e.paint) extras = e;
  }
  if (i !== end) return { ok: false, error: 'format' };
  return extras ? { ok: true, name, dots, options, extras } : { ok: true, name, dots, options };
}
