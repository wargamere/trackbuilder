# Engineering model

This implements the documented **F1 25 My Team 2.0 workflow**, adapted to Track Builder's existing racing physics and calendar. EA describes separate research and manufacturing, one-car versus two-car production decisions, driver reactions to unequal equipment, championship-dependent resource income and workforce tradeoffs. [EA's 2025 career deep dive](https://www.ea.com/games/f1/f1-25/news/f1-25-career-deep-dive) and [team-owner guide](https://help.ea.com/en/articles/f1/f1-25/how-to-be-a-team-owner/) are the references.

The numerical balance below belongs to Track Builder. It is not a claim to reproduce EA's hidden balance tables, full part catalogue or simulation. No F1 25 artwork or UI assets are used.

The RP/cash split also follows the [creative director's currency clarification](https://forums.ea.com/discussions/f1-25-general-discussion-en/f1%C2%AE-25-qa---gavin-cooper-creative-director/12108551/replies/12108993): RP represents research data; cash pays for manufacturing, staff and facilities.

## Research → manufacture → assign

There are four branches: Aerodynamics, Chassis, Powertrain and Durability. Each has four successive designs with prerequisites. A later design requires researching its predecessor; fitting it to a car requires fitting the predecessor to that same physical car.

1. **Research:** spend RP, not cash. A project takes time and produces a design. It gives neither car a performance gain. Technical staff, the laboratory and saved research insight modify cost/quality. The quality multiplier is locked at commission time.
2. **Development:** order manufactured copies of a completed design. A one-copy order arrives sooner. A two-copy order costs 1.65 times one copy, making it cheaper per car, but takes longer. Rushing costs 40% more, shortens time by 35%, and adds 15 percentage points to per-copy failure risk. Each copy passes quality control independently. A failed copy can be reordered without repeating research.
3. **Assign upgrades:** fit stock to car 1 or car 2. No automatic fitting occurs on delivery. A physical car can fit a design only once. The first recipient gains 1 morale and the other driver loses 3; bringing the second car up to equal equipment restores 3 morale to that driver. Swapping which driver you control does not transfer equipment. Replacing a contracted driver retains that seat's car upgrades.

The team's displayed rating uses the mean performance gain of its two cars. AI pace uses each AI driver's own fitted car. For the selected player, aerodynamic/chassis improvements change grip, chassis/powertrain improvements change engine pull, and powertrain/aero improvements change top speed. Durability reduces mechanical failure probability when that car is controlled by AI. Individual car effects are visible in Assign upgrades.

## Time and resources

Advance to the race weekend moves engineering time forward by 14 days and grants that round's resource income. Each round advances and pays only once. Qualifying and race actions are then available. Recording a race without an explicit advance runs the same guarded transition, so resumed/older saves cannot skip or duplicate it. Reopening screens or restarting practice does not move time.

Initial RP is 850. Income is 250 plus 25 per constructors' position plus 3 per engineering worker. Points and finishing-position countback determine the position, matching the championship table. Lower-ranked teams receive more. RP carries across seasons, bounded at 100,000.

Valid practice laps award three one-time programmes per weekend:

| Programme | Requirement | RP |
|---|---|---:|
| Clean lap | One valid practice lap | 100 |
| Qualifying pace | A valid lap within 112% of the track's reference pace | 150 |
| Race run | Three valid practice laps | 200 |

Awards originate from the actual race-session valid-lap event, are saved immediately, and close when qualifying sets the grid. Re-entering practice retains completed programmes.

## Workforce, facilities and spending

Engineering starts with 20 workers. Recruit/dismiss in groups of 10, up to 100. Recruitment costs $10k per added worker. Payroll is $4.5k per worker after each race, included in the existing finance forecast and ledger. More workers increase RP income, shorten new projects and reduce manufacturing risk. Changes affect newly commissioned projects; committed quotes retain their promised timing and risk.

Research and manufacturing each start with one independent project slot. The corresponding facility's level 2 opens a second slot. Each facility level reduces new project duration by 8%. Quality-control improvements reduce per-copy failure risk by 1.8 percentage points per level. Base risk is 8%, further reduced by workforce and technical leadership, with a 1% floor. Outcomes use the saved career seed and monotonic project ID, so reloading cannot reroll them.

The seasonal spending allowance is $4m per calendar round. Season outlays after engineering initialization are displayed against it. New manufacturing, engineering recruitment and engineering-facility orders cannot exceed available cash or remaining allowance. Ongoing payroll remains an operating obligation. Existing careers' already-paid spending is grandfathered when the new system initializes. The allowance resets next season; no cash is replenished by that reset.

## Seasons, regulations and compatibility

With three rounds remaining, a seeded department is announced for next season's regulation change. Research can adapt each affected completed design for 45% of its base RP cost before the final qualifying session. At the boundary, adapted and unaffected fitted gains are integrated into that seat's permanent car foundation. Unadapted current-season fitted gains in the affected department are excluded. Previously integrated foundations remain.

Each season opens a fresh sixteen-design programme, starting with minor upgrades. Research/design completion, fitment lists, stock and project queues reset. This does not reset earned car performance: per-seat foundations accumulate retained gains without counting them twice. Unfinished research returns RP for its remaining work; unfinished manufacturing returns the remaining proportion of its recorded cash cost. Unfitted stock is recycled for 50% of the standard one-copy manufacturing price. RP, facilities, workforce and history remain. The project serial stays monotonic, so new seasons cannot reroll manufacturing outcomes by reusing old IDs.

Car comparison uses an absolute performance index: 700 PI is the initial leader. Rivals and your own team keep their progress rather than being normalised back to a 100% leader each year. The display scale expands as the field improves. Physical improvements above the reference car have diminishing returns, preventing decades of upgrades from producing unlimited engine speed; the same hardware rules apply to player and AI cars.

Previous generic upgrade gains remain part of the baseline. Previously paid generic projects finish as promised; they cannot be commissioned through the new UI. Old data without an engineering state remains readable, and all nested engineering fields, queues, part IDs, stock counts, fitments, numerical values and histories are validated on load.

Implementation is in `src/career/engineering.ts`, with race/season hooks in `career.ts`, actual practice-lap events in `raceScreen.ts`, and UI in `engineeringScreen.ts`. Regression tests cover the full research/manufacture/fit loop, one-car physics and AI effects, deterministic partial failures, stock and reload persistence, prerequisites, workforce/payroll, cost limits, practice rewards, regulation adaptation, new-season rebasing and existing-save compatibility.
