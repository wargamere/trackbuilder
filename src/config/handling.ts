/**
 * Every car-handling tuning constant. Units: metres, seconds, radians.
 * Accelerations are in m/s² (9.81 = 1 g).
 */
export const HANDLING = {
  /** Physics runs at this fixed rate, whatever the display refresh rate. */
  tickRate: 120,

  // ---------------------------------------------------------- engine & brakes
  /** Engine acceleration from standstill; it fades linearly to 0 at `maxSpeed`. */
  engineAccel: 15,
  /** Speed where the engine stops pulling (top speed ends up a bit lower, from drag). */
  maxSpeed: 58,
  brakeDecel: 24,
  reverseAccel: 7,
  reverseMaxSpeed: 11,
  /** Constant rolling resistance. */
  rollingDrag: 0.4,
  /** Aerodynamic drag factor: deceleration = aeroDrag × speed². */
  aeroDrag: 0.0012,
  /** Extra slowing when coasting (no throttle, no brake). */
  engineBraking: 1.6,

  // ----------------------------------------------------------------- steering
  /** Front-wheel angle at a standstill. */
  maxSteerAngle: 0.6,
  /** Steering lock shrinks with speed: limit = maxSteerAngle / (1 + speed / steerFalloff). */
  steerFalloff: 15,
  /** How fast the wheels turn towards the input, and back to centre. */
  steerRate: 3.0,
  steerReturnRate: 5.0,
  wheelBase: 2.6,
  /** How quickly the car's rotation follows the steering (1/s). */
  yawResponse: 9,

  // --------------------------------------------------------------------- grip
  /** How quickly sideways sliding dies away (1/s). Lower = more drift. */
  gripRate: 8,
  /** The most sideways acceleration the tyres can produce. */
  maxLateralAccel: 18,
  /** The car may rotate this much faster than grip allows, which gives a slight, controllable drift. */
  yawOvershoot: 1.15,

  // ---------------------------------------------------------------- handbrake
  handbrakeGripRate: 1.3,
  handbrakeYawBoost: 1.7,
  handbrakeDecel: 5,

  // -------------------------------------------------------------------- grass
  grass: {
    /** Engine stops pulling at maxSpeed × this. */
    speedFactor: 0.4,
    accelFactor: 0.6,
    /** Extra rolling drag on grass. */
    drag: 3.5,
    /** Grip and lateral acceleration are multiplied by this. */
    gripFactor: 0.45,
  },

  // ------------------------------------------------------------------- bodies
  /** Collision radius of the car (against tree trunks). */
  carRadius: 1.1,
  /** Half the distance between left and right wheels (for the on-grass test). */
  halfTrack: 0.85,
  wheelRadius: 0.36,
  /** The car can't leave this square around the origin. */
  worldLimit: 900,
} as const;

export const INPUT = {
  /** Gamepad stick dead zone (the rest of the range is rescaled to 0..1). */
  stickDeadZone: 0.15,
  triggerDeadZone: 0.05,
} as const;

export const CAMERA = {
  chase: {
    distance: 7.2,
    /** Extra distance per m/s of speed. */
    distancePerSpeed: 0.035,
    height: 3.0,
    lookAhead: 3.5,
    lookHeight: 1.1,
    /** How fast the camera swings round behind the car (1/s). */
    yawFollow: 5.5,
    fov: 62,
    fovPerSpeed: 0.22,
    fovMax: 74,
  },
  bonnet: {
    forward: 1.0,
    height: 1.18,
    fov: 72,
  },
} as const;
