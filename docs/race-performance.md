# Race frame-time checks

Run `npm run bench:race -- current` after installing Playwright Chromium. `PW_CHROMIUM` can point at an installed Chrome executable; `RACE_PERF_PORT` defaults to 5269. The diagnostic runs a 24-car Melbourne race at 100%, then qualifying, and writes JSON measurements and a Chrome CPU profile to `test-results/race-performance-current.*`.

The benchmark measures actual browser race ticks, rendered frames and background qualifying/medal work. It deliberately does not assert a universal FPS target: hardware, headless graphics, profiling overhead, shader compilation and other workloads affect wall-clock times. Run comparisons on the same machine without concurrent tests. The warm-frame statistic excludes the first ten rendered frames.

## Changes

- Track interpolation wraps only when looking outside the current lap, and lane offset/road margins share their interpolation position.
- Candidate lanes reuse each observed rival's trajectory forecast. The cache belongs to a single observation and is invalidated if the committed human-rival forecast changes; it never survives into a later physics tick. A regression test compares every sampled car state and tactical decision against the uncached calculation.
- Following, collision avoidance, car contact and car physics still run every 120 Hz tick. See the wet-race follow-up below for tactical scheduling.
- Medal and qualifying simulations share a 2 ms per-frame deadline, checked every sixteen simulated ticks. They yield without changing their eventual lap times or recorded path. The visible race and HUD run first; paused/grid screens do no background lap work.
- The minimap measures its layout after a resize notification instead of forcing a HUD layout after the name tags move every frame. Track changes, hiding/showing the map and pixel-density changes still rebuild its cached background.

## Local comparison

The first pass's same-machine headless Chrome comparison against release `8988256`, with CPU profiling enabled:

| Measurement | Before | After |
| --- | ---: | ---: |
| Mean race physics tick | 3.12 ms | 2.19 ms |
| 95th-percentile physics tick | 13.3 ms | 7.7 ms |
| 95th-percentile rendered race frame | 33.2 ms | 19.7 ms |
| 95th-percentile warm race frame | 26.5 ms | 17.3 ms |
| 95th-percentile qualifying frame | 30.6 ms | 3.8 ms |
| Longest qualifying background-work call | 35.6 ms | 3.1 ms |

The deadline is cooperative: a sixteen-tick batch, garbage collection or OS scheduling can overshoot it. Cold shader compilation still causes a first-use spike. These measurements describe this fixture, not a guaranteed frame rate on a player's device. Car performance values and the difficulty curve are unchanged.

## Wet/night follow-up

After a report of remaining drops in rainy Las Vegas, the benchmark also accepts `RACE_PERF_TRACK`, `RACE_PERF_WEATHER`, `RACE_PERF_TIME` and `RACE_PERF_DPR`. For this case use `world-us-2023`, `rain` and `night`. Compare fixed-step profiles without other test processes running.

- Each car's wheels have a separate material from the ordinary trim. Sharing one material between instanced and ordinary geometry forced shader-variant switching every frame. Wheel bounds now allow offscreen culling, and rain/wheel animation buffers use dynamic draw usage.
- Wetness/intensity changes update material colours without invalidating shader programs; switching between day and night still updates the emissive-map shader variant. Rain intensity updates retain camera-velocity history.
- Route-speed checks slide a rolling window over the path, reusing smoothed points only when sample positions match exactly. Tests compare the speed limits exactly against the previous calculation and require at least 30% fewer world-point evaluations.
- Every AI makes its first plan immediately, preserving the start reaction. Only subsequent planning is phased across five ticks, keeping the previous five-tick cadence. Following and overlap protection still run every tick. Pace-order, overtaking and clean-field checks remain in place.
- Active races give physics catch-up an 8 ms cooperative budget after at least two complete ticks. An ordinary 60 Hz frame retains both 120 Hz ticks. A slow frame sheds excess wall-clock debt instead of forcing twelve expensive catch-up ticks into the next frame. Every car, race clock, tyre and collision system advances together; sustained overload slows the simulation uniformly rather than skipping individual cars' physics.

On the same local machine, the 24-car wet/night Las Vegas fixed-step profile against `a0b04fe` changed as follows:

| Measurement | Before | After |
| --- | ---: | ---: |
| Mean physics tick | 2.70 ms | 1.80 ms |
| 95th-percentile physics tick | 9.6 ms | 3.3 ms |
| 95th-percentile warm rendered frame | 16.2 ms | 8.9 ms |

`npm run bench:wet-race -- current` adds a real-requestAnimationFrame wet/night soak, GPU/pixel metadata, a screenshot, per-frame trace and CPU profile. `WET_RACE_SECONDS` defaults to 25; `WET_RACE_CPU=2` enables Chrome's 2× CPU throttle; `RACE_PERF_DPR=2` exercises a 2880×1800 drawing buffer. It asserts stable shader versions during changing weather, correct day/night transitions, one wheel shader variant and valid wheel-culling bounds. CI runs an eight-second version. FPS values are diagnostic, with no hardware-independent target assertion.
