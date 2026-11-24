# Circuit terrain and physical scale

Real circuits use published full lap lengths and representative road widths in metres.
The editor, road, terrain, scenery and records support these full-size layouts.
This port retains the original game's car and handling.

## Elevation

`data/circuits/elevation-samples.json` freezes 96 geographically registered
samples per circuit from the Mapzen v1.1 digital elevation model, queried through
Open Topo Data with bilinear interpolation. This is mixed-resolution terrain
data, commonly around 30 m, rather than a laser scan of the road. Median and
triangular filters reject isolated building/vegetation spikes. Relative height
ranges are calibrated where available against Formula 1's published elevation
changes, including Spa 102.2 m and Spielberg 63.5 m. Old published ranges may
describe earlier circuit revisions. The remaining circuits retain their filtered
DEM ranges. The simplified XY outlines and sample spacing limit local accuracy.

Each profile has a small relative datum, not an altitude-above-sea-level claim.
Suzuka retains its existing bridge clearance. A coarse bounded terrain envelope
fills the hills between roads without increasing the main heightfield budget.
Road grade, car pitch and suspension follow the same profile.

Regenerate **offline** with `node scripts/buildCircuitTerrain.ts`. Use `--refresh`
to query the public service again; it downloads the MIT source outlines and
throttles requests. The cache records outline hashes, registration error, sample
coordinates and query date. No elevation service is contacted during gameplay.

Sources: [Mapzen dataset](https://www.opentopodata.org/datasets/mapzen/),
[Open Topo Data API](https://www.opentopodata.org/api/),
[published circuit elevation ranges](https://www.formula1.com/en/latest/article/highs-and-lows-which-f1-track-has-the-most-elevation-changes-.7I9JEcBw3R2AqXbnJ6hyvc).
Terrain attribution is in `THIRD_PARTY_NOTICES.md` and the shipped notices file.

## Banking

Zandvoort's Hugenholtz and final corners use an 18° maximum, with gradual entry
and exit transitions. Jeddah's Turn 13 uses 12°. Locations are registered to the
game's existing start line. Zandvoort's real crossfall varies across the road;
this model represents it with one angle per road section. Unmeasured crossfall
elsewhere remains zero instead of assigning invented steep banking.

`Dot.bank` is signed absolute crossfall in degrees (positive raises the left
edge); it does not shrink with corner radius. Legacy `Dot.b` remains a maximum
angle multiplied by corner tightness. Editing, reversing, mirroring, saving and
version 6 share codes preserve signed banks and heights up to 200 m. Codes from
versions 1–5 still load. Revised world-layout lap records use `terrain-v2/`,
leaving old full-size flat-layout records stored under `full-v1/`.

Sources: [Circuit Zandvoort corners](https://www.circuitzandvoort.nl/en/corners/),
[Jeddah circuit operator](https://www.jeddahcircuit.com/en),
[Formula 1's Turn 13 report](https://www.formula1.com/en/latest/article/new-pictures-reveal-jeddahs-sweeping-turn-13-as-construction-continues-ahead.5na8wGmMNk4DDYjMJ5QXV6).

## Widths

`src/track/circuitWidths.ts` replaces the old compressed-layout fitting values
with representative racing widths. Examples are Bahrain 16 m, Silverstone
15 m, Spa 12 m and Monaco 10 m. This is still a single-width road model: it does
not recreate every local narrowing or start-straight widening. Some widths are
approximations within published circuit ranges, rather than measured averages.
The FIA licence table's reference width is not assumed to be an average.

References: [FIA circuit licence list](https://www.fia.com/sites/default/files/circuits_fia20240312_1.pdf),
[Silverstone media guide, 15 m average](https://www.fia.com/sites/default/files/bgp_online_media_guide_new_map2018.pdf),
[Bahrain operator](https://www.bahraingp.com/corporate-sales/track-hire/),
[Bahrain GP media kit, 14–22 m](https://d3ie7ogstrup9y.cloudfront.net/wp-content/uploads/2023/03/01155446/2023-Bahrain-Grand-Prix_Media-Kit-EN.pdf),
[Mugello technical map](https://mugellocircuit.cronorapino.it/downloads/MAPPE%20CIRCUITO/Cartina%20Tecnica.pdf).
