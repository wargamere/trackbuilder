# Learned driving migration

This is a staged replacement of opponent driving, not a rename of the classic rules. The deployed game remains on the classic brain until the final acceptance report passes. Medal laps, preview cars, assists, physics and the classic teacher stay unchanged in behaviour.

## Baseline and evidence

Base this work on the latest deployed default branch, `c2e1349e81905d7122fb9bebde210e7b550944e0`. `main` is older and lacks the owner's custom 24-car grid. The migration must cover both the brief's 20-car benchmark and the current 24-car championship.

The supplied 61.47-second recording shows P24 initially, P21 at video time 6 seconds, P12 at 12 seconds and P11 at 16 seconds. These are video timestamps, not times since the lights. It does not record difficulty, setup or exact controls, so it is qualitative evidence rather than an exact input replay.

The classic source deliberately multiplies pace by `1 - .005 * gridSlot` over the first 500 race metres: 11.5% less for slot 23. Traffic following and crowd caution may compound that effect. Measure launch speed, positions after the first corner, contact and resets before attributing the entire gain to one cause. Preserve these rules in the classic teacher; do not encode grid-slot penalties in learned actions or rewards.

## Phases and release gates

0. A deterministic multi-car environment using the actual game systems, a seeded track corpus with enforced splits, baseline reports and timing benchmarks. Commit this phase separately.
1. A real neural policy and training path: supervised cloning, then at least three DAgger iterations. Export resumable checkpoints and actual measured candidate reports. Failure to meet a gate is reported, never hidden by calling the teacher from the policy.
2. PPO with GAE, starting from cloning weights, initially solo. Gradient-check the training code before long runs. Keep the teacher penalty early and anneal it.
3. Shared-policy self-play with frozen snapshots, classic opponents and human stand-ins, measuring starts, duels, lapping and player contact.
4. Conditions, surfaces, bridges, recovery, pit queues and deliberately awkward generated layouts.
5. Difficulty calibration, int8 export, browser parity, full acceptance report and only then promotion to the default.

This initial migration increment prioritises phase 0 and the cloning pipeline. It does not claim that short warm-start training satisfies the final gates, and does not enable experimental weights for ordinary players.

## Algorithms

Use a pure TypeScript MLP, two tanh hidden layers of 128 units, with steering and signed longitudinal-action outputs. Throttle is the positive longitudinal output; brake is its negative. Add a value head for PPO only when phase 2 is implemented. Start at 30 policy decisions per second and hold actions across four 120 Hz physics ticks. Use seeded rollouts, Adam, global gradient clipping, and frozen observation statistics. No new runtime dependencies.

Behaviour cloning minimises action MSE with a steer-weighted loss; DAgger labels states visited by the current policy, without silently substituting teacher actions in evaluation. Keep teacher-labelled data and each aggregated rollout identifiable in checkpoints.

References: [DAgger](https://arxiv.org/abs/1011.0686), [PPO](https://arxiv.org/abs/1707.06347). These describe the algorithms, not evidence that this game's policy has passed any gate.

## Observation contract

Version and hash the exact ordered feature names. All policy observations are ego-centric or track-relative, clipped/normalised, and independent of global coordinates or track identity.

| Group | Inputs |
| --- | --- |
| Own dynamics | Forward/lateral velocity, yaw, slip, sin/cos heading error, offset and road-edge distances, gear/revs/steer, previous action, track limits, barrier impact |
| Conditions | Wetness, tyre grip/brake scale, wing/body damage, car tune, setup, surface, slipstream |
| Raw track | Samples behind and 5–220 m ahead: curvature, road widths, bank, grade, local position and tangent, surface grip |
| Other cars | Eight nearest cars at the same elevation: presence, signed gap, lateral offset, relative velocities/heading, player/pit flags and relative race progress |
| Race/intents | Skill, started/finished, laps left, yellow flag, speed cap and its presence, pit call, box distance, optional pit-route targets |

Neither the classic racing line's offset nor its speed plan is a feature. Pit-route targets are permitted only while the strategist has called a stop. Other cars above a bridge are excluded using the game's existing height separation.

## Simulator and corpus

Reuse CarPhysics, RaceSession, collideCars with three separation passes, slipstream, RaceControl, WeatherState and PitCrew. Record per-car progress, lap validity, impacts, off-road time, retirements and marshal resets. A reset must be counted as a failure; it must not become reward for additional progress. The same seed and action sequence must replay exactly.

Training contains game-authored layouts and procedural tracks from all six generator styles, with varied legal options. Validation uses separate procedural seeds. Acceptance holds out all real circuits and a fixed set of 50 procedural seeds. Australia is already a diagnostic track from the user's recording; mark it as inspected and report it separately. Do not tune against untouched acceptance seeds. Generate the large corpus lazily rather than materialising thousands of heavy tracks in memory.

## Reward plan for later PPO phases

Per second: forward progress / 20, time cost -0.05, off-track -1, wrong way -1, control-change squared -0.01. Barrier impacts cost impact speed / 5; terminal breakdown -20; marshal reset -20. Remove reset displacement from progress. Racing adds checkpoint position changes, final classification, and fault-weighted contact penalties; contact with the human stand-in receives an additional penalty. These are starting research values, not production tuning or completed training claims.

## Measurement and promotion

Reports identify source revision, seed, track split, field size, difficulty, conditions, policy/checkpoint and wall time. Quick reports are diagnostics; they do not pass full gates. Missing metrics are `not measured`, not zero. A requested learned evaluation without valid weights must fail explicitly rather than quietly benchmark classic.

Final gates remain those in the brief: held-out pace, valid laps, all-car finishing, contact/fairness, pit stops, safety car, conditions, calibration, generalisation and runtime budget. Measure 20 and 24 cars. Target <=0.5 ms AI time per 120 Hz tick for 19 AI cars and <=600 KB exported weights. Export a manifest with observation hash, algorithm/run/seed, quantisation, calibration and promotion status. Never set the default from training loss alone.
