import type { CarState } from '../car/physics.ts';
import { CONTACT, RACECRAFT, TRAFFIC } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import type { RacingDriver } from './driver.ts';

export type RacecraftAction = 'racing-line' | 'defend-inside' | 'attack-inside' | 'attack-outside' | 'hold-outside' | 'switchback' | 'exit-attack';
export interface CornerApproach { brake: number; apex: number; side: number }
export interface Rival { car: CarState; ds: number; lat: number; v: number; drift: number; ai: boolean; pace?: number | null }
interface Battle {
  action: RacecraftAction;
  rival: CarState;
  me: CarState;
  side: number;
  from: number;
  startLat: number;
  brake: number;
  apex: number;
  exit: number;
  turnFrom: number;
  turnLat: number;
  entryOffset: number;
}
const distance = (a: number, b: number, length: number) => ((b - a) % length + length * 1.5) % length - length / 2;
const forward = (a: number, b: number, length: number) => ((b - a) % length + length) % length;
const smooth = (u: number) => { const x = clamp(u, 0, 1); return x * x * (3 - 2 * x); };

/** A committed corner tactic above lane selection; it still uses the real path's grip/braking limits. */
export class Racecraft {
  private readonly driver: RacingDriver;
  private readonly length: number;
  private readonly pace: number;
  private battle: Battle | null = null;
  private lastApex = NaN;
  private cooldown = 0;
  constructor(driver: RacingDriver, length: number, pace = 1) { this.driver = driver; this.length = length; this.pace = pace; }

  get action(): RacecraftAction { return this.battle?.action ?? 'racing-line'; }
  get target(): CarState | null { return this.battle?.rival ?? null; }
  get active(): boolean { return this.battle !== null; }

  /** Stable function identity: no new steering-path closure each physics tick. */
  readonly path = (s: number): number => {
    const b = this.battle, d = this.driver;
    if (!b) return d.lateralAt(s);
    const at = forward(b.from, b.me.s, this.length) + distance(b.me.s, s, this.length), apex = b.apex - b.from;
    const inside = d.lateralAt(s, b.side * RACECRAFT.exitOffset);
    // The fastest line within our reserved outside corridor, rather than the slowest
    // possible route around the outer edge. The overlap guard below supplies the room.
    const outside = d.lateralAt(s);
    let lat: number;
    if (b.action === 'switchback' || b.action === 'exit-attack') {
      // Cross behind a car that has gone past, never across a car alongside. A late apex buys exit drive.
      const turn = at - forward(b.from, b.turnFrom, this.length);
      lat = b.turnLat + (inside - b.turnLat) * smooth(turn / RACECRAFT.cutbackLength);
    } else {
      const approach = Math.max(RACECRAFT.minBlend, b.brake - b.from);
      // Claim the entry, then round the corner towards its normal apex. Keeping
      // the maximum lane offset right to the apex creates a tight, slow kink.
      if (b.action === 'attack-inside' || b.action === 'attack-outside') {
        const off0 = b.startLat - d.lateralAt(b.from);
        const entry = (off0 + (b.entryOffset - off0) * smooth(at / approach)) * (1 - smooth((at - approach) / Math.max(12, apex - approach)));
        lat = d.lateralAt(s, entry);
      } else lat = b.startLat + (outside - b.startLat) * smooth(at / approach);
    }
    // Keep the chosen side through the apex. Rejoin progressively on the exit, with keepOut still binding.
    const release = b.action === 'switchback' || b.action === 'exit-attack' ? RACECRAFT.cutbackRelease : RACECRAFT.releaseFrom;
    lat += (d.lateralAt(s) - lat) * smooth((at - apex - release) / RACECRAFT.exitBlend);
    const ds = distance(b.me.s, b.rival.s, this.length);
    if (Math.abs(ds) < 2 * CONTACT.halfLength + TRAFFIC.keepReach && Math.abs(b.rival.y - b.me.y) < CONTACT.heightGap) {
      // Reserve the same space as keepOut in the path *and* in collision prediction. Otherwise a
      // feasible outside overlap is rejected merely because the solo line later sweeps inward.
      const room = 2 * CONTACT.halfWidth + TRAFFIC.keepGapHuman + TRAFFIC.bendMargin * Math.abs(d.curvatureAt(b.me.s));
      const side = Math.sign(b.me.lateral - b.rival.lateral);
      if (side < 0) lat = Math.min(lat, Math.max(b.rival.lateral - room, b.me.lateral));
      else if (side > 0) lat = Math.max(lat, Math.min(b.rival.lateral + room, b.me.lateral));
    }
    return lat;
  };

  cancel(): void { this.battle = null; }
  reject(): void { this.battle = null; this.cooldown = RACECRAFT.retryAfter; }

  /** Choose from observed overlap, closing speed, available road and the next corner; no random lane changes. */
  plan(me: CarState, rivals: readonly Rival[], corner: CornerApproach | null, started: boolean, enabled: boolean): void {
    const C = RACECRAFT;
    this.cooldown = Math.max(0, this.cooldown - 1 / 30);
    if (distance(me.s, this.lastApex, this.length) < -C.cutbackRelease - C.exitBlend) this.lastApex = NaN;
    if (!enabled || me.inPits || me.offTrack || Math.abs(me.slip) > Math.max(C.maxSlip, Math.abs(me.speed) * C.maxSlipRatio) || me.speed < C.minSpeed) { this.cancel(); return; }
    const b = this.battle;
    if (b) {
      const rival = rivals.find((o) => o.car === b.rival);
      const travelled = forward(b.from, me.s, this.length);
      if (!rival || rival.car.inPits || Math.abs(rival.ds) > C.dropDistance || travelled > b.exit - b.from) { this.cancel(); return; }
      // Once a rival has cleared our nose, its move back out opens a real inside exit lane.
      // Requiring both longitudinal clearance and lateral room prevents the switchback becoming a side-swipe.
      const toApex = b.apex - b.from - travelled;
      if ((b.action === 'hold-outside' || b.action === 'attack-outside') && toApex < C.cutbackBefore && toApex > -C.cutbackAfter && rival.ds > 2 * CONTACT.halfLength + C.crossBehind && rival.ds < C.cutbackGap) {
        const inside = this.driver.lateralAt(b.apex + C.lateApex, b.side * 99) - b.side * C.edgeMargin;
        const opening = (rival.lat - inside) * -b.side;
        const movingOut = rival.drift * b.side < -C.outwardDrift || rival.lat * b.side < C.insideOccupied;
        if (opening > 2 * CONTACT.halfWidth + C.sideGap && movingOut && this.clear(me, rivals, inside, rival.car)) {
          b.action = 'switchback'; b.turnFrom = me.s; b.turnLat = me.lateral;
          b.exit = b.apex + C.cutbackRelease + C.exitBlend;
        }
      } else if (b.action === 'switchback' && toApex < -C.lateApex) b.action = 'exit-attack';
      // Don't cling to a wide route once we've won a full car length; the regular planner can use the exit.
      if (rival.ds < -C.wonBy && toApex < -C.releaseFrom) this.cancel();
      return;
    }
    if (this.cooldown > 0 || !corner || corner.apex > C.lookahead) return;
    // No fresh moves after turn-in: hold the room we've already earned instead of inventing a late dive.
    const side = corner.side;
    const apexAt = me.s + corner.apex;
    const width = this.driver.lateralAt(apexAt, 99) - this.driver.lateralAt(apexAt, -99);
    const room = 2 * CONTACT.halfWidth + TRAFFIC.keepGapHuman + TRAFFIC.bendMargin * Math.abs(this.driver.curvatureAt(apexAt));
    if (width < room + RACECRAFT.edgeMargin) return;
    let rival: Rival | null = null;
    for (const o of rivals) {
      if (o.car.inPits || o.ds < -C.rearRange || o.ds > C.attackRange || o.v < C.minSpeed) continue;
      // Keep the launch pack's existing lane safety. A player duel can begin immediately.
      if (o.ai && !started) continue;
      // Preserve the established let-by/passing contract for AI cars of clearly different pace.
      if (o.ai && o.pace != null && Math.abs(o.pace - this.pace) > TRAFFIC.letByPace) continue;
      if (!rival || Math.abs(o.ds) < Math.abs(rival.ds)) rival = o;
    }
    if (!rival) return;
    const across = (me.lateral - rival.lat) * side, overlapped = Math.abs(rival.ds) < 2 * CONTACT.halfLength + C.overlapMargin;
    const insideOccupied = (rival.lat - me.lateral) * side > C.sideGap;
    const approachTime = corner.brake / Math.max(8, me.speed);
    const outsideOverlap = across < -C.sideGap && overlapped;
    // An overlap earned during braking is still worth contesting. This only
    // holds an existing outside lane; fresh dives still require time to move.
    if (!outsideOverlap && (corner.apex < C.minCornerDistance || corner.brake < C.minEntryDistance || Math.abs(distance(this.lastApex, me.s + corner.apex, this.length)) < C.sameCorner)) return;
    let action: RacecraftAction;
    let entryOffset = side * C.attackOffset;
    if (across < -C.sideGap && (overlapped || (rival.ds > 0 && rival.ds < C.switchbackRange && insideOccupied))) {
      // Already outside: don't abandon a legitimate overlap just because the solo line turns inward.
      action = 'hold-outside';
    } else if (rival.ds >= -CONTACT.halfLength && rival.ds <= C.attackRange && across > 2 * CONTACT.halfWidth + C.sideGap && approachTime < C.attackLead && me.speed >= rival.v - C.speedTolerance) {
      // A later corner's braking zone may be visible while we're still turning through
      // the current one. Settle the car first; don't start a fresh dive across a chicane.
      if (Math.abs(this.driver.curvatureAt(me.s)) > C.attackCurve || Math.abs(me.slip) > C.attackSlip) return;
      action = 'attack-inside';
    } else if (!rival.ai && rival.ds > 2 * CONTACT.halfLength + C.crossBehind && approachTime >= C.setupTime && approachTime <= C.setupLead && me.speed >= rival.v - C.speedTolerance && Math.abs(this.driver.curvatureAt(me.s)) <= C.attackCurve && me.slip <= C.attackSlip) {
      // Set a pass up from the tow. Previously an attack was possible only
      // after the AI was already several metres to the inside of the player.
      const sB = me.s + corner.brake;
      const rivalEntry = this.driver.lateralAt(sB, rival.lat - this.driver.lateralAt(rival.car.s));
      const clearance = 2 * CONTACT.halfWidth + C.sideGap;
      const offsetNow = me.lateral - this.driver.lateralAt(me.s);
      const candidates = [side * C.setupOffset, -side * C.setupOffset];
      const chosen = candidates.find(offset => {
        const target = this.driver.lateralAt(sB, offset);
        const travel = Math.abs(offset - offsetNow), time = Math.sqrt(6 * travel / TRAFFIC.laneAccel);
        const closing = Math.max(.1, me.speed - rival.v);
        const loss = this.driver.laneTimeLost(sB, offset, corner.apex - corner.brake + 40);
        return loss <= C.maxAttackLoss + Math.max(0, me.speed - rival.v) * .1 && Math.abs(target - rivalEntry) >= clearance && time <= approachTime && (rival.ds - 2 * CONTACT.halfLength) / closing > time * .7 && this.clear(me, rivals, target, rival.car);
      });
      if (chosen === undefined) return;
      entryOffset = chosen;
      action = chosen * side > 0 ? 'attack-inside' : 'attack-outside';
    } else return;
    const target = this.driver.lateralAt(me.s + corner.brake, action === 'attack-inside' || action === 'attack-outside' ? entryOffset : -side * 99);
    if (!this.clear(me, rivals, target, rival.car)) return;
    this.lastApex = me.s + corner.apex;
    this.battle = { action, rival: rival.car, me, side, from: me.s, startLat: me.lateral, brake: me.s + corner.brake, apex: me.s + corner.apex, exit: me.s + corner.apex + C.releaseFrom + C.exitBlend, turnFrom: me.s, turnLat: me.lateral, entryOffset };
  }

  private clear(me: CarState, rivals: readonly Rival[], lateral: number, target: CarState): boolean {
    return !rivals.some((o) => o.car !== target && Math.abs(o.ds) < RACECRAFT.thirdCarRange && Math.abs(o.lat - lateral) < 2 * CONTACT.halfWidth + RACECRAFT.sideGap && (lateral - me.lateral) * (o.lat - me.lateral) > 0);
  }
}
