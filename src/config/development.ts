/**
 * Car development in the career (career/carAreas.ts): what a team's three
 * areas do on track, what the player's parts are worth in the same units,
 * and how the rival teams develop through a season.
 */
export const DEVELOPMENT = {
  /**
   * Which areas make up each part of the physics' car. Grip comes from the
   * aero (downforce) and the chassis (mechanical grip, balance); engine pull
   * from the power unit and the chassis (traction); top speed from the power
   * unit and the aero (drag). Each set sums to 1.
   */
  weights: {
    grip: { aero: 0.6, chassis: 0.4 },
    pull: { powertrain: 0.75, chassis: 0.25 },
    top: { powertrain: 0.8, aero: 0.2 },
  },
  /**
   * A part's effect (engineering.ts PARTS: 0.012 to 0.028 for the four tiers)
   * times this is what it adds to its area, in rating points, on the car it's
   * fitted to. A whole tree in one area is then about 0.2 there; all three
   * trees in a season, about 0.2 overall (the field starts about 1 apart).
   */
  partScale: 2.5,
  /** A team's character: each area up to this much better or worse than its overall rating at the start. */
  character: 0.09,
  /**
   * Rival teams: about `season` overall rating points of development a
   * season, in `packages` packages (in a 16-round season; in proportion
   * otherwise), each `size` × its share. A team's engineering strength
   * scales it (`strength`, fixed per team); the last-placed team gets `atr`
   * more than the leader (more wind-tunnel time, as in the real rules). A
   * package goes to the team's weakest area `weakest` of the time; `flop` of
   * them don't work and bring only `flopShare` of what was hoped.
   */
  season: 0.05,
  packages: 4,
  size: [0.6, 1.4],
  strength: [0.75, 1.25],
  atr: 0.6,
  weakest: 0.6,
  flop: 0.15,
  flopShare: 0.2,
  /** Rival packages kept for the vehicle screen. */
  log: 40,
  /**
   * Projected lap times (career/circuitPace.ts): every car driven by the same
   * driver at this pace, so the gaps are the cars'. `probe` is the bump given
   * to one area to see how much a circuit rewards it.
   */
  referencePace: 0.95,
  probe: 0.05,
} as const;
