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

## Web deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests, builds the web version and publishes `dist/web` to Pages. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. With "Deploy from a branch", Pages serves the raw source `index.html`, which can't run without Vite, so you get a blank page.

## Layout

```
src/
  config/     strings.ts (all UI text), track.ts (track + ink tuning),
              handling.ts (all car, input and camera tuning)
  core/       math, screen/state types, 2D canvas surface, fixedStep.ts
  editor/     drawing.ts (editor screen + input), smoothing.ts, validation.ts,
              pipeline.ts (stroke -> track), render2d.ts
  track/      spline.ts (centripetal Catmull-Rom -> evenly spaced centre line),
              corners.ts, ink.ts, track.ts (TrackDef/Track), samples.ts,
              mesh.ts (road ribbon + kerbs), scenery.ts (trees, cones, gantry)
  render/     view3d.ts (renderer, sky, ground, hills, lights), textures.ts
              (procedural canvas textures), geom.ts (merge/tint helpers)
  car/        physics.ts (fixed-step arcade physics), input.ts (keyboard, gamepad,
              touch), model.ts (low-poly car), camera.ts (chase + bonnet)
  race/       raceScreen.ts (fixed-step loop, interpolation, pause)
  ui/         dom helpers, editor overlay, HUD, style.css
  platform/   platform.ts (build-time PLATFORM flag)
  main.ts     state machine: RACE (boot) ⇄ EDITOR ⇄ RESULTS ⇄ LIBRARY
```

### 3D scene

Everything static is merged or instanced, which comes to about 10 draw calls for a whole track: sky, ground, hills, road, kerbs, the gantry frame, one atlas mesh for the banner and start line, two instanced tree meshes and instanced cones. All textures are drawn on small canvases at startup. Lambert materials, no shadows. In dev builds (`npm run dev`) the race HUD shows fps, draw calls and triangles.

### Driving

Physics runs at a fixed 120 Hz from an accumulator (`core/fixedStep.ts`), and rendering interpolates between the last two physics states. Nothing in `car/physics.ts` reads the clock or the frame time, so the same inputs give the same result at any refresh rate (a test checks 60, 144, 240 Hz and jittery frame times give identical ticks). The model is hand-written arcade physics: an engine force that fades towards top speed, brakes, reverse, drag, steering lock that shrinks with speed, a yaw rate limited by tyre grip (slightly over-allowed, so the car drifts a bit), lateral grip that bleeds off sliding, much less grip and speed on grass, a handbrake and tree collisions.

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Drive | W / ↑ | RT or A | GAS |
| Brake / reverse | S / ↓ | LT or X | BRAKE |
| Steer | A D / ← → | left stick, D-pad | ◀ ▶ pads |
| Handbrake | Space | B | — |
| Reset to road | R | Back | pause menu |
| Camera (chase / bonnet) | C | Y | — |
| Pause | Esc / P | Start | Ⅱ button |

### Track pipeline

Raw pointer stroke (world metres) → merge points closer than 2 m → find where the stroke returns to its start and trim any overshoot → resample every 10 m → Taubin smoothing → relax corners tighter than a 10 m radius → quantise to 0.5 m → **TrackDef** (the canonical, storable form) → centripetal Catmull-Rom → evenly spaced centre line (2.5 m) with tangents, signed curvature and distances → validation (length, crossing, parts of the track too close together, corners too tight).

## Status

- [x] Phase 1: track drawing (2D editor)
- [x] Phase 2: 3D track
- [x] Phase 3: car and driving
- [ ] Phase 4: race / time trial
- [ ] Phase 5: track library, sharing, audio
- [ ] Phase 6: CrazyGames SDK
