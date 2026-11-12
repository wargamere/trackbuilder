import { CarPhysics, STANDARD_CAR, type CarPerformance } from '../../src/car/physics.ts';
import { collideCars } from '../../src/car/contact.ts';
import { slipstream } from '../../src/car/slipstream.ts';
import { AiDriver, aiPace } from '../../src/race/ai.ts';
import { RacingDriver } from '../../src/race/driver.ts';
import { carPace, roadPace } from '../../src/race/racingLine.ts';
import { suggestedSetup } from '../../src/race/strategy.ts';
import { along } from '../../src/race/traffic.ts';
import type { Track } from '../../src/track/track.ts';
import { brakingBends } from './traffic.ts';

/** A player who follows its own line and leaves room for an observed overlap;
 * it never reads the AI's chosen tactic. No position resets after the start. */
export function approachBattle(track: Track, options: { mode: 'attack' | 'defend'; gap?: number; record?: boolean; playerDifficulty?: number; exit?: number; approach?: number; playerHardware?: Readonly<CarPerformance> }) {
  const { mode, gap = 14, record = false, playerDifficulty = mode === 'attack' ? .85 : 1, exit = 400, approach = 260, playerHardware = STANDARD_CAR } = options;
  const bot = new AiDriver(track, { name: 'Rival', paint: 0, difficulty: 1, laps: 3, slot: 0 });
  const driver = new RacingDriver(track, roadPace(carPace(aiPace(1, track), suggestedSetup(track)), track));
  const bend = brakingBends(track, driver)[0];
  if (!bend) throw new Error(`No braking corner on ${track.def.name}`);
  const player = new CarPhysics(track); player.setup = suggestedSetup(track);
  player.tune = playerHardware;
  const pd = new RacingDriver(track, roadPace(carPace(aiPace(playerDifficulty, track), player.setup, playerHardware), track));
  bot.session.phase = 'racing';
  const origin = bend.brake - approach, L = track.center.length;
  for (const [car, d, s] of [[bot.car, driver, origin], [player, pd, origin + (mode === 'attack' ? gap : -gap)]] as const) {
    car.placeAt(s, d.lateralAt(s));
    const a = d.pointAt(s - 1), b = d.pointAt(s + 1), heading = Math.atan2(b.z - a.z, b.x - a.x), v = d.speedAt(s);
    Object.assign(car.state, { heading, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v, speed: v }); car.prev.copyFrom(car.state);
  }
  // This is a rolling duel, not a grid launch: clear the constructor's grid lane.
  const rolling = bot as unknown as {lane: number; planner: {choice: {offset: number}}};
  rolling.lane = 0; rolling.planner.choice = {offset: 0};
  const states = [bot.car.state, player.state], drafts = new Float32Array(2), actions: Record<string, number> = {};
  const trace: { t: number; toBrake: number; toApex: number; v: number; playerV: number; gap: number; lat: number; playerLat: number; limit: number; routeLimit: number; throttle: number; brake: number; action: string }[] = [];
  let contacts = 0, hard = 0, off = 0, lastHit = false, alongside = 0, peakAlongside = 0, finalGap = gap, minGap = gap;
  for (let tick = 0; tick < 120 * 20; tick++) {
    const me = states[0], human = states[1];
    slipstream(states, L, drafts); bot.car.draft = drafts[0]; player.draft = drafts[1];
    const input = bot.drive(states, 1 / 120); bot.car.step(input);
    if (record && tick % 15 === 0) {
      const route = (bot as unknown as {planner: {coverPath(): ((s:number)=>number) | null}}).planner.coverPath();
      trace.push({ t: tick / 120, toBrake: along(me.s, bend.brake, L), toApex: along(me.s, bend.apex, L), v: me.speed, playerV: human.speed, gap: along(me.s, human.s, L), lat: me.lateral, playerLat: human.lateral, limit: driver.limitAt(me.s), routeLimit: route ? driver.pathLimit(me.s, route) : 0, throttle: input.throttle, brake: input.brake, action: bot.racecraft });
    }
    const ds = along(human.s, me.s, L), side = me.lateral - human.lateral;
    const keep = Math.abs(ds) < 8.5 && Math.abs(side) > 1.2 ? side > 0 ? { lo: -Infinity, hi: me.lateral - 2.8 } : { lo: me.lateral + 2.8, hi: Infinity } : null;
    const cap = ds > 0 && ds < 18 && Math.abs(side) < 2.8 ? Math.max(0, me.speed + (ds - 9) * .8) : Infinity;
    player.step(pd.drive(human, 0, undefined, { keep, cap }));
    let hit = 0;
    for (let pass = 0; pass < 3; pass++) hit = Math.max(hit, collideCars(me, human));
    if (hit > 0 && !lastHit) contacts++;
    if (hit > 2 && !lastHit) hard++;
    lastHit = hit > 0; if (me.offTrack || human.offTrack) off++;
    const action = bot.racecraft; actions[action] = (actions[action] ?? 0) + 1;
    finalGap = along(me.s, human.s, L); minGap = Math.min(minGap, finalGap);
    alongside = Math.abs(finalGap) < 4.2 && Math.abs(side) > 1.9 ? alongside + 1 / 120 : 0; peakAlongside = Math.max(peakAlongside, alongside);
    if (along(bend.apex, me.s, L) > exit && along(bend.apex, me.s, L) < L / 3) break;
  }
  return { track: track.def.id, mode, actions, finalGap, minGap, contacts, hard, off, peakAlongside, ...(record ? {trace} : {}) };
}
