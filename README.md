# Ink Circuit (working title)

Draw a racetrack in one stroke, then race it in 3D. Built for CrazyGames (HTML5), and also playable as a standalone web build.

**Twist: limited ink.** Every track is drawn from one pot of ink (1600 m of road). The ink you don't use becomes a score multiplier, and every tight corner adds a bonus on top. Short, twisty tracks are harder to drive fast but pay out more. The ink meter and a live multiplier are shown while you draw. All of these values can be tuned in `src/config/track.ts` (`INK`).

## Commands

```bash
npm install
npm run dev          # web build, dev server
npm run dev:cg       # same, with PLATFORM = 'crazygames'
npm test             # geometry/validation unit tests (Node test runner)
npm run build:web    # -> dist/web, prints the build size
npm run build:cg     # -> dist/crazygames, prints the build size
```

Each build is `index.html` at the root plus one JS file. All paths are relative (`base: './'`). `scripts/size.mjs` fails the build if any asset path is absolute or the total is over 20 MB.

## Layout

```
src/
  config/     strings.ts (all UI text), track.ts (track + ink tuning)
  core/       math, screen/state types, 2D canvas surface
  editor/     drawing.ts (editor screen + input), smoothing.ts, validation.ts,
              pipeline.ts (stroke -> track), render2d.ts
  track/      spline.ts (centripetal Catmull-Rom -> evenly spaced centre line),
              corners.ts, ink.ts, track.ts (TrackDef/Track), samples.ts
  race/       previewScreen.ts (Phase 1 placeholder for the 3D race)
  ui/         dom helpers, editor overlay, HUD, style.css
  platform/   platform.ts (build-time PLATFORM flag)
  main.ts     state machine: RACE (boot) ⇄ EDITOR ⇄ RESULTS ⇄ LIBRARY
```

### Track pipeline

Raw pointer stroke (world metres) → merge points closer than 2 m → find where the stroke returns to its start and trim any overshoot → resample every 10 m → Taubin smoothing → relax corners tighter than a 10 m radius → quantise to 0.5 m → **TrackDef** (the canonical, storable form) → centripetal Catmull-Rom → evenly spaced centre line (2.5 m) with tangents, signed curvature and distances → validation (length, crossing, parts of the track too close together, corners too tight).

## Status

- [x] Phase 1: track drawing (2D editor)
- [ ] Phase 2: 3D track
- [ ] Phase 3: car and driving
- [ ] Phase 4: race / time trial
- [ ] Phase 5: track library, sharing, audio
- [ ] Phase 6: CrazyGames SDK
