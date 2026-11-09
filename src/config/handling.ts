/**
 * Every car-handling tuning constant. Units: metres, seconds, radians.
 * Accelerations are in m/s² (9.81 = 1 g).
 */
export const HANDLING = {
  /** Physics runs at this fixed rate, whatever the display refresh rate. */
  tickRate: 120,

  // ---------------------------------------------------------- engine & brakes
  /**
   * In another car's slipstream (draft 1 = right on its bumper): the air
   * resistance is cut by this share, the engine keeps pulling this much past
   * its usual top end, and the tow adds this push (m/s², fading out at that
   * raised top end), so a car in a tow can go faster than it could alone.
   */
  slipstreamDragCut: 0.75,
  slipstreamTopSpeed: 0.12,
  slipstreamPush: 1.2,
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

  // ------------------------------------------------------------------ gearbox
  /**
   * Six gears. The engine pulls fully through the middle of the revs and less
   * at low revs and near the limiter (none at it). Changing at the right revs
   * gives the pull of `engineAccel` above, so the AI's speed plans still hold.
   * Manual and AI changes are instant; the automatic's changes up cut the
   * drive for a moment, which is what makes it a little slower.
   */
  gearbox: {
    /** Speed (m/s) at the rev limit in each gear, 1st to 6th. */
    top: [13, 20, 27, 35, 45, 58],
    /** Pull (share of full) at idle; full from `fullFrom` to `fullTo` of the rev limit; `limitPull` just under the limit. */
    lowPull: 0.55,
    fullFrom: 0.5,
    fullTo: 0.9,
    limitPull: 0.8,
    /** Revs (share of the limit) to change up and down at, for the AI's box and the automatic gearbox alike. */
    idealUp: 0.9,
    idealDown: 0.5,
    /** The shift light comes on from here (a manual change up from here on loses nothing). */
    shiftLight: 0.88,
    /**
     * Seconds without drive while a gear goes up: none for a manual (or AI)
     * change, a moment for the automatic's (what makes it a little slower).
     */
    shiftTime: 0,
    autoShiftTime: 0.2,
  },

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
    /** How rough it feels (rumble sound and camera shake). */
    rough: 1,
  },
  /** Gravel traps beside the road (TrackOptions.runoff): slower than grass. */
  gravel: { speedFactor: 0.3, accelFactor: 0.45, drag: 6.5, gripFactor: 0.4, rough: 1.4 },
  /** Tarmac run-off: drives like the road, just without the kerbs. */
  tarmac: { speedFactor: 1, accelFactor: 1, drag: 0, gripFactor: 1, rough: 0 },
  /** The road itself. */
  road: { speedFactor: 1, accelFactor: 1, drag: 0, gripFactor: 1, rough: 0 },
  /**
   * What the road is made of (TrackOptions.road): how much of the tyres' grip
   * it gives in corners, how hard the brakes bite, how hard the engine can
   * pull, and how rough it feels. The AI and the medal laps plan with the same.
   */
  roads: {
    tarmac: { grip: 1, brake: 1, accel: 1, rough: 0 },
    dirt: { grip: 0.76, brake: 0.74, accel: 0.86, rough: 0.3 },
    snow: { grip: 0.58, brake: 0.56, accel: 0.68, rough: 0.12 },
  },

  // ------------------------------------------------------- slopes and banking
  /** Share of gravity along a slope that acts on the car (1 = full physics, lower = more arcade). */
  slopeFactor: 0.8,
  /** Share of the bank's help in corners (g·sin(bank) × this). */
  bankGripFactor: 1.2,

  // ------------------------------------------------------------------- walls
  /** Bounce off a barrier (share of the impact speed). */
  wallBounce: 0.25,
  /** Speed lost per m/s of impact, and the least speed kept. */
  wallScrub: 0.04,
  wallMinKeep: 0.55,
  /** Half the car's body width (keeps the body, not the centre, off the barrier). */
  halfWidth: 1.0,

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
