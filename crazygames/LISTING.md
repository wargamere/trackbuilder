# Track Builder 3D: CrazyGames launch kit

Everything for submitting the game on the [CrazyGames Developer Portal](https://developer.crazygames.com/), in the order the portal asks for it.

## 1. The build

| Launch | Command | Upload |
|---|---|---|
| **Basic Launch** (first; no ads) | `npm run package:cg` | `dist/crazygames/index.html` |
| **Full Launch** (when CrazyGames invites you; ads on) | `npm run package:cg:ads` | `dist/crazygames/index.html` (rebuilt with ads on) |

Each command builds the game as **one self-contained `index.html`**: the game's code is inline in it, and the third-party notices are in a comment at the top. It also checks it against CrazyGames' limits, and writes a zip of it (`dist/track-builder-3d-crazygames-basic.zip` / `-full.zip`) in case the portal asks for one. The build is about 1 MB in one file, against limits of 50 MB initial download, 250 MB total and 1,500 files. That's small enough for the mobile homepage (20 MB). Before packaging, put the Supabase project details in `.env` (see [`../supabase/README.md`](../supabase/README.md)) so the zip includes cloud saves.

## 2. Store text (copy and paste)

**Title:** Track Builder 3D

**Short description:** Draw any racetrack you can imagine, then race it in 3D against AI rivals.

**Description:**

> Track Builder 3D lets you design a racetrack in seconds and race it straight away. Sketch a loop freehand or place it dot by dot. Then shape it with hills, banked corners, bridges and tunnels, kerbs, gravel traps, barriers and grandstands. Hit Race and you're on the grid against up to 11 AI drivers, who find the fastest line round whatever you've built.
>
> Not feeling creative? Pick one of 23 ready-made tracks or 30 circuit layouts inspired by famous racetracks. Or let the generator make a Grand Prix, street circuit, oval or kart track for you.
>
> **Features**
> - A draw-and-race track editor: freehand or dots, hills, banking, bridges or tunnels, run-off, barriers, scenery and weather-proof roads (tarmac, dirt or snow)
> - A career: a full championship of 20 cars and 10 teams, season after season, with qualifying, points for the top ten, drivers' and constructors' titles, and offers from better teams as you win
> - Race up to 11 AI cars that take racing lines, slipstream and battle wheel to wheel
> - Races of 1 to 50 laps, with tyre wear and pit stops through a real pit lane with a 60 km/h limiter
> - Damage (wreck the car and you're out of the race), yellow flags and a safety car that bunches the field up
> - Rain, changing weather and night races
> - Car setup: wing, gears and brake balance
> - A live timing tower, a ghost of your best lap, and medals for every track
> - Share any track with a short code

**Controls:**

> **Driving:** W / ↑ accelerate · S / ↓ brake and reverse · A D / ← → steer · E / Q shift up / down (manual gears) · R back onto the track · C camera · T timing tower · 1–4 choose tyres in the pits · Esc pause · M sound. Every key can be changed under Controls. Gamepads work too, and phones and tablets get on-screen controls.
>
> **Editor:** drag to draw a loop, or click to place dots · drag dots to reshape · scroll or pinch to zoom · Z undo · Y redo · V 3D view · Enter race your track.

**Category:** Driving (racing). **Suggested tags:** Car, Racing, 3D, Building, Drawing, Level editor, AI.

## 3. Submission form answers

| Question | Answer |
|---|---|
| Engine / technology | HTML5 (JavaScript, Three.js) |
| Devices | Desktop and mobile (touch controls on phones and tablets) |
| Orientation | **Landscape** (CrazyGames asks mobile players to rotate; the game has no lock of its own) |
| Multiplayer | No |
| Progress save | **Yes, using the Data Module.** Logged-in players' saves also go to our own cloud (Supabase) under their CrazyGames account. |
| Account integration | CrazyGames accounts only: the username labels your ghost car, and saves follow the account. No other login. |
| In-game purchases | No |
| Ads | Basic Launch: none. Full Launch: midgame ads at natural breaks ("Race again" on the results screen) and an optional rewarded ad to unlock a paint colour early (paints also unlock by playing). |
| Language | English |
| Content | Racing, no violence; suitable for PEGI 12 |
| Third-party content | Circuit outlines from bacinger/f1-circuits and the three.js library (both MIT licence); their notices ship in a comment at the top of `index.html`. Tracks are named after places only, with no series or circuit brands. |

## 4. Covers and videos

| File | Size | Where |
|---|---|---|
| `covers/cover-landscape.jpg` | 1920 × 1080 (16:9) | Landscape cover |
| `covers/cover-portrait.jpg` | 800 × 1200 (2:3) | Portrait cover |
| `covers/cover-square.jpg` | 800 × 800 (1:1) | Square cover |
| `track-builder-3d-landscape.mp4` | 1920 × 1080 (16:9), 19.5 s | Landscape preview video |
| `track-builder-3d-portrait.mp4` | 1080 × 1620 (2:3, as the portal asks), 19.5 s | Portrait preview video |

The covers show real in-game footage plus the title only: no other text, icons, store logos or borders, as the cover rules ask. The videos are real gameplay with no mouse cursor, no black bars and no logo screens. They show a track drawn in the editor, then raced against AI cars, then raced at night in the rain. They are rendered frame by frame on a fake clock, so they're smooth. To remake the covers or videos (for example after a name change), see [`tools/README.md`](tools/README.md).

## 5. Requirements checklist

| Requirement (CrazyGames docs) | Status |
|---|---|
| Initial download ≤ 50 MB (≤ 20 MB for the mobile homepage), total ≤ 250 MB, ≤ 1,500 files | ✅ about 1 MB, one file |
| `index.html` at the zip's root, relative paths | ✅ checked by `scripts/size.mjs` |
| Gameplay start / stop events | ✅ start when driving begins or resumes; stop on pause, menus, editor and results (checked against the SDK in local mode) |
| Loading start / stop | ✅ from SDK init to the first rendered frame |
| No custom fullscreen button | ✅ none |
| Legible at 907×510, 1216×684, 1077×606, 1920×1080, 1280×720 and 800×450 (mobile) | ✅ the browser checks cover desktop and phone sizes |
| Same physics at any refresh rate | ✅ fixed 120 Hz physics (tested at 60, 144 and 240 Hz) |
| English | ✅ |
| PEGI 12 | ✅ no violence |
| No external ads; ads only via the SDK; game paused and muted during ads; nothing given on an ad error; ad-blocker users can play | ✅ (ads only in the Full Launch build) |
| No links to other sites | ✅ the CrazyGames build shows no URLs or links |
| Saves within the Data Module's 1 MB | ✅ ghosts are capped at 450 KB in total |
| Unique, clear name | ✅ "Track Builder 3D": no game with exactly that name found (similar names exist, e.g. "Race Track Builder") |

## 6. Steps

1. **Sign up** at developer.crazygames.com and finish onboarding. You can choose "hold payments" for now.
2. **Supabase:** follow [`../supabase/README.md`](../supabase/README.md) (the project's URL and publishable key are already in `.env`), then run `npm run package:cg`.
3. **Submit a game:** upload `dist/crazygames/index.html`, then fill in the text and answers above.
4. **Preview / QA tool** (in the portal): play a race to the end, try "Race again", pause and resume, open the editor, draw and race a track, mute from the CrazyGames bar, and try on a phone in landscape.
5. **Upload** the three covers and the two videos, then **submit for Basic Launch**.
6. **When invited to Full Launch:**
   - Set the Supabase function secret to the game's id: `supabase secrets set CG_GAME_ID=<id>`.
   - Run `npm run package:cg:ads` and upload the new `dist/crazygames/index.html` as the new version.
