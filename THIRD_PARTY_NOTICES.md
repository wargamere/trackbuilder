# Third-party notices

## bacinger/f1-circuits

The real-circuit layouts in `src/track/data/world.ts` are made (scaled, smoothed and simplified by `scripts/buildTracks.ts`) from the GeoJSON circuit outlines in https://github.com/bacinger/f1-circuits.

The layouts are unofficial and not associated with or endorsed by any circuit, series or rights holder. The game names them after their place only.

```
Copyright (c) 2019-2025 Tomislav Bacinger

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Terrain: Mapzen / Open Topo Data

Circuit elevations in `data/circuits/elevation-samples.json` and the derived
`src/track/data/worldTerrain.ts` use Mapzen v1.1 terrain data, supplied through
[Open Topo Data](https://www.opentopodata.org/datasets/mapzen/). The profiles are
filtered terrain estimates, not surveyed road heights. See
[Mapzen source attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
and [data sources](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md).

ArcticDEM terrain data DEM(s) were created from DigitalGlobe, Inc., imagery and
funded under National Science Foundation awards 1043681, 1559691, and 1542736;
Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017;
Austria terrain data © offene Daten Österreichs – Digitales Geländemodell (DGM) Österreich;
Canada terrain data contains information licensed under the Open Government Licence – Canada;
Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers;
Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration;
Mexico terrain data source: INEGI, Continental relief, 2016;
New Zealand terrain data Copyright 2011 Crown copyright (c) Land Information New Zealand and the New Zealand Government (All rights reserved);
Norway terrain data © Kartverket;
United Kingdom terrain data © Environment Agency copyright and/or database right 2015. All rights reserved;
United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.

## three.js

The game's 3D rendering uses three.js (https://threejs.org), bundled into the game's code.

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
