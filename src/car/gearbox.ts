import { HANDLING } from '../config/handling.ts';

/**
 * Who changes gear: the player (`manual`), the automatic gearbox assist
 * (`auto`: it changes at the same revs as the AI's box, but each change up
 * cuts the drive for a moment, so a good manual driver beats it), or the AI's
 * box (`ideal`: AI cars and the bot that sets the medal times).
 */
export type GearboxMode = 'manual' | 'auto' | 'ideal';

const G = HANDLING.gearbox;
export const GEAR_COUNT = G.top.length;

/** The gear-related part of a car's state. */
export interface GearState {
  /** 1..GEAR_COUNT */
  gear: number;
  /** Engine revs as a share of the rev limit (0..1). */
  rpm: number;
  /** Seconds left of a gear change (no drive until then). */
  shift: number;
}

/** Revs (share of the limit) at `speed` in `gear`, with every gear's top speed × `ratio` (the setup's gears). */
export function revsAt(speed: number, gear: number, ratio = 1): number {
  return Math.max(0, speed) / (G.top[gear - 1] * ratio);
}

/**
 * How hard the engine pulls (share of full) at revs `r` in `gear`: weaker low
 * down (except in 1st, where the clutch slips to get going), full through the
 * middle, tailing off near the limit, and nothing at the limiter.
 */
export function pullAt(r: number, gear: number): number {
  if (r >= 1) return 0;
  if (r < G.fullFrom) return gear === 1 ? 1 : G.lowPull + ((1 - G.lowPull) * r) / G.fullFrom;
  if (r <= G.fullTo) return 1;
  return 1 - ((1 - G.limitPull) * (r - G.fullTo)) / (1 - G.fullTo);
}

/**
 * One tick of the gearbox. `request` is the player's shift (+1 up, -1 down,
 * 0 none; manual only). The automatic boxes change up past their up point
 * and down below their down point, one gear at a time. Only a change up cuts
 * the drive for a moment (down changes are blipped). A down change that
 * would over-rev the engine is refused. Nearly stopped, it drops to 1st.
 */
export function stepGearbox(gs: GearState, mode: GearboxMode, request: number, speed: number, dt: number, ratio = 1): void {
  gs.shift = Math.max(0, gs.shift - dt);
  if (Math.abs(speed) < 0.5) {
    gs.gear = 1;
    gs.shift = 0;
  } else if (mode === 'manual') {
    if (request > 0 && gs.gear < GEAR_COUNT) {
      gs.gear++;
      gs.shift = G.shiftTime;
    } else if (request < 0 && gs.gear > 1 && revsAt(speed, gs.gear - 1, ratio) < 1) {
      // Down changes are blipped: no break in the drive.
      gs.gear--;
    }
  } else if (gs.shift === 0) {
    const up = G.idealUp;
    const down = G.idealDown;
    const time = mode === 'auto' ? G.autoShiftTime : G.shiftTime;
    const r = revsAt(speed, gs.gear, ratio);
    if (r >= up && gs.gear < GEAR_COUNT) {
      gs.gear++;
      gs.shift = time;
    } else if (r < down && gs.gear > 1 && revsAt(speed, gs.gear - 1, ratio) < up - 0.05) {
      gs.gear--;
    }
  }
  gs.rpm = Math.min(1, revsAt(Math.abs(speed), gs.gear, ratio));
}

/** The engine's pull now (share of full): none while the automatic's gear goes in. */
export function enginePull(gs: GearState, speed: number, ratio = 1): number {
  return gs.shift > 0 ? 0 : pullAt(revsAt(speed, gs.gear, ratio), gs.gear);
}

/** The best gear for `speed`: the one the ideal box would be in. */
export function idealGear(speed: number): number {
  let g = 1;
  while (g < GEAR_COUNT && revsAt(speed, g) >= G.idealUp) g++;
  return g;
}
