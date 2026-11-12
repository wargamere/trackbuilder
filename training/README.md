# Learned AI development

The live game still uses **classic** driving. This is the first migration increment: phase 0 and an experimental phase 1 training path. It does not fix the deployed race starts yet. See [DESIGN.md](DESIGN.md) for the release gates and later phases.

Classic wheel-to-wheel behaviour has subsequently been upgraded with committed corner tactics; see [live AI racecraft](../docs/ai-racecraft.md). The phase-1 reports below retain their original source/teacher provenance. Recollect teacher data and baselines for comparisons against the updated gameplay.

Implemented:

- Deterministic 120 Hz environment using the actual car physics, lap/checkpoint rules, three contact passes, drafting, race control and weather. Classic cars also use their existing pit crews and strategy. Supports 1–24 cars.
- Lazy corpus of 3,000 procedural training seeds across all six generator styles plus game-authored tracks. Separate validation seeds and 50 acceptance seeds; real circuits are held out. Melbourne is an explicitly inspected diagnostic.
- Raw-geometry observations, eight same-level neighbours, a two-layer 128-unit tanh network, 30 Hz held actions, analytic backpropagation, Adam, gradient clipping and frozen normalization.
- Cloning followed by at least three DAgger iterations. A separate shadow teacher labels student states without teleporting, boosting or moving the student car. The final DAgger iteration uses only student actions.
- Checksummed binary datasets and phase-boundary checkpoints containing the actual weights, optimizer moments, settings and collection history. Seeded minibatch sampling resumes from the optimizer step.
- Classic/learned evaluation and inference benchmarking. Requesting learned evaluation with missing, invalid or incompatible weights fails explicitly.

Not implemented in this increment: PPO/value head/GAE, worker-thread training, self-play league, learned pit driving and marshal recovery, difficulty calibration, quantized export, live brain selection or learned qualifying. These remain phases 2–5; the original foundation preserved classic driving, and later classic racecraft changes are documented separately above. Medal `AuthorLap`, assists and preview cars remain unchanged. No experimental weights are imported into the production bundle.

## Commands (Node 22.18+)

```sh
npm run baseline:ai -- --seed 20261111
npm run train:ai -- --phase bc --seed 20261111 --tracks 6 --seconds 60 --updates 300 --dagger-updates 150 --iterations 3 --out training/runs/candidate-1
npm run train:ai -- --phase bc --resume training/runs/candidate-1/checkpoint.json --out training/runs/candidate-1
npm run eval:ai -- --brain classic --suite quick
npm run eval:ai -- --brain learned --weights training/runs/candidate-1/policy.json --suite quick
npm run bench:ai -- --weights training/runs/candidate-1/policy.json
```

`--tracks` counts procedural layouts in addition to two game-authored layouts. The checked-in initial report uses six procedural layouts, not all 3,000. CLI defaults use twelve; larger runs should increase both corpus coverage and updates. Generated run files are ignored by git. Keep a run's `checkpoint.json`, `dataset-N.bin` and `policy.json` together.

The quick suite uses six validation layouts and 20/24-car Melbourne starts. Its player stand-in follows a classic racing line without traffic avoidance or the grid-slot handicap; it can make contact and is **not** a replay of the supplied recording. All contacts are reported. The baseline script also tests a clean classic player stand-in that has the same handicap as other cars.

`--suite full` opens the reserved real-circuit/procedural acceptance layouts for solo laps and adds the diagnostic starts. It is **not yet the complete promotion matrix**: long races, pit completion, fairness, all conditions and difficulty calibration are still missing. Avoid running it during development. Every report marks unmeasured gates explicitly; neither a lower cloning loss nor a quick-suite result can promote a policy.

Cloning currently trains dry, unworn cars. Pit intent channels are reserved in the observation contract but not trained; external learned cars receive no automatic pit steering or teacher recovery. Evaluation failures, off-road time and timeouts are preserved. There is no fallback to classic inside a requested learned rollout.

The Node benchmark includes observation building and inference for 24 cars. It reports batch peak time and an amortized estimate for 19/23 opponents; policy decisions currently align. These estimates do not establish the browser frame-time gate.

## CI and reproducibility

Ordinary unit tests include finite-difference gradients, nonlinear cloning convergence, deterministic replay, observation separation and checkpoint round trips. CI runs only a tiny cloning/three-DAgger smoke run, then reloads its checkpoint. Long training and race evaluation are explicit commands outside `npm test`.

Reports include the checked-out parent revision. Local reports generated before the phase commit also identify uncommitted work in the summary. The corpus version and ordered observation hash are the compatibility boundary; change them when their meaning changes. Keep acceptance results separate from diagnostics and never tune against an untouched acceptance run.
