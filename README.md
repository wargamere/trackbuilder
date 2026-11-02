# Ink Circuit (working title)

Draw a racetrack, freehand or dot by dot, then race it in 3D against your own ghost. Built for CrazyGames (HTML5), and also playable as a standalone web build.

**Twist: limited ink.** Every track is drawn from one pot of ink (2400 m of road). The ink you don't use becomes a score multiplier, and every tight corner adds a bonus on top. Short, twisty tracks are harder to drive fast but pay out more. The ink meter and a live multiplier are shown while you draw. All of these values can be tuned in `src/config/track.ts` (`INK`).

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
              handling.ts (all car, input and camera tuning), race.ts (race rules)
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
  race/       raceScreen.ts (fixed-step loop, interpolation, pause), session.ts
              (countdown, checkpoints, lap timing, splits), ghost.ts, records.ts,
              resultsScreen.ts
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

### Track editor

A track is a closed loop of **dots** with a smooth spline through them (`TrackDef.control`), and that is the only thing stored.

- **Draw mode:** draw one stroke. If you stop short of the start, the loop closes itself. Smoothing (in Options) sets how much hand wobble is removed and how tight a drawn corner may stay: Sharp 6 m, Normal 10 m, Smooth 22 m.
- **Dots mode:** click to place dots, then click the first dot (or press Enter) to close the loop. Click the road to insert a dot.
- **Both modes:**
  - drag any dot to reshape the track;
  - right-click or double-tap a dot to delete it;
  - drag the start flag to move the start line;
  - Undo (Z) and Redo (Y / Shift+Z), Clear (C), switch mode (M), Reverse direction (R);
  - snap to grid (G), track name, sample tracks (Options, O).
- **Validation runs live** and marks the problem spot:
  - too short or too long (out of ink);
  - corner tighter than 4.5 m;
  - two stretches too close together;
  - a crossing that is too shallow or on the start line.

  Tracks *may* cross themselves: the road is drawn without writing depth, so a flat crossroads doesn't flicker, and the car tracker searches near its last position, so it stays on its own stretch.

Freehand pipeline: raw stroke → merge points closer than 2 m → trim any overshoot, or close the gap → resample every 6 m → Taubin de-jitter → open up corners tighter than the smoothing level's radius → Douglas-Peucker to editable dots (1.6 m tolerance, at most 70 m apart) → round to 0.5 m.

### Time trial

3-2-1-GO, then 3 laps. The timer starts when you cross the line. Ten checkpoints sit around the lap, and a lap counts only if you pass them in order, driving along the track. A jump of more than 3 m along the track in one physics tick (cutting across the grass to another stretch, or a reset) never passes a checkpoint. Lap times are interpolated within the 120 Hz tick. Each checkpoint shows a split against your best lap, and driving backwards shows "Wrong way!".

Your best lap is recorded tick by tick and replayed as a translucent ghost. The results screen shows the total time, each lap, the best lap and a score: average speed on your best lap × ink multiplier × 10. Bests and ghosts are kept for the session; Phase 5 will save them.

## Status

- [x] Phase 1: track drawing (2D editor)
- [x] Phase 2: 3D track
- [x] Phase 3: car and driving
- [x] Phase 4: race / time trial (plus a bigger editor upgrade: dots mode, crossings, tighter corners)
- [ ] Phase 5: track library, sharing, audio
- [ ] Phase 6: CrazyGames SDK
