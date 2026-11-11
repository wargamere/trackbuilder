# First learned-driving increment

**Status: experimental; production stays classic. The deployed race-start problem is not fixed by this increment.** Phase 0 and the BC/DAgger training path are implemented. Neither measured candidate is suitable for a live race.

## Evidence and baseline

The supplied recording shows P24 initially and P12 around video time 12 seconds. Video time is not the race clock, and the recording does not provide exact controls or difficulty. It is not an input replay.

Classic AI has an explicit grid-slot pace penalty for the first 500 metres, reaching 11.5% at slot 23. That is a contributing mechanism, not a proven explanation for all twelve gained places. In the controlled 24-car Melbourne baseline, a clean classic stand-in gained one position after 30 seconds at 75% difficulty. A separate player-style driver without traffic avoidance or the grid-slot handicap reached P19 at 75% and P20 at 100% after 30 seconds, with 9/11 firm player contacts. Neither reproduces the recording exactly.

See [classic baseline](classic-baseline.json) and [player-style classic diagnostic](classic-quick.json). Both use the actual physics and checkpoint rules. The classic source, medal author laps, preview cars and assists are unchanged.

## What was trained

Both runs use seed `20261111`, a 280-value raw-geometry observation (`53199a48`), two tanh hidden layers of 128 units, two action outputs, 30 Hz policy decisions and 120 Hz physics. There are 52,738 parameters (210,952 bytes of float32 parameters, before serialization). No optimized racing-line offsets, speed profiles or grid-slot handicap enter the observation or the learned action path.

Training is dry, with unworn tyres, on fields of one or six cars. Two game-authored tracks are added to each run's procedural tracks. The generator supplies all six styles. The larger 3,000-seed training corpus exists as lazy descriptors but was **not** fully trained in these runs. Validation uses six separate procedural layouts. Reserved real circuits and the 50 acceptance seeds remain unopened; Melbourne is a separate inspected diagnostic.

Each run includes cloning and three DAgger rounds with teacher mixing probabilities 0.5, 0.25 and 0. The last round visits student-driven states. Shadow teachers own separate car/planner state; their resets are rejected as labels and cannot move the student car. Optimizer moments, aggregated datasets, settings and collection history are preserved in phase-boundary checkpoints.

| Measurement | Candidate 1 | Candidate 2 |
| --- | ---: | ---: |
| Procedural training layouts, plus two game tracks | 6 | 12 |
| Episode limit | 60 s | 90 s |
| Optimizer updates | 750 | 3,750 |
| Aggregated labelled samples | 45,793 | 120,216 |
| Training wall time on this machine | 53.6 s | 286.8 s |
| Validation layouts with any valid lap | 3 / 6 | 3 / 6 |
| Valid / completed validation laps | 6 / 12 | 5 / 12 |
| Summed validation off-road time | 20.28 s | 5.66 s |
| Validation barrier impacts above 4 m/s | 13 | 16 |

Candidate 2's valid best laps are 13.2% slower on GP, 3.5% slower on flowing and 19.1% slower on technical than classic. Street, oval and kart have no valid lap. This is a failure, even though some imitation loss and off-road measures improved. In all four learned 20/24-car Melbourne start diagnostics, the player stand-in reaches P1 after 30 seconds. Zero player contact in some of these runs is not evidence of good racing: the opposition is too weak.

Raw measurements: [candidate 1 training](candidate-1-training.json), [candidate 1 evaluation](candidate-1-evaluation.json), [candidate 2 training](candidate-2-training.json), [candidate 2 evaluation](candidate-2-evaluation.json), [inference benchmark](candidate-2-bench.json), [single-car conformance](candidate-2-parity.json).

## Validation and gates

- 267 unit tests pass, including finite-difference gradients through every layer, nonlinear cloning convergence, Adam continuation, binary checkpoint recovery, split enforcement, deterministic 24-car starts and shadow-teacher equivalence.
- Both TypeScript configurations and web/CrazyGames builds pass. Production output is approximately 1.15 MB; experimental weights are excluded.
- Existing browser smoke passes, including editor/mobile behaviour, career, team creation, persistence and a 24-car grid.
- Tiny cloning + three-DAgger smoke training and checkpoint reload pass. These run in CI outside the unit suite.
- The trained controller's single-car dry trajectory matches Node and Chrome over 1,800 physics ticks to within `4.3e-13`. This does not establish full-field/condition parity.
- Observation/inference timing exceeds the 0.5 ms target in the Node microbenchmark's amortized 19-opponent estimate. Decisions currently align; browser race timing and allocation profiling remain pending. See the raw benchmark for timings and its scope.

**Promotion is blocked by measured pace, validity, barrier-contact and start-quality failures.** Long-race finishing, fault attribution/fairness, learned pits, safety-car compliance, all conditions, calibrated difficulty, quantization and the complete runtime/parity matrix are not yet measured. They must not be interpreted as passing zeroes.

## Reproduction and provenance

Commands and limitations are in [the training README](../README.md). Candidate policy SHA-256 hashes:

- Candidate 1: `01591ef47ab2674cd3d376fbfa5b3391ac792ac72752e447aa213380162679d8`
- Candidate 2: `82bb72aa50434a48ead95d7d55342bdd546c8c0cbb091e7ff671d9ccd25a1e2c`

The baseline's parent was local `c58e6eb`; candidate 1 was measured against uncommitted phase-1 work on local parent `65cadc1`. Candidate 2 uses committed local `22563cf5e96ed5ceadd6cde4ef00b5a5c399311a`, whose implementation is published as `0ec6acc1a77cd33d5f642c35ad742719cda8c033` in [PR #8](https://github.com/wargamere/trackbuilder/pull/8). GitHub commits are recreated on deployed default `c2e1349e81905d7122fb9bebde210e7b550944e0`; their parent history differs from the local checkout. The final report commit adds measurements without changing training or driving behaviour.

Remaining work is the staged migration in [DESIGN.md](../DESIGN.md): broaden imitation coverage and establish a reliable warm start, add PPO/GAE, then self-play/racecraft, conditions/pits, calibration/export and live integration. The classic driver stays the fallback and the default until all gates pass.
