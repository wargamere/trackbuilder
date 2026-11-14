# Codex task: replace the hand-written AI racers with a learned driving policy

You are working in the **Track Builder 3D** repository (`wargamere/trackbuilder`), a browser racing game in TypeScript + three.js: draw a track, then race it in 3D against AI cars. It ships as a GitHub Pages web build and as a single-file CrazyGames build. Branch from the latest `main`.

Your job is to make the opponents **really AI**: cars driven by a neural-network policy that has **learned** to race through machine learning (imitation learning, then reinforcement learning in self-play). Today they are a large set of hand-tuned rules for every situation. This is a big task. Do it in phases, commit after each one, and keep the game shippable at every commit. Read this whole brief before you write any code.

---

## 1. What "actually AI" means here (the goal, and the line you must not cross)

**Today** (read these files first, all under `src/race/`):

- `racingLine.ts` (317 lines): computes one racing line per track and a speed plan from physics formulas (`cornerSpeed`, `brakingDecel`, `speedProfile`).
- `driver.ts` (`RacingDriver`, 414 lines): steers at a look-ahead point on that line and does throttle/brake to the planned speed. It has hand rules for running wide, lock guard, late braking, etc.
- `traffic.ts` (`TrafficPlanner`, 855 lines): hand-scored lane choices. It decides when to pass, when to follow, when to yield side-by-side, letting a quicker car by, defending the inside against the player, "push to pass", corridors to leave room. It is tuned by about 100 constants in `TRAFFIC` and `DRIVER` in `src/config/race.ts`.
- `ai.ts` (`AiDriver`, 528 lines): glues these together. It also handles pit stops (road box and pit lane path planning), tyre strategy, recovering when stuck, the safety car cap, yellow flags and the start-line spread.

**Target:**

- **The driving and the racecraft are learned.** Steering, throttle, brake, choosing where to be on the road, when and where to overtake, how to defend, how to avoid contact, how to drive on worn tyres, in the rain, on dirt or snow, with a damaged wing. All of this comes out of a trained neural network, not out of `if` statements and tuned constants.
- **The network sees the world through observations and acts through the same controls a human has:** steer, throttle, brake (and optionally gear shifts). It must not get privileged "teleport" actions, and it must not read the racing line's answer as an action to copy at inference time (see section 4 on what the network may observe).
- **What may stay scripted is only what is a *rule of the game* or a *team decision*, not driving:**
  - race control (yellow flags, safety car, the chequered flag, retirements);
  - the pit lane speed limiter (the game enforces it on the player too);
  - **when** to pit and **which** tyres to fit (the team strategist calls the stop, as in real racing);
  - grid placement;
  - putting a stuck car back on the road after a long timeout. Treat this as a marshal: rare, and counted as a failure in evaluation.
  - These scripted layers talk to the policy only through observations ("box this lap", "speed cap 24 m/s", "yellow flag ahead", "pit lane: follow this path"). The policy still does all the driving, including the drive down the pit lane and into the box.
- **Do not delete the classic AI.** Keep it, untouched in behaviour, as:
  - (a) the **teacher** for imitation learning;
  - (b) a **fallback** brain behind a flag;
  - (c) the driver for things that must stay deterministic and calibrated: medal times (`AuthorLap` in `medals.ts`), the editor's preview car (`editor/previewCar.ts`), the assists' racing line overlay and braking assist (`assists.ts`, `render/racingLineOverlay.ts`).
  - Medal times must not change. If you touch anything they depend on, they must still match, and `AUTHOR_VERSION` must not need a bump.

The finished result must be **better than the classic AI as an opponent**:

- at least as fast at the top difficulty;
- clearly more varied and human-like in how it races;
- overtakes and defends in ways that were never written as rules;
- no worse at clean racing.

---

## 2. The repository: ground truth you can rely on

**Stack:**

- TypeScript 5.9, Vite 8, three.js 0.186 (the only runtime dependency).
- Node 22. Tests run **TypeScript directly** with `node --test "tests/**/*.test.ts"` (type stripping). `tsconfig.json` has `erasableSyntaxOnly: true`, so **no enums, no namespaces, no constructor parameter properties, no `import =`**. Use `.ts` extensions in imports (`allowImportingTsExtensions`).
- `tsconfig.node.json` covers `tests`, `scripts/*.ts`, `vite.config.ts`. Add your training directory to its `include` so it is type-checked by `npm run typecheck`.

**Commands:**

```bash
npm ci
npm test              # ~241 tests, about a minute; must stay green
npm run typecheck
npm run build         # web + CrazyGames builds, with a size check (scripts/size.mjs)
npm run test:browser  # Playwright smoke test (Chromium)
```

**Physics:**

- `src/car/physics.ts` (`CarPhysics`, `CarState`) is a hand-written arcade model at a **fixed 120 Hz** (`HANDLING.tickRate`).
- It is **fully deterministic**: nothing reads the clock, and a test checks identical results at 60, 144 and 240 Hz. This is what makes fast, reproducible, headless training possible. Never break it.
- `CarPhysics.step(input)` takes `DriveInput { throttle 0..1, brake 0..1, steer -1..1, handbrake, shift? }`.
- `CarState` has `x, z, heading, vx, vz, speed, yawRate, slip, s` (distance along the track), `lateral` (offset from the centre line), `trackIndex`, `offTrack`, `grass`, `wallHit`, `inPits`, `gear`, `rpm`, …
- The car also carries:
  - tyres: `wear`, `compound`, `tyreUse`, `tyreLeft`, `gripScale`, `brakeScale`;
  - wetness;
  - damage: `wingDamage`, `bodyDamage`, `damageGrip`, `broken` (100 % damage or a mechanical failure: no drive, the car stops and the race is a DNF);
  - setup (wing, gears, brake balance);
  - `tune` (a championship team's car: grip, pull and top speed against the standard car);
  - `draft` (slipstream).

**Other systems you will touch:**

- **Car-to-car contact:** `src/car/contact.ts` (`collideCars`, three passes per tick).
- **Slipstream:** `src/car/slipstream.ts`.
- **Lap timing and race distance:** `RaceSession` in `src/race/session.ts`:
  - `raceDistance(s)` for positions;
  - checkpoints;
  - track limits (`offTrack` for more than 0.12 s voids the lap);
  - `retire()`;
  - `flagged` (the chequered flag);
  - wrong-way detection.
- **Race order:** `src/race/classify.ts`.
- **Race control:** `src/race/raceControl.ts` (yellow zones, safety car speed caps per car).
- **Pit lane geometry:** `src/track/pitLane.ts`. Pit boxes: `src/race/pitStop.ts` (`PitCrew`, `pitBox(track, car)`; teammates can share a box).

**Tracks:**

- A track is a closed spline of dots (`src/track/track.ts`, `spline.ts`). `track.center` gives `points`, `tangents`, `curvature`, `height`, `bank`, `width`, `spacing`, `length`, and edge offsets via `edgeOffsets(c)`.
- Roads are 8–20 m wide, with banking up to 30°, hills up to 40 m, and bridges and tunnels where the track crosses itself.
- Surfaces: tarmac, dirt, snow. Run-off: grass, gravel, tarmac. Kerbs and bump kerbs.
- **53 built-in tracks** (`builtInTracks()` in `src/editor/pipeline.ts`): 23 of the game's own plus 30 real-circuit layouts.
- **A procedural generator:** `generateTrack(style, seed, name)` in `src/editor/generate.ts`, with styles `'gp' | 'flowing' | 'technical' | 'street' | 'oval' | 'kart'`. It is seeded and validated, so it gives you an unlimited, varied training set.
- **Players draw their own tracks.** The policy must drive tracks it has never seen. **Generalisation is the central requirement, not a nice-to-have.**

**How the race screen uses the AI** (`src/race/raceScreen.ts`). Your learned driver must be a drop-in for the `AiDriver` surface the race screen uses:

- per tick: `ai.drive(states, dt)`, which returns a `DriveInput`;
- fields read: `ai.car` (its `CarPhysics`), `ai.session`, `ai.name`, `ai.paint`, `ai.difficulty`, `ai.start`, `ai.pitting`, `ai.crew` (stops, box);
- fields written: `ai.raceCap` (safety car speed cap), `ai.yellow`, `ai.boxCall`.

The constructor gets `{ name, paint, difficulty 0..1, laps, slot, box, wet, tyreWear, damage, mediumLife }`. `aiCars` (a `WeakMap` in `traffic.ts`) marks which states are AI, so the player's car can be told apart.

**Fields up to 20 cars:**

- A **career mode** (`src/career/`, `src/ui/careerScreen.ts`) runs 20-car championships. Each AI car's pace comes from `aiDifficulty(save, round, id)`: the team's car rating, the driver's skill and a little weekend form.
- When the player's race ends, the rest of the race runs **fast-forward** at up to 24 ticks per frame.
- **Qualifying** simulates every AI's flying lap in the background with `AuthorLap(track, difficulty, …)`.

**Difficulty contract** (`AI` in `src/config/race.ts`):

- `AI.lapRatio = [1.7, 1.27, 1.14, 1.06, 1]` is the lap time at difficulty 0, 25, 50, 75 and 100 %, as a multiple of the 100 % lap, **on every track** (`trackDifficulty()` in `ai.ts` calibrates this per track).
- The race setup's difficulty slider and the career depend on this meaning. The learned AI must honour the same contract (section 7).

**Test harness to reuse:** `tests/helpers/traffic.ts` → `race(track, specs, laps, maxSeconds, drafting, log, onHard, onTick, flag, conditions)`. It runs a headless race exactly as the race screen does, with contact, damage, retirements and the chequered flag. It reports:

- firm and hard contacts, by kind (rear-end, side-by-side, in a bend, involving the player);
- off-track seconds;
- resets;
- overtakes;
- finishing order and times;
- best laps;
- seconds spent sliding.

`CarSpec` kinds are `ai`, `bot` (a centre-line driver that ignores everyone), `player` (a racing-line driver that ignores everyone) and `human` (a clean player stand-in). Build your evaluation on this harness.

**Baseline numbers for the classic AI** (20 cars, 10 laps, damage and tyre wear on, measured on this codebase):

- every car finished on Melbourne, Monaco, Monza, Singapore, Baku, Las Vegas, Sakhir, Budapest, Silverstone and Montréal;
- 0 crash retirements and 0–2 resets per race;
- firm contacts 4–19 per race, hard contacts 1–16 per race (Monza, Las Vegas and Montréal are the worst);
- simulation speed: about **0.75 ms per tick for 20 cars** in Node, including everything.

---

## 3. Architecture to build

```
src/ai/                      runtime (ships in the game bundle; no Node APIs)
  nn.ts                      tiny inference engine: dense layers, activations, optional GRU/LSTM cell; Float32Array only
  observe.ts                 builds the observation vector from track + car + nearby cars + race context
  actions.ts                 decodes network outputs into DriveInput (with action smoothing/limits)
  learnedDriver.ts           LearnedDriver: the drop-in replacement for AiDriver (same public surface)
  intents.ts                 the scripted strategist/marshal layer: pit calls, pit-lane path, caps, flags -> observation "intent" inputs
  weights/                   trained weights as TS modules (quantised, base64), plus a manifest (version, obs spec hash, training run id)
  config.ts                  ML-related runtime constants (obs layout version, policy rate, skill mapping)
training/                    offline only (Node 22, never bundled)
  env.ts                     a Gym-style environment around CarPhysics/RaceSession/contact/raceControl: reset(seed, scenario), step(actions) -> obs, rewards, dones, infos
  scenarios.ts               the curriculum: solo laps, traffic, starts, duels, pit stops, rain, damage, user-like tracks
  trackCorpus.ts             training/validation/test track sets (procedural + built-in), with the held-out split
  teacher.ts                 runs the classic AiDriver to produce (obs, action) datasets
  bc.ts                      behaviour cloning + DAgger
  ppo.ts                     PPO (or your chosen RL algorithm), with GAE, multi-agent shared policy
  autograd/ or mlp-train.ts  a small, tested, from-scratch training engine (see section 5): forward/backward for MLP (+ GRU if used), Adam, gradient clipping
  league.ts                  self-play opponent pool / snapshots / Elo
  workers.ts                 worker_threads rollout parallelism
  evaluate.ts                the benchmark suite (section 9): writes training/reports/*.md
  export.ts                  quantise and write src/ai/weights/*.ts
  train.ts                   the CLI entry: `npm run train:ai -- --phase bc|rl|league --steps … --seed …`
```

- **Hybrid brain:** a scripted *strategist* decides **intents** (pit this lap, which tyres, the speed cap from the safety car or limiter, the pit-lane path to follow, yellow flags). A learned *driver* policy turns observations plus intents into controls. Over time you may also learn the strategy (see stretch goals), but the driving comes first.
- `LearnedDriver` must keep doing everything `AiDriver` does from the race screen's point of view:
  - pit stops via `PitCrew` (the crew holds the car in the box; the policy must drive into it and stop);
  - `pitting` and `crew.stops` for the timing tower;
  - honouring `raceCap` and `yellow`;
  - retiring when broken;
  - driving on after finishing (`AI.afterFinishPace` behaviour: not parked on the line).
- **Brain selection:** a setting or config flag `aiBrain: 'learned' | 'classic'`.
  - Default it to `'learned'` once the acceptance gates in section 9 pass. Until then, default to `'classic'`.
  - In dev builds, a URL parameter (`?brain=classic|learned`) switches it for comparisons.
  - If the weights fail to load or the observation spec hash doesn't match, fall back to classic with a console warning. Never crash.

---

## 4. Observations (design these carefully; they decide generalisation)

Everything is **ego-centric and track-relative**, normalised to roughly unit scale, so a policy trained on one track transfers to any other. Version the layout (`OBS_VERSION`) and hash it into the weights manifest.

Suggested contents (refine with ablations; document the final layout in a table in the README):

1. **Own car dynamics:**
   - forward and sideways speed;
   - yaw rate and slip;
   - heading error against the track tangent (sin/cos);
   - lateral offset from the centre line, plus distances to the left and right road edges and to the run-off/barrier on each side;
   - gear and rpm (if you control gears);
   - current steer, throttle and brake (the last action);
   - `offTrack`/`grass` flags, `wallHit`.
2. **Track ahead (the key generalising input):** sampled at a fixed set of distances ahead, spaced more densely near the car (for example 5, 10, 15, 20, 30, 40, 55, 70, 90, 115, 145, 180, 220 m), and 1–2 samples behind. At each sample give:
   - signed curvature;
   - road half-widths left and right relative to the centre;
   - bank angle;
   - grade (height change);
   - surface grip factor;
   - the centre line's lateral position and direction **in the car's frame**.

   Optionally add a coarse "ray cast" set: about 9–15 rays against the road edge and barrier polygons, like a LIDAR. Curvature samples alone generalise best; rays help on odd user tracks and at crossings.
3. **Grip context:**
   - tyre grip scale and brake scale (compound, wear, wetness);
   - wetness at the car;
   - damage (wing and body);
   - car `tune` (grip, pull, top);
   - setup (wing drag/downforce);
   - slipstream strength.

   These let one network drive every condition and every car.
4. **Other cars:** the K nearest (K = 6–8) within roughly 80 m ahead and 30 m behind along the track, sorted by distance. For each give:
   - relative along-track distance and lateral offset (in track coordinates, not world);
   - relative velocity (along and lateral);
   - relative heading;
   - whether it is the player (`!aiCars.has(state)`);
   - whether it is in the pits, retired or stopped;
   - its race position relative to ours (ahead or behind in the race: lapping vs racing).

   Pad empty slots with a "none" flag. Optionally use a small permutation-invariant encoder (shared MLP plus max-pool) instead of fixed slots.
5. **Race context and intents:**
   - our position and gap ahead and behind (seconds, from `GapTracker`, or race distance);
   - laps left; whether the race has started; the grid start phase;
   - the speed cap (safety car or pit limiter), normalised;
   - yellow flags here or ahead;
   - "pit this lap" and the target pit-lane path as lateral offsets at the look-ahead distances (so the policy steers along it);
   - distance to the box; "being lapped, let them by" (blue flag: add this, real racing has it).
6. **Skill/style conditioning** (section 7): the target pace fraction (difficulty), aggression and consistency.

**Do not feed** the classic racing line's lateral position or speed plan as observations in the final policy. That would turn the "AI" into a line-follower again. You may use them **only** during training: for the teacher, for reward shaping in early curriculum stages that you anneal to zero, and as auxiliary prediction targets (predicting the line from raw track samples is a good auxiliary loss).

---

## 5. Model and training engine

**Constraints:**

- No Python is required at runtime, and **none in the game**.
- Training should run with `npm run train:ai` in **pure TypeScript on Node 22**, so it uses the *exact* same physics code. This is the strongest guarantee that the trained policy behaves the same in the game.
- Use `worker_threads` for parallel rollouts. The dev box has 4 cores; design for N workers.
- If you are convinced a Python/PyTorch trainer is worth it:
  - put it under `training/python/`, optional;
  - the environment still has to be the TS simulator: bridge it over stdin/stdout with a binary protocol, batching many environments per message;
  - write an exact parity test that the exported weights produce identical actions in TS inference. Do not reimplement the physics in Python.

**Training engine:**

- Write a small, well-tested engine for dense MLP layers (and a GRU cell if you use recurrence): forward, backward, Adam, gradient clipping, orthogonal init, observation normalisation (running mean/std, frozen and exported with the weights).
- Check gradients against finite differences in a test.
- Keep it simple, readable and fast: Float32Array, preallocated buffers, batched matrix multiplies.

**Network:**

- An MLP of 2–3 hidden layers of 128–256 units (tanh or ReLU/SiLU).
- A Gaussian (or Beta) policy head for continuous `steer`, `throttle - brake` (one axis), and optionally a separate brake. The value head is separate or shared with a separate final layer.
- A small GRU (64) is optional, if it measurably helps with racecraft (memory of an overtake in progress).
- At inference use the deterministic action (the mean), plus *seeded* noise for human-like variance at lower skill (section 7).

**Policy rate:**

- Run the policy at 30 or 60 Hz and hold or interpolate the action between decisions. Physics stays at 120 Hz.
- Measure what rate you need. Fewer decisions make RL easier and make inference cheaper.

**Action shaping:**

- Rate-limit steer and throttle changes slightly, so the actions are physically plausible and not jittery.
- No privileged actions.

---

## 6. Training plan (phases; each must leave the repository green)

### Phase 0: environment, corpus, baselines

- `training/env.ts`: deterministic `reset(seed, scenario)` and `step(actionsForAllAgents)`.
  - Multi-agent: one shared policy drives several cars, and the player stand-in or rule-based cars fill other slots.
  - It must reuse the real `CarPhysics`, `collideCars`, `slipstream`, `RaceSession`, `RaceControl`, `PitCrew` and pit lane code. **No forked physics.**
- **Track corpus:**
  - thousands of procedural tracks from `generateTrack` across all six styles and many seeds;
  - randomised options: width 8–20 m, banking on/off/steep, hills, barriers and distance, kerb types, run-off, dirt/snow surface, pits on/off;
  - the 23 built-in game tracks.
- **Held-out test set:** the 30 real circuits, plus a fixed set of 50 unseen procedural seeds. **Never train on them.**
- `training/evaluate.ts` (section 9). Run it on the classic AI first and save `training/reports/baseline-classic.md`.

### Phase 1: behaviour cloning from the classic AI (the warm start)

- Record (obs, action) pairs from `AiDriver` across the corpus and the scenarios:
  - solo laps at many difficulties;
  - full 12–20-car races;
  - rain, worn tyres, damage, pit stops, safety car.
- Train BC, then run **DAgger** for at least 3 iterations: roll out the student, label the states it visits with the teacher's action, aggregate, retrain. This stops the compounding errors of plain BC.
- **Exit criteria:**
  - clean laps on 95 % or more of held-out tracks;
  - within 3 % of the teacher's lap time at difficulty 1;
  - full races finish.
- This alone gives you a learned network. It is not the end goal, but it is the floor and the safety net.

### Phase 2: RL, solo (learn to be *fast*)

- PPO with GAE (or SAC/IMPALA-style if you justify it), starting from the BC weights. Add a KL or BC penalty that you anneal, so it doesn't forget early.
- **Reward:**
  - progress: Δ race distance per step;
  - a time penalty;
  - track limits (`offTrack`) penalty;
  - barrier hits ∝ impact speed;
  - wrong way;
  - big penalty for breaking down (damage to 100 %);
  - small penalties for control jerk.
- **Randomise:** tracks, conditions, car tune, setup, start states (rolling starts mid-lap at random speeds and offsets, so it learns recovery), grip noise.
- **Goal:** beat the classic 100 % AI's lap time on held-out tracks (it drives a precomputed line, so a learned policy that uses the full road and trail-brakes should win), with no increase in off-track time.

### Phase 3: RL, racing in traffic (learn *racecraft*)

- **Multi-agent self-play.** All AI cars share the policy and each gets its own reward. Scenarios:
  - standing starts with full grids;
  - rolling starts in a pack;
  - duels (attack and defend);
  - lapping backmarkers;
  - safety-car restarts;
  - pit-lane exits into traffic.
- **Racing reward additions:**
  - positions gained and lost (sparse, at checkpoints), and the final classification at the flag;
  - time-gap changes to the cars just ahead and behind;
  - **contact penalties weighted by fault**: the car whose nose hits the other's side or rear takes most of it; a car that turns across another's path takes it;
  - extra penalty for any contact with a car flagged as the player (we want fair, not dirty).
- **Opponent pool / league:**
  - current policy;
  - frozen snapshots of past versions (prioritised fictitious self-play);
  - the classic AI at several difficulties;
  - the `bot` and `player` stand-ins from the test harness (people who ignore everyone, brake randomly, weave);
  - a "human-like" player model: noisy inputs, late or early braking, mistakes, cutting corners.

  Track Elo or TrueSkill for each snapshot. Never let the population collapse to one exploit.
- **Must-learn behaviours.** Each needs a dedicated scenario and an eval metric:
  - follow without rear-ending;
  - use the slipstream and pull out to pass;
  - pass on the inside into a braking zone;
  - pass round the outside when the inside is covered;
  - give a car alongside a car's width of room;
  - defend with **one** move, not weaving (penalise more than one direction change per straight while a car is within 1 s);
  - let a much quicker car (or a leader lapping you) by cleanly;
  - avoid a crashed or stopped car;
  - rejoin after a spin without cutting across traffic;
  - respect yellow flags;
  - hold position and gap behind the safety car;
  - obey the pit lane limit and pull into its own (possibly shared) box.

### Phase 4: robustness

- Randomise everything the game can produce:
  - rain and changing wetness, including a dry line on a damp track;
  - each tyre compound at every wear level;
  - damage levels;
  - dirt and snow roads;
  - banking, hills, bridges and tunnels (cars on the bridge above must be ignored: `CONTACT.heightGap`);
  - narrow 8 m kart tracks with tight hairpins;
  - 20 m wide ovals;
  - the pit lane on tracks with only 4 boxes, so cars queue.
- Train on deliberately nasty user-like tracks: hand-drawn wobbles (perturb generator output), very short loops, very long straights, crossings.

### Phase 5: skill levels, style and distillation (section 7), then quantise and export

---

## 7. Difficulty, personality and human-likeness

The game's contract (`AI.lapRatio`) is that difficulty d gives laps of `lapRatio(d)` × the 100 % lap on *every* track, and the career gives each driver a different d (car rating plus skill plus form). Implement it with the learned AI like this:

- **Condition the policy on a skill input** (a target pace fraction) during RL.
  - Reward hitting the target pace: penalise being much faster than the target band as well as slower.
  - Vary the skill per episode and per car.
  - Alternatively train a population at a few skill points and condition or distil.
  - Either way, **calibrate**. Measure the lap ratio the network actually produces on 20 or more held-out tracks at difficulty 0, 0.25, 0.5, 0.75 and 1. Fit a monotone mapping from game difficulty to the skill input so the measured ratios match `AI.lapRatio` within ±1.5 % on average and ±4 % worst case.
  - Store the calibration table with the weights.
  - The existing tests "AI pace rises with difficulty…" and "a difficulty means the same on every track…" must pass with the learned brain.
- **Make lower skill human-like rather than just slow:**
  - earlier and more cautious braking;
  - less of the road used;
  - small seeded steering noise;
  - reaction delay to other cars (an observation delay buffer);
  - occasional small mistakes (running wide), rarer as skill rises.
  - Never use `Math.random`. Seed from (race seed, car id, tick) so races are reproducible.
- **Personality inputs** (optional but valuable): aggression (how readily it dives for a gap) and consistency. Derive them per driver in the career from `src/config/career.ts` (add fields, e.g. `aggression`, without changing existing values), so Lindqvist feels different from Tanaka.
- **Fairness to the player** (non-negotiable):
  - the AI must not target the player;
  - must not brake-test;
  - must leave room alongside;
  - the existing test "down the inside of turn 1 alongside the fastest AI: it leaves you room and never turns in on you" must pass;
  - **no rubber-banding or catch-up cheats.** The classic AI has a "push to pass" tow boost when stuck behind the player (`TRAFFIC.push*`). The learned AI should earn its passes. Remove that boost for the learned brain unless evaluation shows it can't pass a slow player otherwise, and then report it.

---

## 8. Runtime budgets (hard limits)

- **CPU:**
  - The whole race tick for 20 cars currently costs about 0.75 ms in Node. With the learned brain, keep the **AI part at or under 0.5 ms per tick for 19 AI cars** in Node, measured by a benchmark script (`npm run bench:ai`) whose result is recorded in the README.
  - The fast-forward finish runs up to 24 ticks per frame; it must stay smooth (it adapts to a time budget, but don't starve it).
  - Use a policy rate below 120 Hz, preallocated buffers, no allocation per tick, and batched inference (one matrix multiply for all cars).
- **Bundle:** weights at or under **600 KB** in the built output (int8 or float16 quantisation with per-tensor scales).
  - The CrazyGames build is a single self-contained `index.html` (now 1.07 MB; the limit is 20 MB, but keep it lean).
  - **No new runtime dependencies** (no TensorFlow.js, no ONNX runtime). Inference is your own `nn.ts`.
  - Dev dependencies for training are allowed only if clearly worth it; prefer none.
- **Determinism:**
  - Same seed and inputs give bit-identical race results in Node and in the browser (Float32 math in a fixed order; no `Math.fround` surprises across paths).
  - Write a test that runs the same 20-car race twice and compares final states exactly.
- **Quantisation check:** a test that quantised and float weights give the same lap time within 0.5 % and a clean lap on 5 tracks.

---

## 9. Evaluation and acceptance gates

`npm run eval:ai -- --brain learned|classic --suite quick|full` runs the suite on the **held-out** tracks and writes a Markdown report with a table per metric, classic and learned side by side. Commit the full-suite report for the final weights. Gates for making `learned` the default:

| Area | Gate |
|---|---|
| Pace at difficulty 1 | Learned lap at or below classic 100 % lap on the median held-out track, and no track more than 2 % slower |
| Difficulty calibration | Section 7 tolerances; monotone in difficulty on every track |
| Clean driving (solo) | 98 % or more of laps valid (track limits, missed checkpoints) at difficulty 0.75 or more; no barrier hit over 8 m/s in 50 solo laps per track |
| Full races (20 cars, 10 laps, damage + tyre wear on, 10 held-out circuits plus 10 unseen procedural) | Every car that isn't given a scripted mechanical failure finishes; crash retirements at or under 1 per 10 races; resets (marshal) at or under 2 per race; hard contacts (above 4 m/s) at or under the classic AI's per track; firm contacts at or under 1.2× classic |
| Racecraft | Overtakes per race at or above classic (more is the point, but not from crashing); successful passes in the duel scenarios; a quicker car gets by a slower one within 2 laps in 90 % or more of seeds |
| Player fairness | Contacts with the `human` stand-in at or under classic; no AI-initiated contact with the player in the "leaves you room" scenario across 20 seeds |
| Pit lane | 100 % of planned stops completed with the limiter respected and the car stopped in its own box (the 11-cars-into-4-boxes test must pass) |
| Race control | Safety car: no passing under it, field bunches up, races on after (existing raceControl tests pass); yellow zones: speed reduced |
| Conditions | Rain (soaked and changing), worn tyres, damage, dirt and snow: still clean and sensibly slower; wets quicker than slicks when wet (the existing conditions tests pass) |
| Generalisation | Real circuits never trained on: all gates above hold; plus 50 unseen procedural tracks |
| Budgets | Section 8 |

Also produce **qualitative evidence**: a few headless replays turned into short videos or GIFs. There is a Playwright-based recorder in `crazygames/tools/record.cjs`, and dev builds accept `?autopilot`. Show a pass up the inside, a defence, a wet race and a pit stop. Put them in the PR.

---

## 10. Tests (keep everything green, add more)

**Existing tests.** All existing tests must pass with the classic brain, and the AI behaviour tests must also pass with the learned brain:

- `tests/ai.test.ts`
- `tests/traffic.test.ts`
- `tests/duel.test.ts`
- `tests/racingLine.test.ts` (the parts about AI laps)
- `tests/raceControl.test.ts`
- `tests/pitLane.test.ts`
- `tests/conditions.test.ts` (the AI parts)
- `tests/retire.test.ts`

Parameterise them over both brains where they test *outcomes* (finishing, contact, pace, letting by, pit stops). Where a test asserts a *specific classic mechanism*, keep it classic-only:

- "the AI covers the inside **before the braking point**";
- "fighting for a place it goes **later on the brakes**".

For each such test, add a learned-brain test of the same *outcome* ("a defending car makes passing harder: the pass takes longer than against a non-defending car"). Do not weaken, skip or delete tests to get green.

**New tests:**

- inference correctness (TS `nn.ts` vs a reference implementation);
- gradient check of the training engine;
- observation layout stability (the hash matches the weights manifest);
- determinism;
- quantisation;
- the learned driver's surface parity with `AiDriver`;
- a quick smoke of each eval scenario.

**CI budget:**

- `npm test` must stay at about 2 minutes or less on GitHub Actions.
- Long evaluation runs in `npm run eval:ai`, not in `npm test`.
- Training never runs in CI, except a tiny "train for 2 seconds, loss goes down" smoke test.
- CI is `.github/workflows/checks.yml`; GitHub Pages deploys from `main` via `.github/workflows/pages.yml`, which also runs `npm test`.

---

## 11. Integration details you must not miss

- **The AI cars still own their side jobs:**
  - `RaceSession` stepping and lap counting are done by the race screen per car; keep that.
  - `aiCars.set(state, difficulty)` so other code (and the classic AI) can recognise AI cars.
  - After the finish, the car keeps driving at a gentle pace, out of the way.
  - Retired (`session.retired`) means no input at all: the car is stopped where it is.
- **Pit stops:** the strategist decides (reuse `stopWanted` logic and `pickCompound` from `strategy.ts`), the policy drives in, and `PitCrew.step` holds the car and fits tyres. The `pitting` flag must be true from the entry until rejoining. Queueing for a shared box must work.
- **The start:** standing start from the grid slot (`gridPlace`); no jumping into another car's path in the first 200 m. The classic AI uses a small per-slot pace spread there; the learned AI should handle the first corner by itself.
- **Qualifying:** replace the background `AuthorLap` difficulty simulation for **AI cars** with a learned-policy flying-lap simulation, so the grid reflects the real brain. It must stay sliced (a few thousand ticks per frame) so the UI doesn't freeze; skipping qualifying currently computes 19 laps at once and takes a few seconds, so make it faster if you can. Medal times stay on classic `AuthorLap`.
- **Rendering:** there is nothing to change; `CarModel` follows the physics state.
- **Settings and UI:**
  - Add the brain choice to the race setup's Assists or Conditions area only if it's useful to players. Otherwise keep it as a dev and config flag.
  - All UI text goes in `src/config/strings.ts`, in the existing plain style.
- **Documentation:**
  - Update `README.md`: a new "AI drivers" section describing the learned brain (observations, network, training, how to retrain, the eval numbers, budgets), and replace outdated descriptions of the rule-based racecraft or mark them "classic brain".
  - Write `training/README.md` with exact commands to reproduce the shipped weights from scratch (seed, steps, hardware, wall time).
- **Code style:** follow the repository's. Its comments are plain, complete sentences that explain *why* in everyday words, and constants live in `src/config/*` with a comment each. Match it.

---

## 12. Deliverables and how to work

1. A short design note first (`training/DESIGN.md`): your chosen algorithms, observation table, network sizes, reward terms with weights, curriculum, and how you'll hit the budgets. Then implement.
2. Phases 0–5 as separate commits (or PRs). Each one:
   - keeps `npm test`, `npm run typecheck`, `npm run build` and `npm run test:browser` green;
   - leaves `aiBrain` defaulting to `classic` until the final phase passes the gates.
3. **Final:**
   - weights committed under `src/ai/weights/` with a manifest;
   - `aiBrain` defaults to `learned`;
   - the eval report committed;
   - README updated;
   - a PR description with the before/after table, the budgets, the videos, and an honest list of what still isn't as good as the classic AI.
4. **Report truthfully.** If a gate isn't met, say which one and by how much. Don't tune the evaluation to pass. Don't overfit to the held-out set: if you look at it to make decisions, say so and make a fresh held-out set.
5. Think about wall-clock time. Profile rollouts first: the simulator is cheap, so tens of millions of environment steps are realistic on 4 cores if you avoid allocations and run many environments per worker. Budget the training to what's achievable, and make it resumable from checkpoints.

### Stretch goals (only after the gates pass)

- Learn the pit strategy too: a small separate policy or value-based decision (box now or not, which compound) trained on race outcomes, compared against the scripted strategist.
- Learned "personalities" per career driver from a style embedding.
- An "AI coach" for the player: the same policy's value function shows where the player loses time.
- A future car-development system can feed a car rating into the observation (it already exists as `tune`), so improvements show up in how the AI drives, not just in a number.

---

**Start by reading:** `README.md` (especially Driving, Races, Conditions, the pit lane, Damage, Career), then `src/race/ai.ts`, `driver.ts`, `traffic.ts`, `racingLine.ts`, `src/car/physics.ts`, `src/race/raceScreen.ts` (`tick()`, `startOpponents()`, `raceControl()`), `tests/helpers/traffic.ts`, and the AI tests listed in section 10. Then write `training/DESIGN.md`.
