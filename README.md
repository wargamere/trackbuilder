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
npm run build:cg     # -> dist/crazygames, prints the build size (ads off: Basic Launch)
npm run build:cg:ads # same with video ads enabled (Full Launch)
```

Each build is `index.html` at the root plus one JS file. All paths are relative (`base: './'`). `scripts/size.mjs` fails the build if any asset path is absolute or the total is over 20 MB.

## Web deploy (GitHub Pages)

`.github/workflows/pages.yml` runs the tests, builds the web version and publishes `dist/web` to Pages. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**. With "Deploy from a branch", Pages serves the raw source `index.html`, which can't run without Vite, so you get a blank page.

## Layout

```
src/
  config/     strings.ts (all UI text), track.ts (track + ink tuning), themes.ts,
              handling.ts (all car, input and camera tuning), race.ts (race rules)
  core/       math, screen/state types, 2D canvas surface, fixedStep.ts
  editor/     drawing.ts (editor screen + input), smoothing.ts, validation.ts,
              pipeline.ts (stroke -> track), render2d.ts, viewport.ts (zoom/pan),
              pen.ts (lazy pen), splice.ts (redraw a section), heights.ts
              (soft editing, hills), profile.ts (height profile graph),
              transform.ts (resize / rotate / mirror), preview.ts (3D view)
  track/      spline.ts (centripetal Catmull-Rom -> evenly spaced centre line),
              corners.ts, ink.ts, track.ts (TrackDef/Track), samples.ts,
              mesh.ts (road ribbon, kerbs, barriers, bridge decks), surface.ts
              (terrain, decks, barrier and pillar placement), pits.ts (pit
              layout), stats.ts (stats strip numbers), ground.ts (ground
              under a car), scenery.ts (trees, cones, gantry), code.ts (track
              codes), library.ts (saved tracks)
  render/     view3d.ts (renderer, sky, ground, hills, lights), textures.ts
              (procedural canvas textures), geom.ts (merge/tint helpers)
  car/        physics.ts (fixed-step arcade physics), contact.ts (car-to-car
              bumps), input.ts (keyboard, gamepad, touch), model.ts (low-poly car),
              camera.ts (chase + bonnet)
  race/       raceScreen.ts (fixed-step loop, interpolation, pause), session.ts
              (countdown, checkpoints, lap timing, splits, race distance), ghost.ts,
              records.ts, resultsScreen.ts, bot.ts (driver), ai.ts (AI opponents),
              medals.ts (medal times)
  ui/         dom helpers, menuScreen.ts (main menu), raceSetupScreen.ts (race
              setup), editor overlay, HUD, minimap, pause menu, touch controls,
              libraryScreen.ts (My tracks), shareDialog.ts, style.css
  audio/      audio.ts (synthesised engine, tyre squeal, grass rumble, beeps)
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

**Sunset** recolours the sky, fog and light and drops the sun low in the west.

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
| Camera (chase / bonnet) | C | Y | — |
| Pause | Esc / P | Start | Ⅱ button |

### Track editor

A track is a closed loop of **dots** with a smooth spline through them (`TrackDef.control`), plus its options, and that is the only thing stored.

**Layout.**
- **Sidebar:** seven numbered sections, each with a one-line summary, plus the Race button. On screens 1100 px or wider it is docked; on narrower ones it folds into a rail of numbers that opens over the map.
- **Top bar:** undo, redo, clear, 3D view, the message line, the ink meter and the multiplier.
- **Stats strip** along the bottom: length, corners, longest straight, max gradient, elevation change and tightest radius.
- **On the map:** numbered corners with their bank angle, the pit building, and the run-off colour.

| Section | What's in it |
|---|---|
| 1 Draw | Freehand / Dots / Height tool, hill tools in Height mode, freehand smoothing, snap to grid, soft editing, sample tracks |
| 2 Size & shape | Road width slider (8–20 m, with 10 / 12 / 15 m shortcuts), smaller / bigger / rotate / mirror the whole track, terrain (flat / rolling / hilly random hills, smooth) |
| 3 Corners | Banking level for the whole track (off / normal / steep), and a bank slider (0–30°) for every numbered corner, with Auto to go back to the level; tap a corner's number to zoom to it |
| 4 Start & pits | Laps per race (1 / 3 / 5), pit building on/off, move the start/finish line 10 m back or on, reverse direction |
| 5 Track edges | Kerbs (raised / flat / none), run-off (grass / gravel / tarmac), barriers (none / concrete / tyres) |
| 6 Scenery & world | Meadow / Desert / Snow, day / sunset, few / normal / lots of trees |
| 7 Display | Graphics full / fast, km/h or mph, minimap in the race, corner numbers on the map (player settings, not part of the track) |

The **3D view** (V, or the ◈ button) shows the track being edited from an orbiting camera. Drag to look around and scroll or pinch to zoom. Esc goes back to the editor with the edit untouched, and Enter races it.

- **Draw mode:**
  - draw one stroke; if you stop short of the start, the loop closes itself;
  - the pen is "lazy": the ink trails the pointer on a short string, so hand wobble never reaches the paper. The string is longer with more smoothing, and a little longer for fingers;
  - **redraw part of a track:** start a line on the road and end it on the road. The stretch between is replaced (shown in red while drawing), and the other dots don't move. Drawing against the direction of travel replaces the stretch behind;
  - Smoothing (sidebar, section 1) sets how much wobble is removed and how tight a drawn corner may stay: Sharp 6 m, Normal 10 m, Smooth 22 m.
- **Dots mode:** click to place dots, then click the first dot (or press Enter) to close the loop. Click the road to insert a dot.
- **Height mode:**
  - drag dots up and down on the map, or by their handles in the height profile along the bottom (amber where the road is as steep as allowed; crossings marked grey for level, blue for bridges);
  - click the road to add a dot at the road's height there;
  - Random hills (H) makes rolling hills that keep every crossing level or a proper bridge; there are also Smooth and Flatten;
  - the road is coloured by height.
- **All modes:**
  - drag any dot to reshape the track. **Soft editing** (on by default) moves the neighbouring dots part of the way too, so curves and hills stay smooth; hold Shift to move just one dot;
  - right-click or double-tap a dot to delete it;
  - drag the start flag, or the start/finish line itself, anywhere along the road to move it (a dot is added there if needed);
  - **zoom and pan:** mouse wheel or pinch to zoom (up to 8×), drag with two fingers, the middle button or Space held to move around, and buttons for +, − and fit (+ / − / F);
  - Undo (Z) and Redo (Y / Shift+Z), Clear (C), switch mode (M), Reverse direction (R);
  - O opens or closes the sidebar section; the track name is at the top of the sidebar.
- **Validation runs live** and marks the problem spot:
  - too short or too long (out of ink);
  - corner tighter than 4.5 m;
  - two stretches too close together (unless one passes 6 m over the other);
  - where the road crosses itself, the two roads must be level (within 1 m), or one at least 6 m higher for a bridge;
  - a level crossing must not be too shallow or on the start line.

  Slopes never block a track: anything steeper than 45% is eased out when the road is built (the top of the climb comes down a little and the bottom up, as little as possible), and the editor says so.

  Level crossings work because the ground-level road is drawn without writing depth, so a flat crossroads doesn't flicker, and the car tracker searches near its last position, so it stays on its own stretch.

Freehand pipeline: raw stroke → lazy pen → merge points closer than 2 m → trim any overshoot, or close the gap → resample every 6 m → Taubin de-jitter → open up corners tighter than the smoothing level's radius → Douglas-Peucker to editable dots (1.6 m tolerance, at most 70 m apart) → round to 0.5 m.

### Menu, race setup and practice

The game boots to the **main menu**, with the current track turning slowly in 3D behind it. From there:
- pick a track with ‹ › (or ← →): the samples, then your saved tracks;
- **Race this track** (Enter) opens the race setup (below);
- **Draw a track** (E), **My tracks** (L), and sound / graphics / units toggles.

**Race setup** (`ui/raceSetupScreen.ts`) opens wherever you choose to race a track: the main menu, the editor's Race it (Enter), the 3D view, My tracks, the results screen's Race settings (S), the pause menu, and practice's "Start a race". Back (Esc) returns to where you came from (to the editor with your edit kept). It sets:
- **Mode:** Practice or Race (P / R).
- **Laps:** 1–10 (race only). Each track starts at its own "Laps per race" from the editor.
- **Ghost car (your record):** on or off.
- **AI cars:** 0–7, and **AI difficulty** 1–100 % (race only).

Start (Enter) drives it. The mode, ghost, AI count and difficulty are remembered between visits. "Race again" on the results screen reruns the same setup.

**Practice** starts at once, no countdown and no AI cars, as many laps as you like. Lap times, splits, the ghost and personal bests work as in a race, but there's no lap limit and no results screen. Press **R twice quickly** (within 0.5 s, or gamepad Back twice) to restart the lap from the grid; a single R just puts the car back on the road.

The pause menu has Restart (Back to the grid in practice), Race settings and Main menu; the editor's ✕ (and Esc) and My tracks' Back return to the menu. The editor's Practice button still drives straight away, to try a track out.

### AI cars

Up to seven AI cars (`race/ai.ts`) line up on a staggered grid, two by two, 6.5 m apart, fastest at the front and you at the back. Each has its own car (the same physics as yours), its own lap counter and a driver built on the bot's line. It brakes for the corners it can see coming, using a share of the tyres' grip and a top speed set by its difficulty (`AI.pace`). The field spreads up to 8 points below the chosen difficulty, so the cars don't drive nose to tail.

| Difficulty | AI lap vs the medal (gold) time |
|---|---|
| 1 % | about 1.6× |
| 25 % | about 1.25× (bronze) |
| 50 % | about 1.08× |
| 75 % | about 1.0× (gold) |
| 100 % | about 0.96× (faster than gold) |

The AI moves over to pass a slower car in its line (to the side with more room), lifts rather than ram one it can't get past yet, and puts itself back on the road if it's stuck for 2.5 s. After the finish it cruises a cool-down lap.

**Contact.** Cars bump: each is two circles along its length (`car/contact.ts`). Overlapping cars are pushed apart half each, their closing speed is cancelled with a small bounce, and an off-centre hit turns them a little. A bump on you knocks like a barrier hit.

**Positions.** The HUD shows your position (POS 2/6) beside the timer. It comes from each car's race distance: laps, checkpoints passed and the way since the last one. Reversing or cutting across never adds to it. Name tags float over the AI cars, and they show on the minimap in their colours. The race ends when you finish, with "Finished 2nd!". The results show your place and the finishing order, with each car's time from GO, as gaps behind the winner. A car still racing gets an estimated time from its average speed so far.

Lap times against AI cars count for bests, the ghost, medals and the score as usual.

### Races

**Track limits.** Kerbs count as track; the grass, gravel or tarmac beyond them doesn't. If the whole car goes past the edge (both wheel tracks, with 25 cm of grace) for more than 0.12 s, the lap you're on is invalid. "Track limits!" flashes, and the timer turns red and struck through until the next lap. An invalid lap still counts towards a race's distance, but never for the best lap, the ghost, medals or the score. The results screen marks those laps ✗. A run with no clean lap scores nothing. Practice uses the same rule.

3-2-1-GO, then the setup's number of laps (1–10). The timer starts when you cross the line. Ten checkpoints sit around the lap, and a lap counts only if you pass them in order, driving along the track. A jump of more than 3 m along the track in one physics tick (cutting across the grass to another stretch, or a reset) never passes a checkpoint. Lap times are interpolated within the 120 Hz tick. Each checkpoint shows a split against your best lap, and driving backwards shows "Wrong way!".

Your best lap is recorded tick by tick and replayed as a translucent ghost. The results screen shows the total time, each lap, the best lap and a score: average speed on your best lap × ink multiplier × 10.

**Medals.** The first time a track is raced, the test bot drives it in the background (in slices during the countdown, about 30–60 ms in all). Its flying lap is the gold time; silver is +10% and bronze +25%. The targets show under the lap timer and light up as you beat them. The results screen shows the medal for the run and the next one to aim for, and My tracks shows each track's medal. Author times are saved with the track's records.

A **minimap** in the top-right corner shows the track (bridges drawn on top), you, the ghost and the AI cars.

### Saving, sharing and sound

- **Storage** (`platform/storage.ts`) is a small synchronous get/set store:
  - web build: localStorage;
  - CrazyGames build: the SDK `data` module, with every write mirrored to localStorage. An SDK read is used only if it returns a string, so the game also works when the SDK is missing or blocked.

  If storage itself is blocked (private mode, sandboxed iframe), values live in memory for the session.

  What's saved: the tracks you save, best lap and splits, best score and the best-lap ghost per track (40 most recent tracks), and settings (sound, camera, editor mode, smoothing, snap, display settings, the open sidebar section). Ghosts are stored at 30 samples/s as int16 (5 cm), about 11 KB per 45 s lap.
- **Track codes** (`track/code.ts`): `IC1.` + base64url of the dots, delta-encoded as zig-zag varints in 0.5 m steps, plus their heights, the options as a varint (banking, barriers, scenery, kerbs, run-off, barrier style, pits, time of day, laps, trees), the road width, per-corner bank overrides when there are any, the name and a checksum. That's about 100–300 characters. Older codes (v1 without heights, v2 with three options, v3 with preset widths) still load with defaults for everything newer. Pasting a damaged code gives a clear error.
  - The web build also puts the current track's code in the URL hash (`#track=…`), so the address bar is a share link, and has a "Copy link" button.
  - The CrazyGames build never touches the URL or shows links.
- **My tracks** (Pause → My tracks, Results, editor Options):
  - only tracks you save are kept: Save in the editor (it shows ✓ once the track as it is now is saved), Save track on the results screen, or Save next to a pasted code. Racing a track never saves it. (Older versions saved every raced track; that list is cleared once on the first start of this version.)
  - Delete all (tap twice);
  - thumbnails, length, multiplier, best lap and score;
  - Race / Edit / Share / Delete (tap Delete twice to confirm);
  - a box to paste a friend's code.
- **Sound:**
  - one AudioContext, created on the first tap/click/key and resumed on every later touchend/click while it is suspended (iOS);
  - engine: two oscillators and a filter, pitch through five gears;
  - tyre squeal: band-passed noise when sliding on tarmac;
  - grass rumble, plus countdown and lap beeps;
  - M toggles sound (also in the pause menu).
- **Web build only:** on a phone held upright, a "turn your phone sideways" screen covers the game and pauses the race.

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

**Submitting:** run `npm run build:cg` (or `build:cg:ads` for Full Launch), zip the *contents* of `dist/crazygames` (so `index.html` is at the root), upload it in the CrazyGames Developer Portal, and choose "Yes, using the Data Module" for Progress Save.

## Status

- [x] Phase 1: track drawing (2D editor)
- [x] Phase 2: 3D track
- [x] Phase 3: car and driving
- [x] Phase 4: race / time trial (plus a bigger editor upgrade: dots mode, crossings, tighter corners)
- [x] Phase 5: track library, sharing, audio
- [x] Phase 6: CrazyGames SDK
- [x] Elevation, banking, barriers, bridges, scenery themes; editor zoom/pan, lazy pen, section redraw, soft editing and Height mode; minimap and medals
- [x] Editor sidebar (7 sections), stats strip, numbered corners, road width, kerb / run-off / barrier styles, pits, sunset, laps, tree density, display settings, 3D view
- [x] Race setup menu (practice / race, laps 1–10, ghost on / off), AI cars with difficulty 1–100 %, car-to-car contact, positions; double-tap R restarts a practice lap
