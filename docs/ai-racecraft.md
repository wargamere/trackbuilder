# Live AI racecraft

The production classic driver now chooses a corner tactic as well as a traffic lane. This is a live gameplay change; the experimental learned driver remains separate and unpromoted.

- **Defend inside:** cover a threatened inside lane before braking, including more moderate braking corners. Keep one defensive move per corner. Never initiate a reactive block when the player's inside overlap is already established.
- **Attack inside:** commit to an available inside lane before turn-in when the approach speed and overlap justify it.
- **Hold outside:** retain a legal overlap through the corner, following the fastest path inside the space reserved for both cars. Don't automatically concede because the solo racing line turns inward.
- **Switchback / exit attack:** if the other car clears the AI's nose and runs wide, use the vacated inside for a late apex and an exit attempt. Don't cross a car still alongside or a third car occupying the gap.

The tactic persists through the corner instead of switching sides every planning tick. It releases when the car has won clear space, the rival leaves range, the corner ends, or conditions invalidate the move. Pit stops, yellows, safety-car caps, off-track recovery and large slides suspend tactics. AI duels with clearly different pace levels retain the existing let-by contract; matched AI cars can contest the corner.

During a committed duel, player prediction uses observed movement across the road rather than assuming the human returns to the AI's ideal line. Traffic prediction also sees another AI's published tactical route. A lateral cut-in guard can ease off even when a faster car is ahead, because its rear wheel may not yet be clear. The existing following/emergency-braking cap, overlap corridor, path-specific grip/braking limits and physical contact model still control execution. The car's engine, grip, top speed and physics are unchanged by a tactic.

`AiDriver.racecraft` exposes the current decision for debugging/replays. It does not display implementation details in the normal player UI.

## Validation

`npm test` includes decision and real-physics checks for outside overlap, a completed switchback pass, inside defence, no reactive blocks, third-car occupancy, missing rivals, disabled tactics and AI pace cooperation. Browser smoke runs the real-physics outside and switchback scenarios in Chromium and checks that the actual 24-car race opponents use the updated driver.

`npm run eval:racecraft` runs 24 deterministic corner duels: three built-in tracks, four initial overlaps/gaps, and two player styles (hold the inside / early apex with a wide exit). The player stand-in uses the real car physics and never reads the AI's decision. Output is `test-results/racecraft.json`; gaps are player minus AI in metres, so negative means the AI is ahead.

`npm run eval:racecraft -- --field` separately runs two-lap 20/24-car fields with damage enabled and a matched clean player stand-in. This longer diagnostic stays outside the unit suite.

The measured 24-duel run has 3 contacts versus 14 before, a maximum contact speed of 3.15 m/s versus 3.17 m/s, no off-road time and no resets. Both 20/24-car field checks finish every car without contacts, off-road time, retirements or resets. These fixed scenarios do not replace playtesting against a human.

The checked-in [comparison](../tests/fixtures/racecraft-comparison.json) records the same harness against deployed base `f97c3b4e86615c9823c28a8f9ee09861ef727e93` and the updated implementation. It includes every run, contacts, off-road time, resets, overlap duration and final gap. It is a diagnostic, not proof that every corner tactic is faster: a valid inside defender can still beat an outside attack, and the fixed player stand-ins do not avoid the AI. The acceptance tests require clean execution for the demonstrated outside and switchback scenarios; aggregate results must be read without hiding the remaining weak cases.

The earlier learned-policy reports in `training/reports/` describe the historical classic teacher before this gameplay change. Future training and baseline comparisons must identify the new source revision and recollect labels where appropriate. Medal author laps, preview cars and player assists still use the unchanged `RacingDriver`.
