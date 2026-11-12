import { AiDriver, aiPace } from '../../src/race/ai.ts';
import { CarPhysics } from '../../src/car/physics.ts';
import { collideCars } from '../../src/car/contact.ts';
import { getSampleTrack } from '../../src/editor/pipeline.ts';
import { RacingDriver } from '../../src/race/driver.ts';
import { brakingBends } from './traffic.ts';

/** A real-physics duel; the player never reads the AI's tactic or teleports after the start. */
export function cornerDuel(si: number, start: number, style: 'inside' | 'wide-exit') {
  const DT = 1 / 120, track = getSampleTrack(si);
  const bot = new AiDriver(track, { name: 'duel', paint: 0, difficulty: 0.9, laps: 3, slot: 0 });
  bot.session.phase = 'racing';
  const driver = (bot as unknown as { driver: RacingDriver }).driver;
  const bend = brakingBends(track, driver)[0], side = driver.curvatureAt(bend.apex) < 0 ? 1 : -1;
  const player = new CarPhysics(track), playerDriver = new RacingDriver(track, aiPace(0.9, track)), s0 = bend.brake - 65;
  bot.car.placeAt(s0, -side * 3.5); player.placeAt(s0 + start, side * 3.5);
  for (const car of [bot.car, player]) {
    const t = track.center.tangents[Math.max(0, car.state.trackIndex)], v = driver.speedAt(s0);
    Object.assign(car.state, { vx: t.x * v, vz: t.y * v, speed: v }); car.prev.copyFrom(car.state);
  }
  const states = [bot.car.state, player.state], actions: Record<string, number> = {}, trace = [], incidents = [];
  let contacts = 0, hardest = 0, off = 0, resets = 0, previousContact = false, peakOverlapSeconds = 0, alongside = 0, finalGap = 0;
  const along = (a: number, b: number) => ((b - a) % track.center.length + track.center.length * 1.5) % track.center.length - track.center.length / 2;
  for (let tick = 0; tick < 15 * 120; tick++) {
    const st = bot.car.state, beforeX = st.x, beforeZ = st.z;
    const input = bot.drive(states, DT);
    if (Math.hypot(st.x - beforeX, st.z - beforeZ) > 3) resets++;
    bot.car.step(input);
    const route = (s: number) => {
      const inside = playerDriver.lateralAt(s, side * 99) - side * 0.6;
      if (style === 'inside') return inside;
      const outside = playerDriver.lateralAt(s, -side * 99) + side * 0.6;
      const u = Math.max(0, Math.min(1, (along(bend.apex, s) + 5) / 38));
      return inside + (outside - inside) * u * u * (3 - 2 * u);
    };
    player.step(playerDriver.drive(player.state, 0, undefined, { route, late: style === 'wide-exit' }));
    let hit = 0;
    for (let pass = 0; pass < 3; pass++) hit = Math.max(hit, collideCars(states[0], states[1]));
    if (hit > 0 && !previousContact) { contacts++; incidents.push({ t: tick * DT, hit, action: bot.racecraft ?? 'racing-line', gap: along(st.s, player.state.s), lat: st.lateral, playerLat: player.state.lateral, speed: st.speed, playerSpeed: player.state.speed }); }
    previousContact = hit > 0; hardest = Math.max(hardest, hit);
    if (st.offTrack) off += DT;
    finalGap = along(st.s, player.state.s);
    alongside = Math.abs(finalGap) < 4.2 && Math.abs(player.state.lateral - st.lateral) > 1.9 ? alongside + DT : 0;
    peakOverlapSeconds = Math.max(peakOverlapSeconds, alongside);
    const action = bot.racecraft ?? 'racing-line'; actions[action] = (actions[action] ?? 0) + 1;
    if (tick % 30 === 0) trace.push({ t: tick * DT, action, ds: finalGap, lat: st.lateral, playerLat: player.state.lateral, toApex: along(st.s, bend.apex), speed: st.speed });
    if (along(bend.apex, st.s) > 75) break;
  }
  return { track: track.def.name, start, style, actions, contacts, hardest, off, resets, peakOverlapSeconds, finalGap, trace, incidents };
}
