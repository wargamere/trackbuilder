# Track Builder 3D

Draw a racetrack, freehand or dot by dot, then race it in 3D against your own ghost. Built for CrazyGames (HTML5), and also playable as a standalone web build.

**Build for the fun of it.** The track editor has no ink budget or length-based multiplier. Start freehand, place points, pick one of four visual starter layouts, or remix a surprise circuit. Track geometry still needs to be drivable: the editor explains problems, zooms straight to them, and can fix them for you. Once you stop editing, a little car drives the track's gold-medal lap on the map.

## Commands

```bash
npm install
npm run dev          # web build, dev server
npm run dev:cg       # same, with PLATFORM = 'crazygames'
npm test             # geometry, physics, racing and editor interaction tests
npx playwright install chromium # one-time browser test setup
npm run test:browser  # real-browser editor checks + screenshots in test-results/
npm run build:web    # -> dist/web, prints the build size
npm run build:cg     # -> dist/crazygames, prints the build size (ads off: Basic Launch)
npm run build:cg:ads # same with video ads enabled (Full Launch)
```

Each build is `index.html` at the root plus one JS file. All paths are relative (`base: './'`). `scripts/size.mjs` fails the build if any asset path is absolute or the total is over 20 MB.

## Web deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests, builds the web version and publishes `dist/web` to Pages. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. With "Deploy from a branch", Pages serves the raw source `index.html`, which can't run without Vite, so you get a blank page.

## Layout

```
src/
  config/     strings.ts (all UI text), track.ts (track geometry tuning), themes.ts,
              handling.ts (all car, input and camera tuning), race.ts (race rules)
  core/       math, screen/state types, 2D canvas surface, fixedStep.ts
  editor/     drawing.ts (editor screen + input), smoothing.ts, validation.ts,
              pipeline.ts (stroke -> track), render2d.ts, viewport.ts (zoom/pan),
              pen.ts (lazy pen), splice.ts (redraw a section), heights.ts
              (soft editing, hills), profile.ts (height profile graph),
              transform.ts (resize / rotate / mirror), preview.ts (3D view),
              starters.ts, draft.ts, repair.ts ("Fix it"), previewCar.ts
              (the gold-lap car on the map)
  track/      spline.ts (centripetal Catmull-Rom -> evenly spaced centre line),
              corners.ts, track.ts (TrackDef/Track), samples.ts,
              catalog.ts + data/ (the built-in tracks: generated and real circuits),
              mesh.ts (road ribbon, kerbs, barriers, bridge decks), surface.ts
              (terrain, decks, barrier and pillar placement), pits.ts (pit
              layout), stats.ts (stats strip numbers), ground.ts (ground
              under a car), scenery.ts (trees, cones, gantry), code.ts (track
              codes), library.ts (saved tracks)
  render/     view3d.ts (renderer, sky, ground, hills, lights), textures.ts
              (procedural canvas textures), geom.ts (merge/tint helpers),
              racingLineOverlay.ts (the racing line assist), rain.ts (rain),
              pitBoxMesh.ts (the pit box on the road)
  car/        physics.ts (fixed-step arcade physics), gearbox.ts (six gears),
              tyres.ts (kinds of tyre, wear curve),
              bindings.ts (keyboard keys),
              contact.ts (car-to-car bumps), slipstream.ts (drafting), input.ts
              (keyboard, gamepad, touch),
              model.ts (low-poly car), camera.ts (chase + bonnet)
  race/       raceScreen.ts (fixed-step loop, interpolation, pause), session.ts
              (countdown, checkpoints, lap timing, splits, race distance), ghost.ts,
              records.ts, resultsScreen.ts, timing.ts (gaps between cars), weather.ts (changing weather), ai.ts (AI opponents), racingLine.ts
              (line + speed plan), driver.ts (drives it), traffic.ts (racing other
              cars), bot.ts (test driver), medals.ts (medal times), assists.ts
              (braking and steering assists), pitStop.ts (pit box and pit stops),
              strategy.ts (tyre life per track, AI tyre choices)
  ui/         dom helpers, menuScreen.ts (main menu), setupPanel.ts (car setup), raceSetupScreen.ts (race
              setup), assistsPanel.ts, conditionsPanel.ts (rain, time of day,
              tyre wear), controlsPanel.ts (key bindings), gridOverlay.ts (grid after qualifying), editor overlay, HUD,
              minimap, pause menu, touch controls,
              libraryScreen.ts (track library), shareDialog.ts, style.css
  audio/      audio.ts (synthesised engine, tyre squeal, grass rumble, rain, beeps)
  platform/   platform.ts (PLATFORM flag + CAPS), services.ts (what the game calls:
              loading/gameplay events, ads, user, device), crazygames.ts (SDK wrapper),
              storage.ts (key-value store), web.ts (share links, rotate prompt)
  main.ts     state machine: MENU (boot) → SETUP → RACE (practice or race) →
              RESULTS, with EDITOR, PREVIEW and LIBRARY
```

### 3D scene

Everything static is merged or instanced, which comes to about 15 draw calls for a whole track: sky, terrain, outer ground, hills, road, bridge decks, kerbs, barriers, pillars, the gantry frame, one atlas mesh for the banner and start line, two instanced prop meshes and instanced cones. All textures are drawn on small canvases at startup. Lambert materials, no shadows. In dev builds (`npm run dev`) the race HUD shows fps, draw calls and triangles.

**Elevation.** Every dot has a height (0–40 m, in 0.5 m steps) and the spline carries it round the loop. The road banks into corners (off / 7° / 15°, scaled by how tight the corner is). Any corner can have its own angle instead: the override is stored on that corner's dots (`Dot.b`) and blends to the neighbours'. `track/surface.ts` builds the ground from the road: a 5 m heightfield that follows the road, with the shoulders tilted like the road, and fades back to flat 55 m away. On a road's own shoulder that road decides the height, so a raised road keeps its embankment next to a lower stretch; where two shoulders overlap (under a bridge) the lower road wins, and between roads the ground slopes from one to the other. On the inside of a banked corner the ground stays level with the road's low inner edge. The ground sits flush with the road (3 cm under it). A final pass pushes it down wherever it would show through the road or a kerb. The check is exact: the terrain mesh and `terrainHeight()` split every 5 m cell along the same diagonal, and each drawn road and kerb triangle is tested at every point where the two surfaces can meet (its corners, grid nodes inside it, and where its edges cross grid lines and cell diagonals; see `forEachGroundProbe`). It only lowers the ground where there really is road, so it digs no pits inside hairpins, and each grid point only by its share, so there's no trough beside the road. A 2.6 m skirt in the ground's colour hangs under the road's outer edge for where the ground falls away. Road above the ground there becomes a **bridge deck** with concrete sides, rails and pillars, and no pillar stands on a road below.

**Barriers** (optional per track, always on decks) run along both edges, with gaps where another stretch at the same level comes through. They are either concrete (red and white on top) or tyre walls.

**Track edges and width.** Roads are any width from 8 to 20 m (0.5 m steps); the barriers, kerbs, run-off, gantry and the "too close" check all follow the width.
- Kerbs are raised (a bump), flat (painted) or off. They run along the outside of every corner and along the inside around the apex. The inside kerb follows the road's real inner edge and stops short where a hairpin is too tight for it.
- Run-off out to the barrier line is grass, gravel (slower than grass) or tarmac (no penalty). Beyond it is always grass.

**Pits.** A white pit building with up to ten team-coloured garages and a pit lane stands behind the barrier beside the start straight, on whichever side has room. It needs about 30 m of straight either side of the start line; otherwise the editor says so. The ground under it is levelled, trees keep clear, and the car can't drive through it.

**Sunset** recolours the sky, fog and light and drops the sun low in the west. **Night** (a track option too, or chosen for a race) is a dark-blue sky with stars and a dim moon; the road, run-off and kerbs are floodlit (lit evenly, however dark the rest), the ground is darker, and the cars' head and tail lights glow. Your own car has a real headlight beam (with full graphics). Race conditions are below, under Races.

**Scenery themes:** Meadow (pines and broadleaf trees), Desert (cacti and rocks) and Snow (snowy pines). Each recolours the sky, fog, light, hills and ground texture.

### Driving

Physics runs at a fixed 120 Hz from an accumulator (`core/fixedStep.ts`), and rendering interpolates between the last two physics states. Nothing in `car/physics.ts` reads the clock or the frame time, so the same inputs give the same result at any refresh rate (a test checks 60, 144, 240 Hz and jittery frame times give identical ticks). The model is hand-written arcade physics: an engine force that fades towards top speed, brakes, reverse, drag, steering lock that shrinks with speed, a yaw rate limited by tyre grip (slightly over-allowed, so the car drifts a bit), lateral grip that bleeds off sliding, much less grip and speed on grass, and tree collisions. (The physics still has a handbrake, but nothing is bound to it for now.) On hills gravity pulls along the slope. Banked corners add grip (more when the bank leans into the turn). Barriers push the car back with a small bounce: a glancing hit scrubs a little speed and a square one a lot, with a knock and a camera jolt. The car, the ghost and the camera follow the ground's height, pitch and roll.

| | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Drive | W / ↑ | RT or A | GAS |
| Brake / reverse | S / ↓ | LT or X | BRAKE |
| Steer | A D / ← → | left stick, D-pad | ◀ ▶ pads |
| Reset to road | R | Back | pause menu |
| Restart the lap (practice) | R R (twice quickly) | Back Back | pause menu: Back to the grid |
| Gear up / down (manual gears) | E / Q | RB / LB | ▲ ▼ buttons |
| Camera (chase / bonnet) | C | Y | — |
| Pause | Esc / P | Start | Ⅱ button |
| Timing tower (full / compact / hidden) | T | — | tap it (full / compact) |

**Your own keys** (`car/bindings.ts`, `ui/controlsPanel.ts`). The keyboard keys above are the defaults. ⌨ Controls, in the main menu and the pause menu, changes them: every driving action (drive, brake, steer left and right, gear up and down, reset, camera, pause, sound, timing tower) has two keys. Click one and press the new key; Esc cancels and Backspace clears it. A key already used by another action moves over, and the panel says from where. Reset to defaults puts them all back. Esc always pauses whatever you set, and Tab, Ctrl, Alt and the system keys can't be bound. Keys are physical keys (`KeyboardEvent.code`), shown as your keyboard layout prints them where the browser can say (Z for W on AZERTY). The race's controls hint, the pause menu and the assists panel all show your keys. The gamepad and touch controls don't change.

**Gears** (`car/gearbox.ts`, tuning in `HANDLING.gearbox`). The car has six gears; the HUD shows the gear (R when reversing), AUTO or MAN, and a rev bar.
- *Revs:* the engine pulls fully from half the revs to 90 % of the limit, less low down (except in 1st, where the clutch slips to get going), tailing off above 90 %, and not at all on the limiter. Changing up at 90 % lands in the full band of the next gear.
- *Manual:* E / Q (RB / LB, ▲ ▼ on touch) change up and down, one gear per press, instantly. A change down that would over-rev is refused, and the car drops to 1st when it stops. The rev bar turns red from the change-up point and flashes on the limiter. Leave it in too high a gear out of a corner and it pulls weakly; leave it in too low a gear and it sits on the limiter.
- *Automatic (the default):* changes at the same revs as the AI, but each change up cuts the drive for 0.2 s. That makes it a little slower than changing gear yourself at the right revs: about 0.6 % a lap on average (0.15–1 % depending on the track), say 0.2–0.4 s on a 40-second lap.
- *AI cars and the medal bot* change instantly at the ideal points, so they drive exactly as before gears existed (medal times are unchanged, and a test checks it).
- The engine sound follows the real revs, dropping at every change up.

**Assists** (`race/assists.ts`, the 🛞 Assists button in the race setup (A) and the pause menu; remembered between visits):
- *Racing line* (Off / Braking / Full, `render/racingLineOverlay.ts`): the AI's racing line drawn on the road for the next 170 m, following its height and banking. Each point is coloured by what to do when you get there at the speed you're doing now: green (keep going), yellow (lift: within 8 % of the limit there) and red (brake: the corner's limit there, braking included, is below your speed). So the red starts exactly where you would have to start braking, and moves as you speed up or slow down. "Braking" draws only the yellow and red.
- *They help, they don't drive:* hold the throttle with your hands off and the car won't get round a lap, even with everything on (a test checks this on each sample track).
- *Braking assist:* coming into a corner faster than the racing line allows, it touches the brakes (18 %) if you aren't braking, or tops your braking up by up to 35 % if you are. It never lifts your throttle. Not enough on its own: you still have to brake.
- *Steering assist:* while you're not steering it eases you back towards the racing line, in proportion to how far off it you are and against heading away from it, so it settles onto the line instead of swinging across it. It never steers more than a fifth of the lock: it holds the line on straights and gentle bends, but a real corner needs you. The more you steer the less it does, and at full lock (any key press) it does nothing.
- *The line's pace:* the racing line (its colours, and what the braking help aims for) is driven at 80 % of the tyres' grip and 66 % of the brakes, a little short of gold medal pace (about 1.5 % slower). Tests check that each assist gets a driver who never brakes, or never steers, further than without it, and that the steering assist alone can't do the steering.

### Track editor

A track is a closed loop of **dots** with a smooth spline through them (`TrackDef.control`), plus its options, and that is the only thing stored.

**Layout.**
- **Look:** the same as the rest of the game: cream panels, blue ink, bold outlined buttons, yellow for the main action (Race it, Start drawing, Fix it), and the blue-gridded paper.
- **Sidebar:** seven named sections with icons and summaries. Docked at 900 px and wider; an expandable icon rail on smaller screens. Save, Share, Test drive and Race are grouped at the bottom (on short screens they share one row, so the sections keep the room).
- **Top bar:** visible Freehand / Reshape / Elevation / Pan tools, undo/redo, a fresh page, 3D view and a Quick guide. A status line explains the next step; Close loop, **Fix it** and Show me appear when useful. Phones on their side get two slim rows.
- **Stats strip** along the bottom: length, corners, **gold lap**, longest straight, max gradient, elevation change and tightest radius (hidden on a blank page). In Elevation mode the height profile sits above it.
- **On the map:** numbered corners with their bank angle, the pit building, the run-off colour, and the preview car. Dots shrink when they'd crowd each other (zoomed out, or on a phone).
- **Blank page:** a welcome card in the middle of the paper with the four starting shapes (the same thumbnails as the track library), Start drawing and Surprise me. You can draw straight through it.

| Section | What's in it |
|---|---|
| 1 Draw | **Pick a track** to edit (your saved ones, the game's, the real circuits, or paste a code), how you draw (Freehand / Dots), **generate one** (Grand Prix / Flowing / Technical / Street / Oval / Kart), Surprise me, a blank page, **trace an image**, smoothing, snap, soft editing, the starters and samples, and precise point controls |
| 2 Size & shape | **Track length** slider, road width slider (8–20 m, with 10 / 12 / 15 m shortcuts), **terrain climb** slider (flat to 40 m) and flat / rolling / hilly presets, smooth heights, **corner smoothing** slider, smaller / bigger / rotate / mirror the whole track |
| 3 Corners | Banking level for the whole track (off / normal / steep), **banking for every corner at once** (shows Mixed when they differ), ‹ › to step from corner to corner, Flatten all, Back to the level; the picked corner's **run-off** (Auto / Gravel / Tarmac / Grass) and **bump kerb**; run-off for every corner; bump kerbs **on every chicane** (and remove them); **paint run-off** with a brush (gravel / tarmac / grass / erase, brush size, undo / redo stroke, clear); and a bank slider (0–30°) for every numbered corner, with Auto to go back to the level; tap a corner's number to zoom to it |
| 4 Start & pits | Laps per race (1 / 3 / 5), pit building on/off, move the start/finish line 10 m back or on, reverse direction |
| 5 Track edges | Kerbs (raised / flat / painted / none), run-off (grass / gravel / tarmac), barriers (none / concrete / tyres / TecPro / Armco), **barrier distance** (2.8 m to 32.8 m from the road), where the track crosses itself: **bridges or tunnels**, and **Lift level crossings** |
| 6 Scenery & world | **Ground** (tarmac / dirt / snow), landscape (Countryside / Alpine / Desert / Snow / Forest / City), day / sunset / night, few / normal / lots of trees, **place scenery** by tapping the map (grandstand, pit garages, tower, building, trees, billboard, brake boards) |
| 7 Display | Graphics full / fast, km/h or mph, minimap in the race, corner numbers on the map, the preview car (player settings, not part of the track) |

**New tools in Draw, Size & shape and Corners.**
- **Pick a track** opens a list (your saved tracks, the game's tracks, the real circuits) or a box to paste a track code or link into. Whatever you pick loads as a copy of your own, one undo step.
- **Generate one** (`editor/generate.ts`) makes up a new track in a style, checked to build, not cross itself and fit the paper (it tries the next seed if not):
  - *Grand Prix*, *Flowing*, *Technical* and *Kart*: the hull of random points, its edges bent in and out, points too close pushed apart, then smoothed with the corners opened up to the style's tightest radius (Kart: small, 8 m wide, tight hairpins, no pits; Flowing: nothing under 32 m).
  - *Street*: the outline of a random block of city squares, so straights and right-angle corners, with walls.
  - *Oval*: two long straights and two big banked ends, sometimes a tri-oval.
  - Each starts a little way along its longest straight, gets options to suit, and some get rolling hills.
- **Trace an image**: load a picture (a map, a sketch) under the paper and draw over it, with see-through and size sliders. It's only read into the open tab: never uploaded, saved or shared.
- **Track length** scales the whole track about its middle (as far as the paper allows); **Terrain** sets the climb from the lowest to the highest point and keeps the hills' shape (a flat track gets new rolling hills); **Corner smoothing** opens up every corner tighter than the radius you pick. Each slider drag is one undo step.
- **Banking, every corner** sets every corner's bank at once; Flatten all sets them all to 0°, and Back to the level clears them.

**Track edges and the world around it.**
- **Barriers:** concrete (red and white tops), tyre walls, TecPro (big blue, red and white foam blocks) or Armco (a steel rail on posts). All four stop a car the same way.
- **Barrier distance** moves the barriers further out, with the run-off (gravel, tarmac or grass) reaching out to them. Where two stretches of road run closer than twice the distance, the barriers between them give way rather than stand on the other road's run-off.
- **Kerbs:**
  - Raised: a hump.
  - Flat: barely raised.
  - Painted: a narrower stripe of paint on the road.
  - None.
  Kerbs always count as track.
- **Ground** (`HANDLING.roads`): the road itself can be tarmac, dirt or snow.
  - On dirt the car has about ¾ of the grip and the brakes about ¾ of the bite; on snow a little over half of each. It also pulls away more slowly on both.
  - The AI's speed plan, the medal laps, the racing line and the assists all plan with the same, so they brake earlier too.
  - Gold laps are about 9 % slower on dirt and 20 % slower on snow.
  - The road is brown with ruts, or white with packed tyre tracks, in 3D and on the editor's map.
- **Landscapes** (`config/themes.ts`):
  - Countryside (as before), Desert and Snow;
  - **Alpine:** high meadows, pines and grey boulders under tall snowy peaks;
  - **Forest:** trees right up to the barriers;
  - **City:** offices and low blocks square to a street grid, standing well clear of the barriers, with a low skyline on the horizon. Pick the time of day for a city by day or by night.

**Placed scenery, run-off and bump kerbs** (`track/extras.ts`). These go on the track as well as its dots and options, in world metres, so they stay where they were put when the road is reshaped. Anything the road now runs over is shown struck out and left out of the race.
- **Place scenery:** pick a kind, then tap beside the track.
  - Each thing faces the road (brake boards run along it, their 3-2-1 boards facing the cars coming) and is moved out just far enough to clear it. Big things go behind the barriers; billboards and brake boards just past the kerbs.
  - Tap one again to take it away; Esc or Done stops placing.
  - Cars hit them: they're obstacles in the physics, like the trees.
- **Run-off per corner:**
  - The picked corner (‹ › or its row) can have Auto (as the track's run-off), gravel, tarmac or grass beside it; "Run-off, every corner" sets them all.
  - Under the hood this paints a coarse 4 m grid over the paper, which the **run-off brush** paints too (gravel, tarmac, grass or erase, 2–16 m). Each stroke is one undo step, so Undo / Redo stroke are the usual undo and redo.
  - The physics, the 3D run-off and the map all read the run-off stretch by stretch from it.
- **Bump kerbs:**
  - A yellow sausage just past the inside kerb at a corner's apex (not where the corner's too tight for one), for the picked corner or on every chicane.
  - Running over one costs about 7 % of your speed and kicks the car sideways. The AI's line never touches them: its lap times on Monza, Baku and Imola are the same with or without.
- **Saving and sharing:** all of it is saved with the track, in drafts and in track codes (v5 extras: placed things as kind, position and a 1/64-turn rotation; the paint grid run-length coded), and is part of the track's id.

**Bridges or tunnels** (`track/tunnels.ts`). Where the track crosses itself at two heights, the upper road can be on a bridge (a deck on pillars) or the lower road can go through a tunnel.
- A tunnel is as long as the road above and its shoulders are wide: walls outside the lower road's barriers, a roof slab, a portal face at each end, and no pillars.
- The ground already rises with the upper road on its own shoulders, so it sits on an embankment over the tunnel.
- Level crossroads stay level until **Lift level crossings**, which raises the later road 7.5 m over the earlier one at every one of them, as Fix it does for a crossing that can't be level.

**Fast starts and accessible editing.** Starter cards show the real layout before loading it. Surprise me uses the tested generated-track catalog, with mirrored and reversed variants, and creates an editable copy. Every layout change is undoable. Reshape is the initial tool for an existing track; a new blank page switches to Freehand.

**Precise controls.** Select a dot on the canvas or use Previous/Next point in Draw. Move it with the arrow buttons or keyboard (Shift = 5 m); in Elevation, ↑/↓ changes height. Raise/lower and Delete have visible controls. Size & shape includes Soften tight corners. Larger touch hit areas make dots easier to grab. Inputs and buttons are keyboard reachable, fields are named, tool selection and sidebar expansion are exposed to assistive technology, and status messages are announced.

**🔧 Fix it** (X) shows next to the message whenever the track has a problem, and mends it as little as it can (`editor/repair.ts`). It looks at what's wrong and fixes that, again and again (up to 10 rounds), until the track is good:
- a line that didn't make a loop: its ends are joined (a tiny scribble is grown first);
- a corner too tight: opened up just there (with more dots first if there are too few to round it off);
- two roads too close: pushed apart only where they are too close, a little at a time and smoothed along the road (at most 30 m), or, if that isn't enough, the road is made 2 m narrower (not below 8 m);
- too short: grown;
- a crossing that can't be level (too shallow, too near the start, or at an awkward height): the later road is lifted 7.5 m over the earlier one as a bridge, or dropped under it if the earlier one is already high;
- too steep: the heights are smoothed.

The message says what it did ("Fixed! I opened up a corner that was too tight."), and it's one undo step. Closing a loop, or fixing one, throws a little confetti (not with reduced motion).

**Preview car and gold lap** (`editor/previewCar.ts`). Once you stop editing for half a second, the gold-medal bot drives the track: the same simulated flying lap that sets the medal times in a race, worked out a slice per frame (1,200 physics ticks) so editing never stutters. Its time shows as **Gold lap** in the stats strip, exactly as the race will show it, and the car replays the lap on the map at real speed in your paint colour. It can be turned off under Display, and is off by default when the system asks for reduced motion.

**Draft recovery.** Changes are backed up after a short idle period, when leaving the editor, and when the page is hidden. Recover last draft restores unfinished work and is itself undoable. A blank page preserves the last useful draft. Save remains the deliberate way to add a finished track to My tracks. Drafts use the existing platform store and are separate from saved tracks. Editing and menus are available in portrait; racing keeps the landscape prompt.

The **3D view** (V, or the ◈ button) shows the track being edited from an orbiting camera. Drag to look around and scroll or pinch to zoom. Esc goes back to the editor with the edit untouched, and Enter races it.

- **Freehand mode:**
  - draw one stroke; if you stop short of the start, the loop closes itself;
  - the pen is "lazy": the pen tip trails the pointer on a short string, so hand wobble never reaches the paper. The string is longer with more smoothing, and a little longer for fingers;
  - **redraw part of a track:** start a line on the road and end it on the road. The stretch between is replaced (shown in red while drawing), and the other dots don't move. Drawing against the direction of travel replaces the stretch behind;
  - Smoothing (sidebar, section 1) sets how much wobble is removed and how tight a drawn corner may stay: Sharp 6 m, Normal 10 m, Smooth 22 m.
- **Reshape mode:** click to place dots, then click the first dot (or press Enter) to close the loop. Click the road to insert a dot.
- **Elevation mode:**
  - drag dots up and down on the map, or by their handles in the height profile along the bottom (amber where the road is as steep as allowed; crossings marked grey for level, blue for bridges);
  - click the road to add a dot at the road's height there;
  - Random hills (H) makes rolling hills that keep every crossing level or a proper bridge; there are also Smooth and Flatten;
  - the road is coloured by height.
- **All modes:**
  - drag any dot to reshape the track. **Soft editing** (on by default) moves the neighbouring dots part of the way too, so curves and hills stay smooth; hold Shift to move just one dot;
  - right-click or double-tap a dot to delete it;
  - drag the start flag, or the start/finish line itself, anywhere along the road to move it (a dot is added there if needed);
  - **zoom and pan:** mouse wheel or pinch to zoom (up to 8×), drag with two fingers, the middle button or Space held to move around, and buttons for +, − and fit (+ / − / F);
  - Undo (Z) and Redo (Y / Shift+Z), Clear (C), switch mode (M), Reverse direction (R), Fix it (X);
  - O opens or closes the sidebar section; the track name is at the top of the sidebar.
- **Validation runs live** and marks the problem spot:
  - too short to drive (there is no maximum length budget);
  - corner tighter than 4.5 m;
  - two stretches too close together (unless one passes 6 m over the other);
  - where the road crosses itself, the two roads must be level (within 1 m), or one at least 6 m higher for a bridge;
  - a level crossing must not be too shallow or on the start line.

  Slopes never block a track: anything steeper than 45% is eased out when the road is built (the top of the climb comes down a little and the bottom up, as little as possible), and the editor says so.

  Level crossings work because the ground-level road is drawn without writing depth, so a flat crossroads doesn't flicker, and the car tracker searches near its last position, so it stays on its own stretch.

Freehand pipeline: raw stroke → lazy pen → merge points closer than 2 m → trim any overshoot, or close the gap → resample every 6 m → Taubin de-jitter → open up corners tighter than the smoothing level's radius → Douglas-Peucker to editable dots (1.6 m tolerance, at most 70 m apart) → round to 0.5 m.

### Menu, race setup and practice

The game boots to the **main menu**, with the current track turning slowly in 3D behind it. From there:
- pick a list (tabs, or ↑ ↓): **Tracks** (the game's own 23), **Real circuits** (30) or **My tracks** (yours; greyed out until you've saved one);
- pick a track in it with ‹ › (or ← →); "4 / 30" shows where you are, and a real circuit shows its country;
- **Race this track** (Enter) opens the race setup (below);
- **Draw a track** (E), the **Track library** (L), and sound / graphics / units toggles.

The **Track library** (`ui/libraryScreen.ts`) has the same three lists as tabs (yours first if you have any), with thumbnails, length and your best for each, plus Race, Edit and Share (and Delete for yours), and a box to paste a friend's track code.

### Built-in tracks

Built-in tracks (`track/catalog.ts`, listed by `builtInTracks()` in `editor/pipeline.ts`) can't be deleted or overwritten; editing one and saving makes a track of your own. A track code of a built-in track loads as that track (same records).
- **Tracks (23):** the three hand-drawn samples (Sunday Loop, Paperclip, Knot Garden), then 20 generated ones (`track/data/classic.ts`).
  - Each is a random loop from a fixed seed: the hull of 6–13 random points, its edges bent in and out at their middles, points too close pushed apart, smoothed, sized to fit, run either way round, starting on its longest straight.
  - About half get rolling hills. Each gets its own theme (meadow, desert, snow), road width, banking, run-off, kerbs, barriers, trees and time of day.
  - A loop is kept only if it's a valid road with no crossings, 1.1–2.4 km with at least 5 real bends, and an AI can lap it at medal pace and flat out.
- **Real circuits (30):** real-world layouts (`track/data/world.ts`), made from the open GeoJSON outlines in [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT licence, see `THIRD_PARTY_NOTICES.md`; the game shows it too, under the Real circuits tab). They're named after their place, with no series branding, and are unofficial.
  - The tracks: Sakhir, Jeddah, Melbourne, Suzuka, Shanghai, Miami, Imola, Monaco, Montréal, Barcelona, Spielberg, Silverstone, Budapest, Spa-Francorchamps, Zandvoort, Monza, Baku, Singapore, Austin, Mexico City, São Paulo, Las Vegas, Lusail, Yas Marina, Portimão, Istanbul, Sepang, Hockenheim, Nürburg and Mugello.
  - *Fitting:* each outline is turned to fill the drawing area best, then scaled down to fit the canvas (1.3–2.35 km; the real ones are 3.3–7 km).
  - *Start and direction:* the start is moved back up the straight if the outline began right by a bend, and they run the way the race does (Singapore's outline is drawn the other way, so it's reversed).
  - *Making it drivable:* corners too tight for the car are opened up a little. Where the real road comes back close by, the road is narrowed to 10 m (Jeddah, Miami, Monaco, Baku, Suzuka), and only if even that's not enough are those stretches pushed apart a little (Jeddah, Baku).
  - Suzuka's crossover is a bridge, the later road rising 7.5 m over the earlier one.
  - Flat (the data has no heights), with no banking, and themes, run-off and trees to suit: desert for the Gulf, night races at sunset.

Both are plain data written by `node scripts/buildTracks.ts <path to a checkout of bacinger/f1-circuits>`. The game never runs that, and `tests/catalog.test.ts` checks every built-in:
- valid, inside the drawing area, not starting in a corner;
- only Suzuka crossing itself, on a bridge;
- lapped by an AI at medal pace and flat out;
- the same track again from its code.

**Race setup** (`ui/raceSetupScreen.ts`) opens wherever you choose to race a track: the main menu, the editor's Race it (Enter), the 3D view, My tracks, the results screen's Race settings (S), the pause menu, and practice's "Start a race". Back (Esc) returns to where you came from (to the editor with your edit kept). It sets:
- **Mode:** Practice or Race (P / R).
- **Laps:** 1–50 (race only). Each track starts at its own "Laps per race" from the editor. In a long race the results screen's lap times scroll.
- **Ghost car (your record):** on or off.
- **Cars:** 1–12, counting you (1 = just you, a time trial; 12 = you and eleven AI cars). Race only.
- **AI difficulty:** 1–100 % (with AI cars).
- **Grid** (with AI cars):
  - **Qualifying:** you first drive 2 timed laps alone (no countdown). Your best clean lap sets where you start. Meanwhile each AI car's flying lap is simulated in the background at its own pace, with ±0.5 % variation so equal cars don't always line up the same. Then the grid is shown, pole first, with everyone's time and gap, and Start race (Enter). A car with no clean lap goes to the back. The pause menu has Restart qualifying and Skip qualifying (straight to the grid with what you have).
  - **Random:** everyone's slot, yours included, is drawn at random.
  - **Pick:** choose **your grid slot** (1st = pole up to the back); the AI cars fill the rest, fastest at the front.

Start (Enter) drives it. All of it except the laps is remembered between visits. "Race again" on the results screen reruns the same setup (qualifying again, or a new random draw). Restart in the pause menu restarts the race from the same grid.

**Practice** starts at once, no countdown and no AI cars, as many laps as you like. Lap times, splits, the ghost and personal bests work as in a race, but there's no lap limit and no results screen. Press **R twice quickly** (within 0.5 s, or gamepad Back twice) to restart the lap from the grid; a single R just puts the car back on the road.

The pause menu has Restart (Back to the grid in practice), Race settings and Main menu; the editor's ✕ (and Esc) and My tracks' Back return to the menu. The editor's Practice button still drives straight away, to try a track out.

### AI cars

Up to eleven AI cars (`race/ai.ts`) line up on a staggered grid, two by two, 6.5 m apart. Slots are pulled in towards the middle where the road narrows on a bend. The order comes from the setup's grid choice. The field is listed fastest first, in 12 different colours (the paints plus five AI-only colours, never yours). Each has its own car (the same physics as yours), its own lap counter and a driver on the racing line.

**Racing line** (`race/racingLine.ts`, worked out once per track). This is Rémi Coulom's K1999 method. Each point of the line is moved across the road until its curvature is the average of the curvature just before and after it, so the turning is spread as evenly as the road allows. It runs first with points 64 samples apart, then closer and closer, down to every sample. The road for this is the drawn road plus its kerbs, keeping the car's side 25 cm inside. What comes out is the classic line: in from the outside, clipping the apex, out to the outside, with straights cutting across between corners.

**Speed plan.** Along that line, each corner allows a speed from its curvature, the share of the tyres' grip the driver uses, and the help from a bank leaning into the turn (as the physics gives it). Then a pass forwards limits it to what the engine can reach out of the corners before (engine, drag, slopes). A pass backwards limits it to what the brakes can lose before the next corner. Both passes go round twice, across the line.

**Driving** (`race/driver.ts`):
- Steering aims at a point on the line 3 m + 0.2 s ahead (pure pursuit), plus 60 % of the line's own curvature just ahead, so the wheels turn in as a corner begins. It tracks the line to within about 1 m at full speed.
- Throttle and brakes follow the speed plan a quarter-second ahead: flat out below it, firm braking above it.

On the test tracks a 100 % AI laps about 19 % faster than the old centre-line driver (up to 24 % on twisty ones), with no track-limit breaches and no barrier hits. The old driver's lap is now about 1.16× gold, so medals are roughly one step harder than before.

**Difficulty** (`AI.pace`) sets the share of grip used in corners, the top speed and the share of the brakes. 100 % is the tyres' limit: with more grip the car slides off. On the test tracks, including random custom ones with hills, banking and 8–18 m roads, a 100 % AI is within 1 % of the fastest lap the physics allows.

**Same difficulty, same meaning on every track.** Grip only matters in bends, so the same mix of grip, top speed and brakes would make 75 % nearly as fast as 100 % on a flat-out banked oval, and much slower on a twisty track. So each difficulty is tuned per track (`trackDifficulty()`, worked out once per track and cached): the pace is solved so its planned lap is a fixed multiple of the 100 % lap there (`AI.lapRatio`: 1.7× at 0 %, 1.27× at 25 %, 1.14× at 50 %, 1.06× at 75 %). That makes medals mean the same on every track too.

| Difficulty | AI lap vs the gold time, on any track |
|---|---|
| 1 % | about 1.6× |
| 20 % | about 1.28× (bronze) |
| 45 % | about 1.1× (silver) |
| 75 % | 1× (gold: medal times are this AI's flying lap) |
| 100 % | about 0.94× |

The field spreads up to 8 points below the chosen difficulty, so the cars don't drive nose to tail.

**Lanes.** Besides the line itself, the driver has a speed plan for lanes 1.5 to 6 m either side of it (`DRIVER.planLanes`). A lane is the line shifted sideways, but never further than the room there is beside the line: from the line out to the road's edge at its narrowest nearby, 0.6 m in from it, smoothed so every lane bends as gently as the line. It's planned with 5 % of the grip kept in hand, and with the same engine and brake passes, so a lane on the inside of a bend is slower and the planner knows by how much.
- A path's bends are measured on it smoothed over 5 m either side, about as far as the steering looks ahead. So the corner where a lane meets the road's edge costs what rounding it off does, not what taking it square would. Before, a car holding a lane just 0.8 m off the line lost about 14 % a lap to those phantom corners. Now it loses 4–5 %, and 0.3 m off costs nothing.
- Between two planned lanes, the speed is in proportion between them (it used to be the slower of the two).
- A car more than 1 m off its lane (held off it to leave room for a car, going by one, or knocked) takes the lane to be where it is. So it eases back at the usual rate instead of swinging straight across the road.
- A car knocked off its path gets its speed limit from the path it will really drive back onto its lane.

**Traffic** (`race/traffic.ts`). About 30 times a second each AI picks a lane:
- **Looking ahead:** it plays the next few seconds forward in each lane for itself and every car near it (70 m ahead to 25 m behind). Each car follows its speed plan at the pace it's going now, keeping its offset from the line. You (not an AI) are assumed to follow the line as it bends, carry on drifting off it as you are now, and stay on the road. In a car's slipstream it reckons on going up to 8 % quicker than its plan, which is how it sees a pass coming.
- **Cost of a lane:**
  - the time it loses against the line over the next 80 m;
  - a moment held up behind a car before it's clear of it;
  - if it can't get past a slower car in that lane within 5 s, being stuck behind it for a good while (8 s at the speed difference).
  - A lane that would turn it into a car alongside is out.
- **Room:** it wants 1.2 m between the cars' sides to draw alongside, plus more in a bend (30 m per 1/m of curvature: 0.6 m more at a 50 m radius), where tails swing out. Closing on a car in a bend faster than 2 m/s, it wants up to 0.6 m more again.
- **Choosing:** it takes the cheapest lane, but switches only for a clear gain, and once a pass is under way only for a big one, so it doesn't weave. In a tight bend it makes no new moves away from the line (back towards it is fine).
- **Room for a car alongside** (yours too): with a car beside it, its path bends round that car whatever the racing line does. It keeps at least 0.9 m between the sides from another AI and 0.7 m from you (hard but fair), plus the bend extra, or no less than there is now. So it never turns in on a car down its inside. That counts a car beside it, just ahead, or behind with its nose past its rear wheels: 3 m back, plus 0.6 s of the speed it's closing at, so a dive down the inside gets its room. A car further back than that doesn't own the line, so the AI takes it.
- **Side by side with no room for both** (the road narrowing into a bend), racing rules as in the F1 driving guidelines:
  - a car more than half a length behind backs out;
  - overlapped more than that, the car on the inside of the coming bend has earned its place, and the one round the outside backs out;
  - in a let-by (below), the car letting the other through always gives way;
  - neither turns in on the other. Backing out means dropping to 2 m/s below the other car (unless that car has dropped behind or all but stopped, so two cars never wait for each other).
- **Getting past you** (or any car that isn't an AI, so it won't keep to a lane beside the line):
  - **Pass lanes:** it can also pick "go by on its left" or "on its right". That's the racing line wherever it's already clear of you, and elsewhere a car's width plus 0.8 m (plus the bend extra) from wherever you really are, from 10 m back. Once alongside, the room-for-a-car-alongside rule keeps it from cutting back in until it's past.
  - **Push to pass:** stuck 2 s below its pace behind a slower car like that, it gets a full tow's worth of extra pace (see Slipstream) for up to 6 s, then waits 10 s. That's enough to draw alongside on a straight.
  - It still won't turn in on you: if you take the line into a bend while it's beside you, it backs off.
- **Following:** behind a car it would run into before it's clear of it, it keeps a gap of 1.5 m + 0.35 s (just 0.15 s behind you) and closes it gently. If the car ahead suddenly slows (a spin, a knock) it brakes hard. Within 15 m of another AI it drives 1.5 % under its pace.
- **The start:** for the first 500 m each grid slot back drives 0.5 % slower, so the field strings out instead of going three wide into the first bend.
- **Recovering:** sliding (knocked, or ran wide), it eases to a third of the throttle for a moment instead of braking in front of others. If it's stuck for 2.5 s it puts itself back on the road, but only once no car is coming. After the finish it carries on at 85 % pace.

**Racing you, wheel to wheel.** These apply to you, not to other AI cars:
- **Not shy of you:**
  - it sits 0.15 s behind you, in your tow, ready to pounce;
  - you right behind it, in line, are following, not alongside, so it doesn't move aside for you;
  - it doesn't ease off near you.
- **Defending:** with you close behind (within 20 m, and set to be within 5 m by the braking point at the rate you're closing), it covers the inside of the bend coming up.
  - *Which bends:* one the line brakes hard for (to 72 % of the speed at the braking point), or any braking bend once you're already pulling out to go down its inside. That's how it sees a move coming.
  - *When:* one move, made 1 to 4 s before the braking point, never under braking and never from the middle of a bend.
  - *Only where it pays:* only on a straight run to the braking point, only where the line doesn't already cover the inside (more than 1.5 m of room there), and only if it can get across smoothly in time.
  - *The path:* a smooth path of its own, easing from where it is to the inside of the bend (0.4 m short of a lane's edge, so no room for a car) by the braking point, along it to the apex, and back onto the line over 25 m. Into Paperclip's first hairpin (at 90 %) it's about as quick as its own line, as the inside is the short way round there. Into a faster bend the inside is a slower way round, which is why it covers those only once you're pulling out.
  - *Giving up:* if you've already got your nose alongside on that side, it's your line and it leaves you room. It gives up once you've dropped 30 m back or got by.
- **Fighting:** alongside you, or with you just ahead (up to 9 m) and it on the inside of the coming bend, it goes later on the brakes: 20 % more of its brakes (up to all of them), on the path it's really driving. At 60 % that's 2.5–4 m later into a hairpin, still making the corner. At 90 % it's only a metre or two: it's nearly on the limit already.

**Letting a quicker car by (help for overtaking).** Evenly matched cars rarely get past each other on twisty roads. So a slower AI that has had a clearly quicker AI (5+ points of difficulty) within 25 m behind it for about 1.5 s:
- only from 200 m into the race;
- only if no car is within 25 m ahead of it and nobody is letting it by itself, so a train sorts itself out from the front instead of everyone easing off at once;

then it:
- steps 3.5 m off the line to the side with more room over the next 40 m (or the other side of the line from the quicker car, if that's already well to one side);
- drives at 85 % of its pace, and once the quicker car has pulled out beside it, at half throttle too (but not in the middle of a tight bend, where a car slowing is a hazard);
- carries on until the quicker car is a car length ahead, drops well back, or 8 s have gone.

The quicker car is told which side the slower one has taken and passes on the other, usually on the racing line. This works only between AI cars: they don't move over for you, and you don't have to move over for them.

**Slipstream** (`car/slipstream.ts`). It's the same for every car, yours included, and it's what lets you get a run on an AI along a straight.
- **Stronger the closer you get:** its strength depends on the time gap to the car ahead (bumper to bumper), as in Speed Dreams' physics: exp(−gap / speed / 0.35 s). Right on the bumper it's full, half a second back it's a quarter, and it reaches out 60 m. The wake is 1.6 m to either side right behind the car, widening 7 cm per metre back.
- **What it does:** up to 75 % less drag, and the engine keeps pulling up to 12 % past its usual top end, plus a tow of up to 1.2 m/s². So in a tow you go faster than you could alone ("overspeed"): top speed about 167 km/h alone, about 200 km/h 5 m behind a car, about 182 km/h 15 m back. 5 m behind a car at 30 m/s it pulls about 1.4 m/s² harder.
- **Slingshot:** pulling out of the wake, you keep the tow for a moment, fading over 0.4 s, so you can draw alongside.
- Both cars must be going the same way at the same level. AI cars use it too: in a tow an AI may go past its own top speed.
- **HUD:** "SLIPSTREAM" shows above the speedometer while you're in one, and its bar fills with how strong the tow is.

On test races (`npm test`, `tests/traffic.test.ts`):
- a 90 % AI starting behind a 40 % one gets past within a lap (about 12–27 s on the samples);
- a 95 / 75 / 55 / 35 % field starting in reverse order finishes with the quickest ahead of the slowest, and in roughly pace order on average;
- an evenly matched field of eight races 3 laps with at most one hard knock and nobody off the road;
- going down the inside of Sunday Loop's turn 1 overlapped with a 100 % AI (from 2 m behind to 2 m ahead), it leaves room and never touches you;
- an 80 % AI gets past a 20 % "player" on the racing line who looks out for no one, within the first lap, and stays ahead.

And in `tests/duel.test.ts`:
- with you 1.5 m behind into Paperclip's first hairpin, a 90 % AI covers the inside by the braking point, without touching you and losing at most half a second; with you 30 m back it keeps its line;
- fighting for a place, it brakes later and still makes the corner;
- a lane 0.3 m off the line costs under 1 % a lap and one 0.8 m off under 6 %.

How it was tuned: a scratch harness (not in the repo) ran 30 races on six tracks per setting. The races were matched fields, reversed and mixed grids, and a stand-in "player" on pole that drives the centre line and avoids nobody.
- **The version before this one** (against the one before it): hard knocks (over 4 m/s) went from 49 to 18 and firm ones (over 2 m/s) from 127 to 57. Time off the road went from 30 to 0.7 car-seconds, and sliding from 153 to 57.
- **This version:** firm contacts went from 57 to 36, contacts with the stand-in player to none, and hard knocks between AI cars from 11 to 7. Order agreement with pace in mixed grids is lower (0.40 vs 0.50).
- **Passing a slow player:** in a separate test with slow players on the racing line, AIs got past them 17 times out of 60 (was 15). A player about 27 % slower is usually passed on tracks with straights. One about 10 % slower usually isn't, and on very twisty tracks hardly anyone gets by.

- **Racing you (this version):** a scratch harness ran 168 two-car races on the samples. The AI was quicker and behind three kinds of stand-in for you:
  - a "player" on the racing line who looks out for no one;
  - a clean racer that leaves room;
  - a clean racer that races the AI as it would you, defending and all ("mutual").

  The AI was also ahead of a quicker clean racer.
  - *Against the player who looks out for no one:* firm knocks went from 13 to 10, hard ones from 5 to 3, and the AI's time off the road from 46 to 0.9 s. It got past 12 times in 24 (was 10).
  - *Against the clean racer:* it got past 19 times in 24, in 13 s on average (was 18, in 14 s).
  - *Against the mutual racer:* it got past 8 times in 24 (14 before, when the leader still moved aside for a car right behind it).
  - *Defending:* a quicker clean racer behind it got by 6 times in 18 (was 9).

Tried and dropped, as they made racing worse:
- an "impatient" mode that squeezes by with less room;
- late braking whenever close to another car;
- a bonus for going down the inside;
- less room around you before it would draw alongside (fewer passes: it got squeezed and backed out);
- a committed attack down your inside into a braking zone. It was held to the apex, and it backed out if you shut the door: fewer passes, since a move that didn't come off cost it the corner.

**Contact** (`car/contact.ts`). Each car's body is a box the size of the car, turned with it.
- **Overlap:** it's found with a separating-axis test on the four box sides, and the cars are pushed apart along the axis of least overlap, half each.
- **Impulse:** the hit is resolved at the actual contact point, the middle of the overlap. A small bounce cancels the closing speed, and friction along the contact makes a side-swipe drag. Because it acts at the point of contact, a hit on a nose or tail turns the car, while a square hit pushes it straight.
- **Packs:** contacts are resolved three times per tick, so in a pack a car pushed out of one car and into another is pushed out of that one too.
- **Bridges:** cars more than 2.5 m apart in height (on and under a bridge) never touch.
- A bump on you knocks like a barrier hit.

**Positions.** The HUD shows your position (POS 2/6) beside the timer. It comes from each car's race distance: laps, checkpoints passed and the way since the last one. Reversing never adds to it. Name tags float over the AI cars, and they show on the minimap in their colours. The race ends when you finish, with "Finished 2nd!". The results show your place and the finishing order, with each car's time from GO, as gaps behind the winner. A car still racing gets an estimated time from its average speed so far.

Lap times against AI cars count for bests, the ghost, medals and the score as usual.

### Races

**Track limits.** Kerbs count as track; the grass, gravel or tarmac beyond them doesn't. If the whole car goes past the edge (both wheel tracks, with 25 cm of grace) for more than 0.12 s, the lap you're on is invalid. "Track limits!" flashes, and the timer turns red and struck through until the next lap. An invalid lap still counts towards a race's distance, but never for the best lap, the ghost, medals or the score. The results screen marks those laps ✗. A run with no clean lap scores nothing. Practice uses the same rule.

3-2-1-GO, then the setup's number of laps (1–50). The timer starts when you cross the line. Ten checkpoints sit around the lap, to be passed in order, driving along the track (anywhere up to 25 m beyond the road's edge counts). A jump of more than 3 m along the track in one physics tick (cutting across the grass to another stretch, or a reset) never passes a checkpoint. A lap that misses one still counts towards the race (and towards finishing), but like a track-limits lap its time doesn't: it's marked invalid, and can't be a best, a ghost or a medal. Lap times are interpolated within the 120 Hz tick. Each checkpoint shows a split against your best lap, and driving backwards shows "Wrong way!".

Your best lap is recorded tick by tick and replayed as a translucent ghost. The results screen shows the total time, each lap, the best lap and a score: average speed on your best clean lap × 10. Old multiplier-based high scores reset; lap times and ghosts are preserved.

**Medals.** The first time a track is raced, a 75 % AI drives a flying lap of it in the background (in slices, during the countdown). Its lap is the gold time; silver is +10% and bronze +25%. Medal times are measured again whenever the AI changes (`AUTHOR_VERSION`). The targets show under the lap timer and light up as you beat them. The results screen shows the medal for the run and the next one to aim for, and My tracks shows each track's medal. Author times are saved with the track's records.

A **minimap** in the top-right corner shows the track (bridges drawn on top), you, the ghost and the AI cars.

### Car setup

🔧 Setup in the race setup (G) opens the car setup (`ui/setupPanel.ts`, `SETUP` in `config/race.ts`). It's remembered between races. The middle of each choice is the car as it always was.

| | Low / Short / Front | Medium / Balanced | High / Long / Rear |
|---|---|---|---|
| **Wing** | 82 % drag, 5 % less grip at 40 m/s: quicker on the straights | standard | 118 % drag, 5 % more grip at 40 m/s: quicker through fast bends |
| **Gears** | 5 % more pull, tops out 3 % lower | standard | 5 % less pull, tops out 3 % higher |
| **Brake balance** | front: 97 % bite, steadier under braking | standard | rear: 102 % bite, turns in more readily under braking, but the tail can step out |

- Downforce grows with the square of the speed, so the wing matters most in fast bends. The AI's speed plan includes it: `cornerSpeed()` in `race/racingLine.ts` solves for the speed a bend allows with downforce.
- The panel shows what each wing is worth on this track: the flat-out planned lap with low and high wing against medium (`wingLapTimes()` in `race/strategy.ts`). It also suggests the quickest. The balance is set so each wing is the quickest on about a third of the built-in tracks, by a few tenths a lap: Monza and Las Vegas are low-wing tracks, Budapest a high-wing one.
- **AI teams** run the suggested setup for each track (and qualify on it). Each AI car's top speed is scaled with its wing's, so the field keeps its spread of straight-line speed. Without that, a draggy high wing caps every car at the same top speed and the quick cars can't pass. Medal times stay on the standard setup.

### Timing tower

In a race with AI cars a timing tower runs down the left of the screen (`ui/timingTower.ts`, gaps from `race/timing.ts`):
- Each car's position, colour and name, and its gap to you: "−1.8" if it's ahead, "+0.6" behind, "+1 LAP" when a lap or more apart.
- Gaps are worked out the way race timing does it: how long ago the car ahead passed the point where the car behind is now. Every car's time is recorded at each 10 m of race distance.
- With tyre wear: the kind of tyres each car is on, how many laps old they are (red once they've gone off), its stops so far, and PIT while it's in the pits.
- Under it, with tyre wear: where you'd rejoin if you stopped now, e.g. "Pit now: rejoin P5, behind Ada". The cars behind you by less than a stop costs (the 3 s service plus about 3.5 s braking in and getting going) would get by.
- T (rebindable) switches it full → compact (the leaders and the cars around you) → hidden. Tapping it switches full and compact, and the choice is remembered.

### Conditions: rain, night, tyre wear and pit stops

The race setup's **Conditions** row (🌦, key C) opens a panel with three switches. They apply to every car on the track, the AI cars too, and are remembered for the next race. Each one is on or off on its own.

- **Weather: Dry / Rain.** In the rain the tyres have 80 % of their grip and the brakes 78 % of their bite (`CONDITIONS.rainGrip`, `rainBrake`). That's the most the car can corner and brake: it still answers the wheel as quickly as in the dry. The AI drives the same share of what grip there is, so its laps come out about 7–9 % slower (a test checks a few %, and that its lap stays clean). So do the racing line and the braking assist, which start braking earlier. Qualifying is in the rain too, but medal times are always the dry ones. It looks wet: a low grey sky, mist that hides the distance, a darker road and falling rain, a few thousand streaks that slant towards you at speed (`render/rain.ts`, one draw call). It sounds wet too: a hiss that grows with speed, and tyres that hardly squeal.
- **Weather: Changing** (`race/weather.ts`, `WEATHER` in `config/race.ts`). The race starts dry. Rain comes somewhere between 20 % and 50 % of the way through, and in about two races out of three it stops again between 55 % and 80 %. In practice it changes every 2½–5 minutes.
  - *The road* gets wet as it rains (over about 40 s) and dries out after. The racing line dries first, in about 75 s, because the cars clear it; the rest takes about 4 minutes. So for a while there's a dry line on a damp track, and running off it means more water.
  - *Grip and brakes* blend between dry and wet by how wet the road is under each car, and so does tyre life. Slicks and wets cross over at about half wet, so the call is when to change.
  - *The HUD* shows the weather under the minimap: "🌧 Rain · track 41% wet", how wet the line is once it's drying, and a forecast 90 s ahead ("Rain in ~30 s"). It also flashes when the rain starts and stops. The sky, mist, rain, road and sound all blend with it.
  - *The AI* drives a dry plan and scales it by the grip and the brakes there are, so it brakes earlier as the road gets wet. With tyre wear on it pits for wets once the road is wet enough and back to slicks once it has dried enough. Each car makes its own call, by grid slot: some go early, some late, with a gap so none flip-flops. A test checks one car makes both changes in a 7-lap race.
  - Without tyre wear nobody can change tyres: every car is on standard tyres that blend between dry and wet.
  - Tyre wear is counted as the share of their life used (`tyreUse`), so a set's life can change with the weather without its wear jumping.
- **Time of day: Track / Day / Sunset / Night.** "Track" keeps the track's own time of day. The others override it for this race only (the track itself doesn't change). The race setup's background shows the choice.
- **Tyre wear & pit stops: Off / On**, with the **starting tyres** (shown when tyre wear is on).
  - *Kinds of tyre* (`TYRES.compounds` in `config/race.ts`, `car/tyres.ts`):

    | | Grip (dry) | Grip (rain) | Lasts (× medium) |
    |---|---|---|---|
    | **Soft** (S, red) | 105 % | 84 % | 0.65 |
    | **Medium** (M, yellow) | 100 % | 80 % | 1 |
    | **Hard** (H, white) | 95 % | 76 % | 1.6 |
    | **Wet** (W, blue) | 86 % | 95 %, and better brakes | 0.4 in the dry, 1.3 in the rain |

    Switching the weather to rain puts wets on, and back to dry puts mediums on.
  - *How long they last depends on the track* (`race/strategy.ts`). Mediums last 6 laps on the easiest track and 4 on the hardest, by how hard a lap works the tyres. That's the speed turned through in the bends plus the speed shed under braking, on the racing line flat out. Monza gets 6 laps, Sakhir (Bahrain) about 4.7, Shanghai 4.3. The Conditions panel shows each kind's life on the track you're racing.
  - *Wear* is counted in laps driven; sliding counts extra. Over their life the tyres fade by 7 %. Then they go off: over the next quarter of their life their grip falls to 60 %, and stays there. A lap on tyres that have gone off is 12–21 % slower: heavily slower, not blown up.
  - *The HUD* shows the kind (S / M / H / W in its colour) with a bar and the share of their life left. It turns yellow in the last 20 % ("Tyres going off soon: pit in the next lap or two") and red once they've gone off ("Tyres have gone off! Pit now").
  - *The pit box* is a yellow PIT box painted at the edge of the start straight, in front of a garage when the track has pits, and always clear of the start line and the grid. Stop in it and the crew holds the car for 3 s while it fits a new set. While it works, choose the kind with 1–4 or a tap; each button shows how many laps that kind lasts here. If you don't choose, you get the same kind again. A stop costs about 6 s in all, braking in and getting going again. The box is on the track itself, so the cars coming past go round you.
  - *The AI* is quicker on softer tyres and in wets in the rain: through the bends, not into them, as the brakes are no better. As its tyres fade it slows wherever a bend, or braking for one, sets its speed, by the square root of the grip left. On tyres that have gone off it takes extra care, as they slide. It stays within the track limits even then (a test checks that).
  - *AI strategy:* it starts on the quickest kind that lasts the race. If none does, it starts on its own choice (medium, hard or soft by grid slot, so the field is mixed). In the rain it's wets. It stops when its tyres would go off before the box comes round again, give or take a bit per car, so they don't all stop on the same lap. It doesn't stop with less than a lap to go, or when its tyres will last to the finish. At a stop it picks the same way for the laps left. It pulls over to the box from 180 m out, brakes to stop in it, and rejoins the line over 90 m.
  - *Qualifying* is always on new tyres, without wear.

### Damage, flags and the safety car

Two more switches in Conditions (both off by default, saved with the rest). Race control is `race/raceControl.ts`; the numbers are `DAMAGE` and `FLAGS` in `config/race.ts`.

- **Damage: Off / On** (`CarPhysics.addDamage`).
  - A hit on a barrier or another car faster than 5 m/s does damage: 3.5 % for each m/s over that.
  - 60 % goes to the front wing and 40 % to the bodywork.
  - A broken wing costs up to 15 % grip. Broken bodywork adds up to 35 % aero drag, which lowers the top speed by about 5 %.
  - The HUD shows *Damage n %* in yellow, then red. It warns at 15 % ("pit to have it mended") and again at 50 % ("Heavy damage!").
  - The pit box mends it all, taking 8 s more per 100 % of damage on top of the usual stop. A stop for repairs alone fits no tyres when tyre wear is off.
  - The AI pits for repairs once it's 45 % damaged, unless it's in the last lap.
- **Yellow flags (always on in a race).**
  - A car that has crashed (a hit over 14 m/s) or stopped on the track for 1.2 s brings yellow flags out around it.
  - The flags cover 160 m before the car and 30 m after it, and stay out 6 s after the car moves on.
  - The HUD shows *YELLOW FLAG* when you're in the zone or within 250 m of it.
  - The AI eases to 85 % of its pace in the zone.
- **Safety car: Off / On.**
  - A car stuck on the track for 2 s brings out the safety car, except in the last lap.
  - A white safety car leads the field round on the racing line. The leader is held to 24 m/s.
  - The cars behind may close up to 16 m behind the car ahead: faster when further back (up to +14 m/s), slower when closer.
  - Your throttle is cut above that speed and the brakes help a little.
  - After 25 s it comes in at the end of the leader's lap ("SAFETY CAR IN THIS LAP"), and it's green when the leader starts the next one.
  - Tests check a stuck car brings it out and the AI field bunches up behind it and races on afterwards (`tests/raceControl.test.ts`).

### Saving, sharing and sound

- **Storage** (`platform/storage.ts`) is a small synchronous get/set store:
  - web build: localStorage;
  - CrazyGames build: the SDK `data` module, with every write mirrored to localStorage. An SDK read is used only if it returns a string, so the game also works when the SDK is missing or blocked.

  If storage itself is blocked (private mode, sandboxed iframe), values live in memory for the session.

  What's saved: the tracks you save, best lap and splits, best score and the best-lap ghost per track (40 most recent tracks), and settings (sound, camera, editor mode, smoothing, snap, display settings, the open sidebar section). Ghosts are stored at 30 samples/s as int16 (5 cm), about 11 KB per 45 s lap.
- **Track codes** (`track/code.ts`): `IC1.` + base64url of the dots, delta-encoded as zig-zag varints in 0.5 m steps, plus their heights, the options as a varint (banking, barriers, scenery, kerbs, run-off, barrier style, pits, time of day, laps, trees, and from v5 the road surface and barrier distance), the road width, per-corner bank overrides when there are any, a list of tagged extra blocks (v5; blocks a version doesn't know are skipped), the name and a checksum. That's about 100–300 characters. Older codes (v1 without heights, v2 with three options, v3 with preset widths, v4 without the newer options) still load with defaults for everything newer. Pasting a damaged code gives a clear error.
  - The web build also puts the current track's code in the URL hash (`#track=…`), so the address bar is a share link, and has a "Copy link" button.
  - The CrazyGames build never touches the URL or shows links.
- **My tracks** (Pause → My tracks, Results, editor Options):
  - only tracks you save are kept: Save in the editor (it shows ✓ once the track as it is now is saved), Save track on the results screen, or Save next to a pasted code. Racing a track never saves it. (Older versions saved every raced track; that list is cleared once on the first start of this version.)
  - Delete all (tap twice);
  - thumbnails, length, best lap and score;
  - Race / Edit / Share / Delete (tap Delete twice to confirm);
  - a box to paste a friend's code.
- **Sound:**
  - one AudioContext, created on the first tap/click/key and resumed on every later touchend/click while it is suspended (iOS);
  - engine: two oscillators and a filter, pitch through five gears;
  - tyre squeal: band-passed noise when sliding on tarmac;
  - grass rumble, rain (band-passed noise, louder with speed), plus countdown, lap and pit beeps;
  - M toggles sound (also in the pause menu).
- **Web build only:** on a phone held upright, a "turn your phone sideways" screen covers the game and pauses the race.

### Cloud saves (Supabase)

Progress is also kept in Supabase so it survives a cleared browser and follows the player (`src/platform/cloud.ts`, `supabase/`):
- **CrazyGames:** by the player's CrazyGames account (logged-in players). The `cg-save` function checks their CrazyGames token.
- **Web:** an anonymous sign-in per browser.

A newer cloud save is taken at start-up, before the game reads anything (waiting at most 4 s), and changes go up 5 s later and when the page is hidden. Without a project set up or a network, nothing changes for the player. Set-up steps: [`supabase/README.md`](supabase/README.md).

### CrazyGames SDK (v3)

The code follows https://docs.crazygames.com/sdk/intro/. It lives in `src/platform/crazygames.ts` (SDK wrapper) and `src/platform/services.ts` (what the game calls). Every call is a no-op if the SDK is blocked, fails to start, or reports the environment as `disabled`, so the game still runs.

- **Script and init:** the CrazyGames build puts `crazygames-sdk-v3.js` in `<head>`. Boot awaits `SDK.init()` (giving up after 5 s), then calls `loadingStart`, sets up the game, and calls `loadingStop` on the first rendered frame. That frame is already the race, with no clicks.
- **Data:** saved data goes through the SDK `data` module only, as the docs ask. localStorage is used only if the SDK isn't available or reports `dataModuleDisabled`.
- **Gameplay events:**
  - `gameplayStart` when GO appears and when you resume;
  - `gameplayStop` on pause, finish/results, editor and My tracks.
  - Only real changes are reported.
  - Nothing is sent while the tab is hidden, since the docs say CrazyGames handles focus changes itself. When you come back to the pause menu, the stop is sent then.
- `happytime()` fires once per run that sets a new best lap or high score.
- **Ads** (only with `npm run build:cg:ads`, for Full Launch; during Basic Launch the SDK disables ads anyway):
  - **Midgame:** requested when you press *Race again* on the results screen, a natural break between races, never during driving or drawing. The SDK paces midgame ads (at most one per 3 minutes), so the game adds no timer of its own, as the docs recommend.
  - **Rewarded:** *Watch an ad to unlock {paint} now* on the results screen. Paints also unlock by finishing runs, so there's always a way without ads.
  - **While an ad runs:** the UI is blocked from request until `adFinished`/`adError`; audio is muted only once `adStarted` fires. `adError` never rewards. An `adsDisabled` error turns ads off for the session.
  - **Ad blockers:** with one detected, the reward button is disabled with a notice, and everything else works normally.
- **Account:** a logged-in player's CrazyGames username labels their ghost car. There's no other login.
- **Platform mute:** `game.settings.muteAudio`, and its change listener, override the in-game sound toggle.
- **Device type:** `user.systemInfo.device.type` decides touch controls: mobile/tablet get them, desktop doesn't.
- **Common fixes from the docs:** no wheel scrolling, no context menu, and Space/arrow keys never scroll the host page.

Tested against the real SDK in its `local` mode (localhost): the SDK's own log showed loading start/stop, gameplay start/stop, happytime, rewarded and midgame ads, a username, and data reads in the expected order.

**Submitting:** `npm run package:cg` (Basic Launch) or `npm run package:cg:ads` (Full Launch) builds, checks the CrazyGames limits and writes `dist/track-builder-3d-crazygames-basic.zip` / `-full.zip`, with `index.html` at the root and the third-party notices beside it. Upload that in the CrazyGames Developer Portal, and choose "Yes, using the Data Module" for Progress Save. The store listing, covers and checklist are in [`crazygames/`](crazygames/).

## Status

- [x] Phase 1: track drawing (2D editor)
- [x] Phase 2: 3D track
- [x] Phase 3: car and driving
- [x] Phase 4: race / time trial (plus a bigger editor upgrade: dots mode, crossings, tighter corners)
- [x] Phase 5: track library, sharing, audio
- [x] Phase 6: CrazyGames SDK
- [x] Elevation, banking, barriers, bridges, scenery themes; editor zoom/pan, lazy pen, section redraw, soft editing and Height mode; minimap and medals
- [x] Editor sidebar (7 sections), stats strip, numbered corners, road width, kerb / run-off / barrier styles, pits, sunset, laps, tree density, display settings, 3D view
- [x] Race setup menu (practice / race, laps 1–10, ghost on / off, 1–12 cars, grid: qualifying / random / pick your slot), AI cars with difficulty 1–100 %, car-to-car contact, positions; double-tap R restarts a practice lap
- [x] AI racing line and speed plan; box-shaped car contact; racing in traffic (lane planner, passing, letting quicker cars by) and slipstream
- [x] Built-in tracks: 20 more of the game's own and 30 real circuits, kept apart from yours in the menu and library
- [x] Track editor rework (starters, Surprise me, point controls, draft recovery, no ink budget), in the game's own look, with Fix it, a gold-lap preview car and confetti
- [x] Six-speed gearbox (manual or automatic, the automatic a little slower) and driving assists: racing line (braking / full), and braking and steering assists that help a little without driving for you
- [x] Rebindable keyboard controls (two keys per action)
- [x] Race conditions, each switchable: rain, time of day (track / day / sunset / night, with car lights), tyre wear with working pit stops for you and the AI
- [x] Live timing tower (gaps, tyres, stops, where you'd rejoin after a stop)
- [x] Car setup: wing, gears, brake balance; the AI teams pick the quickest wing for each track
- [x] Changing weather: rain that comes and goes, a road that dries on the racing line first, and wet/slick calls for you and the AI
- [x] Kinds of tyre (soft / medium / hard / wet) with a life that depends on the track (4–6 laps for mediums) and a heavy drop-off once they go; choose them at the start and at each stop; races up to 50 laps
- [x] Editor: pick any track to edit, six track generators, trace an image, track length / terrain climb / corner smoothing sliders, banking for every corner at once
- [x] Editor: TecPro and Armco barriers, barrier distance, painted kerbs, dirt and snow roads, Alpine / Forest / City landscapes (track codes v5)
- [x] Editor: tap-to-place scenery, run-off per corner and painted with a brush, bump kerbs (per corner and on every chicane)
- [x] Editor: bridges or tunnels where the track crosses itself, and lifting every level crossing
- [x] Damage (wing and bodywork, mended in the pit box), yellow flags and the safety car

## Validation for the track editor

`npm test` includes starter/remix validity, every generator style (valid, no crossings, on the paper, reproducible), draft recovery and corruption handling, the former length-limit regression, score migration, Fix it on each kind of problem, the preview car's lap against the gold medal time, and DOM interaction tests for keyboard editing, undo/redo, Fix it, generating, picking and pasting tracks, the shape sliders, banking every corner, placing scenery, corner run-off, bump kerbs and narrow layouts. `npm run build` typechecks and packages both web and CrazyGames variants. `.github/workflows/checks.yml` runs these checks on pull requests, then exercises the editor in Chromium and uploads desktop and mobile screenshots (`npm run test:browser`; set `PW_CHROMIUM` to use a Chromium that's already installed).
