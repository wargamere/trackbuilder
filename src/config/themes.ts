import type { ThemeId } from './track.ts';

export type PropKind = 'conifer' | 'broadleaf' | 'cactus' | 'rock' | 'snowpine' | 'boulder' | 'office' | 'block';

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
  /** How the props are spread: in woods (clumps by noise) or as city blocks (an even grid, square to it). */
  layout?: 'woods' | 'city';
  /** More or fewer props than the track's density setting alone gives. */
  propDensity?: number;
  /** Woods everywhere: at least this chance of a prop in every spot, even between the woods. */
  minCover?: number;
  /** How tall the hills on the horizon are (1 = rolling hills). */
  hillScale?: number;
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
  // High meadows under snowy peaks.
  alpine: {
    skyTop: 0x3f86d8,
    skyHorizon: 0xd6e8f6,
    ground: { base: '#76a052', speck: [0.6, 1, 0.45], lo: 115, hi: 185 },
    groundTint: [0.95, 1, 0.93],
    hills: [0x46525e, 0xf4f7fa],
    hemiSky: 0xe0f0ff,
    hemiGround: 0x5a7448,
    sun: 0xfff6e6,
    sunIntensity: 2.3,
    props: ['conifer', 'boulder'],
    propRadius: [0.5, 1.2],
    hillScale: 3.4,
  },
  // Streets of offices and low blocks; the horizon is the far side of town.
  city: {
    skyTop: 0x5a8fcc,
    skyHorizon: 0xd9e1ea,
    ground: { base: '#8c8f95', speck: [1, 1, 1.04], lo: 110, hi: 175 },
    groundTint: [0.98, 0.98, 1],
    hills: [0x707c8c, 0xa9b4c2],
    hemiSky: 0xe2e9f2,
    hemiGround: 0x6f737a,
    sun: 0xfff1de,
    sunIntensity: 2.1,
    props: ['office', 'block'],
    propRadius: [6.5, 6],
    layout: 'city',
    hillScale: 0.7,
  },
  // Deep woods right up to the barriers.
  forest: {
    skyTop: 0x4b8fd2,
    skyHorizon: 0xcfe2ee,
    ground: { base: '#4f7a3a', speck: [0.5, 0.95, 0.35], lo: 90, hi: 160 },
    groundTint: [0.93, 1, 0.9],
    hills: [0x3e6a43, 0x6e9387],
    hemiSky: 0xd6ebf7,
    hemiGround: 0x41602f,
    sun: 0xfff0d6,
    sunIntensity: 2.1,
    props: ['conifer', 'broadleaf'],
    propRadius: [0.5, 0.5],
    propDensity: 1.6,
    minCover: 0.42,
    hillScale: 1.3,
  },
};
