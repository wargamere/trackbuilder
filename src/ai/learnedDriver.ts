import { NO_INPUT, type CarPhysics, type CarState, type DriveInput } from '../car/physics.ts';
import type { Track } from '../track/track.ts';
import { actionToInput } from './actions.ts';
import { POLICY } from './config.ts';
import type { DrivingIntent } from './intents.ts';
import type { Mlp, Workspace } from './nn.ts';
import { Observer } from './observe.ts';

/** Experimental controller. It never calls RacingDriver, TrafficPlanner, or a teacher action. */
export class LearnedDriver {
  readonly observer: Observer;
  readonly input: DriveInput = { ...NO_INPUT };
  readonly network: Mlp;
  private readonly workspace: Workspace;
  private untilPolicy = 0;
  decisions = 0;

  constructor(track: Track, network: Mlp) {
    this.observer = new Observer(track); this.network = network; this.workspace = network.workspace();
  }
  drive(car: CarPhysics, cars: readonly CarState[], dt: number, intent: DrivingIntent, players?: ReadonlySet<CarState>): DriveInput {
    if (intent.countdown) { this.untilPolicy = 0; Object.assign(this.input, NO_INPUT); return this.input; }
    this.untilPolicy -= dt;
    if (this.untilPolicy <= 1e-8) {
      this.untilPolicy = 1 / POLICY.hz;
      const observation = this.observer.fill(car, cars, this.input, intent, players);
      actionToInput(this.network.forward(observation, this.workspace), this.input);
      this.decisions++;
    }
    return this.input;
  }
  reset(): void { this.untilPolicy = 0; Object.assign(this.input, NO_INPUT); }
}
