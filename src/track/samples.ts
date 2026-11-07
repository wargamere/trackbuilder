import type { Vec2 } from '../core/math.ts';
import { STR } from '../config/strings.ts';
import type { TrackDef } from './track.ts';

/** Compact [x, y, x, y, ...] -> Vec2[], scaled about the origin. */
const pts = (scale: number, a: number[]): Vec2[] => {
  const out: Vec2[] = [];
  for (let i = 0; i < a.length; i += 2) out.push({ x: a[i] * scale, y: a[i + 1] * scale });
  return out;
};

/**
 * Built-in tracks, as control points in world metres (x east, y south; the
 * drawable area is ±320 × ±180). The race starts at the first point and runs
 * in list order. The first sample is the boot track.
 */
export const SAMPLE_TRACKS: TrackDef[] = [
  {
    id: 'sample-sunday-loop',
    name: STR.samples[0],
    builtIn: true,
    control: pts(0.92, [
      -80, 120, 40, 120, 150, 118, 230, 95, 268, 40, 262, -20, 225, -60, 160, -70, 110, -95, 95, -135,
      40, -150, -20, -130, -40, -80, -90, -50, -170, -70, -230, -120, -280, -100, -285, -20, -255, 60, -190, 110,
    ]),
  },
  {
    id: 'sample-paperclip',
    name: STR.samples[1],
    builtIn: true,
    control: pts(0.7, [
      -100, 110, 60, 110, 150, 106, 185, 80, 180, 45, 145, 35, 40, 40, -60, 40, -105, 22, -108, -18, -70, -35, 40, -38, 130, -42, 168, -72, 160, -108, 118, -118, 0, -116, -150, -112, -205, -85, -222, -10, -212, 65, -170, 104
    ]),
  },
  {
    id: 'sample-knot',
    name: STR.samples[2],
    builtIn: true,
    control: pts(0.8, [
      0, 95, 37, 120, 72, 112, 81, 77, 73, 45, 84, 34, 131, 29, 177, 13, 177, -13, 131, -29, 84, -34, 73, -45, 81, -77, 72, -112, 37, -120, 0, -95, -20, -66, -40, -61, -81, -77, -132, -82, -154, -61, -131, -29, -97, -7, -97, 7, -131, 29, -154, 61, -132, 82, -81, 77, -40, 61, -20, 66
    ]),
  },
];
