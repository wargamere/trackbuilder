import type { ThemeId } from './track.ts';

export type PropKind = 'conifer' | 'broadleaf' | 'cactus' | 'rock' | 'snowpine';

/** Look of the world around a track. Colours are sRGB hex. */
export interface Theme {
  skyTop: number;
  skyHorizon: number;
  /** Ground texture: base colour and speckle colour range (r, g, b multipliers of a 0..1 brightness). */
  ground: { base: string; speck: [number, number, number]; lo: number; hi: number };
  /** Large patches of lighter/darker ground (vertex colour tint). */
  groundTint: [number, number, number];
  hills: [number, number];
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunIntensity: number;
  /** The two kinds of roadside props (scenery placement kind 0 and 1). */
  props: [PropKind, PropKind];
  /** Collision radius of each prop kind at scale 1. */
  propRadius: [number, number];
}

export const THEMES: Record<ThemeId, Theme> = {
  meadow: {
    skyTop: 0x4f97de,
    skyHorizon: 0xcfe6f5,
    ground: { base: '#6a9a48', speck: [0.55, 1, 0.35], lo: 120, hi: 190 },
    groundTint: [0.97, 1, 0.9],
    hills: [0x5f8a55, 0x7fa8a8],
    hemiSky: 0xdcefff,
    hemiGround: 0x5d7a3c,
    sun: 0xfff2dc,
    sunIntensity: 2.2,
    props: ['conifer', 'broadleaf'],
    propRadius: [0.5, 0.5],
  },
  desert: {
    skyTop: 0x5c95d6,
    skyHorizon: 0xf3dfba,
    ground: { base: '#d8b878', speck: [1, 0.82, 0.55], lo: 170, hi: 235 },
    groundTint: [1, 0.96, 0.88],
    hills: [0xc98d5b, 0xd9b48e],
    hemiSky: 0xffeeda,
    hemiGround: 0xb08a5a,
    sun: 0xffe2b8,
    sunIntensity: 2.4,
    props: ['cactus', 'rock'],
    propRadius: [0.5, 1.3],
  },
  snow: {
    skyTop: 0x7fa6d4,
    skyHorizon: 0xe4edf6,
    ground: { base: '#eef3f8', speck: [0.92, 0.95, 1], lo: 205, hi: 255 },
    groundTint: [0.95, 0.97, 1],
    hills: [0xc7d3e0, 0xdfe7f0],
    hemiSky: 0xe8f1ff,
    hemiGround: 0x9aa8b8,
    sun: 0xfff6ec,
    sunIntensity: 1.9,
    props: ['snowpine', 'conifer'],
    propRadius: [0.5, 0.5],
  },
};
