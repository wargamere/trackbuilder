import type { DriveInput } from '../car/physics.ts';

export function actionToInput(action: ArrayLike<number>, out: DriveInput): DriveInput {
  const steer = Number.isFinite(action[0]) ? Math.max(-1, Math.min(1, action[0])) : 0;
  const longitudinal = Number.isFinite(action[1]) ? Math.max(-1, Math.min(1, action[1])) : 0;
  out.steer = steer;
  out.throttle = Math.max(0, longitudinal);
  out.brake = Math.max(0, -longitudinal);
  out.handbrake = false;
  out.shift = undefined;
  return out;
}
export function inputToAction(input: Readonly<DriveInput>, out: Float32Array): Float32Array {
  out[0] = Math.max(-1, Math.min(1, input.steer));
  out[1] = Math.max(-1, Math.min(1, input.throttle - input.brake));
  return out;
}
