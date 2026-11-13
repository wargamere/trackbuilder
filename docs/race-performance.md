# Race frame-time checks

Run `npm run bench:race -- current` after installing Playwright Chromium. `PW_CHROMIUM` can point at an installed Chrome executable; `RACE_PERF_PORT` defaults to 5269. The diagnostic runs a 24-car Melbourne race at 100%, then qualifying, and writes JSON measurements and a Chrome CPU profile to `test-results/race-performance-current.*`.

The benchmark measures actual browser race ticks, rendered frames and background qualifying/medal work. It deliberately does not assert a universal FPS target: hardware, headless graphics, profiling overhead, shader compilation and other workloads affect wall-clock times. Run comparisons on the same machine without concurrent tests. The warm-frame statistic excludes the first ten rendered frames.

## Changes

- Track interpolation wraps only when looking outside the current lap, and lane offset/road margins share their interpolation position.
- Candidate lanes reuse each observed rival's trajectory forecast. The cache belongs to a single observation and is invalidated if the committed human-rival forecast changes; it never survives into a later physics tick. A regression test compares every sampled car state and tactical decision against the uncached calculation.
- Tactical planning keeps its existing timing. Following, collision avoidance, car contact and car physics still run every 120 Hz tick.
- Medal and qualifying simulations share a 2 ms per-frame deadline, checked every sixteen simulated ticks. They yield without changing their eventual lap times or recorded path. The visible race and HUD run first; paused/grid screens do no background lap work.
- The minimap measures its layout after a resize notification instead of forcing a HUD layout after the name tags move every frame. Track changes, hiding/showing the map and pixel-density changes still rebuild its cached background.

## Local comparison

One same-machine headless Chrome/SwiftShader comparison against release `8988256`, with CPU profiling enabled:

| Measurement | Before | After |
| --- | ---: | ---: |
| Mean race physics tick | 3.12 ms | 2.19 ms |
| 95th-percentile physics tick | 13.3 ms | 7.7 ms |
| 95th-percentile rendered race frame | 33.2 ms | 19.7 ms |
| 95th-percentile warm race frame | 26.5 ms | 17.3 ms |
| 95th-percentile qualifying frame | 30.6 ms | 3.8 ms |
| Longest qualifying background-work call | 35.6 ms | 3.1 ms |

The deadline is cooperative: a sixteen-tick batch, garbage collection or OS scheduling can overshoot it. Cold shader compilation still causes a first-use spike. These measurements describe this fixture, not a guaranteed frame rate on a player's device. Car performance values and the difficulty curve are unchanged.
