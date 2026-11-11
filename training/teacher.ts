import { NO_INPUT, type CarState, type DriveInput } from '../src/car/physics.ts';
import { inputToAction } from '../src/ai/actions.ts';
import { defaultIntent, type DrivingIntent } from '../src/ai/intents.ts';
import { LearnedDriver } from '../src/ai/learnedDriver.ts';
import type { Mlp } from '../src/ai/nn.ts';
import { Observer } from '../src/ai/observe.ts';
import { rng } from '../src/core/random.ts';
import { AiDriver } from '../src/race/ai.ts';
import { type RaceEvent } from '../src/race/session.ts';
import { dataset, type Dataset } from './bc.ts';
import { DrivingEnv, DT, type Agent } from './env.ts';
import { requireTrainingTrack, type TrackCase } from './trackCorpus.ts';

export function updateIntent(env: DrivingEnv, index: number, out: DrivingIntent): DrivingIntent {
  const a = env.agents[index];
  out.difficulty = a.spec.difficulty; out.racing = a.session.phase === 'racing'; out.countdown = a.session.phase === 'countdown';
  out.finished = a.session.phase === 'finished'; out.yellow = env.control.yellowAt(a.car.state.s);
  out.safetyCar = env.control.sc !== 'none'; out.speedLimit = env.cap(index);
  return out;
}

/** Shadow teacher owns separate physics and planner state: labels cannot move or boost the student car. */
class ShadowTeacher {
  readonly driver: AiDriver;
  private readonly events: RaceEvent[] = [];
  private readonly states: CarState[];
  private readonly index: number;
  rejectedResets = 0;
  constructor(env: DrivingEnv, index: number) {
    this.index = index;
    const a = env.agents[index];
    this.driver = new AiDriver(env.track, { name: 'label-only', paint: 0, difficulty: a.spec.difficulty, slot: index, laps: env.options.laps ?? 2 });
    this.states = [...env.states]; this.states[index] = this.driver.car.state;
  }
  label(env: DrivingEnv, a: Agent): Readonly<DriveInput> | null {
    const car = this.driver.car;
    car.state.copyFrom(a.car.state); car.prev.copyFrom(a.car.prev);
    car.wetness = a.car.wetness; car.draft = a.car.draft; car.setup = a.car.setup; car.tune = a.car.tune;
    this.driver.raceCap = env.cap(this.index); this.driver.yellow = env.control.yellowAt(a.car.state.s);
    const x = car.state.x, z = car.state.z;
    const input = this.driver.drive(this.states, DT);
    // The classic teacher must recognise its own shadow as itself in traffic.
    if (Math.hypot(car.state.x - x, car.state.z - z) > 3) { this.rejectedResets++; return null; }
    return input;
  }
  advance(a: Agent): void {
    this.events.length = 0; this.driver.session.step(a.before, a.now, this.events);
  }
}

export interface Collection {
  data: Dataset;
  episodes: { key: string; field: number; difficulty: number; beta: number; samples: number; simulatedSeconds: number; terminatedOffRoad: boolean; teacherResetLabelsRejected: number }[];
}

/** BC and DAgger share the exact same observation contract. Collection is restricted to the training split. */
export function collect(cases: readonly TrackCase[], seed: number, seconds: number, network?: Mlp, beta = 1): Collection {
  const data = dataset(), episodes: Collection['episodes'] = [];
  for (let episode = 0; episode < cases.length; episode++) {
    const entry = cases[episode]; requireTrainingTrack(entry);
    const track = entry.build(), field = episode % 3 === 2 ? 6 : 1, index = field - 1;
    const difficulty = [1, 0.75, 0.5, 1, 0.25, 1][episode % 6];
    const env = new DrivingEnv(track, Array.from({ length: field }, (_, k) => ({ brain: network && k === index ? 'external' as const : 'classic' as const, difficulty: k === index ? difficulty : Math.max(0.2, difficulty - k * 0.025), player: k === 0 && field > 1 })), { seed: seed + episode, laps: 2, seconds });
    const observer = new Observer(track), intent = defaultIntent(difficulty), previous = { ...NO_INPUT };
    const players = new Set(env.agents.filter((a) => a.spec.player).map((a) => a.car.state));
    const learned = network ? new LearnedDriver(track, network) : null;
    const teacher = network ? new ShadowTeacher(env, index) : null;
    const random = rng(seed + episode * 7919);
    let useTeacher = true, offFor = 0, terminated = false, labels = 0;
    const beforeSamples = data.inputs.length;
    while (!env.done) {
      const sample = env.tick % 4 === 0 && env.agents[index].session.canDrive && env.agents[index].session.phase !== 'finished';
      env.step((a, k) => {
        if (k !== index || !learned || !teacher) return NO_INPUT;
        const label = teacher.label(env, a);
        updateIntent(env, index, intent);
        if (sample && label) {
          data.inputs.push(observer.fill(a.car, env.states, previous, intent, players).slice());
          data.targets.push(inputToAction(label, new Float32Array(2)));
          labels++;
        }
        if (env.tick % 4 === 0) useTeacher = random() < beta;
        const student = learned.drive(a.car, env.states, DT, intent, players);
        return useTeacher && label ? label : student;
      }, (a, k) => {
        if (k !== index) return;
        if (!network && sample && !a.classic?.pitting && a.resets === 0) {
          updateIntent(env, index, intent);
          data.inputs.push(observer.fill(a.car, env.states, previous, intent, players).slice());
          data.targets.push(inputToAction(a.input, new Float32Array(2))); labels++;
        }
        Object.assign(previous, a.input);
      });
      teacher?.advance(env.agents[index]);
      if (learned) Object.assign(learned.input, env.agents[index].input);
      offFor = env.agents[index].car.state.offTrack ? offFor + DT : 0;
      // Ending a failed episode is explicit, rather than silently teleporting it into a successful trajectory.
      if (offFor > 4 || env.agents[index].car.broken) { terminated = true; break; }
    }
    episodes.push({ key: entry.key, field, difficulty, beta, samples: data.inputs.length - beforeSamples, simulatedSeconds: env.tick * DT, terminatedOffRoad: terminated, teacherResetLabelsRejected: teacher?.rejectedResets ?? 0 });
    if (labels === 0) throw new Error(`No usable teacher samples: ${entry.key}`);
  }
  return { data, episodes };
}
