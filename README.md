# Sectional Run

A forgiving VFR practice game. You fly a little plane at a fixed 110 knots across a stylized sectional,
changing only heading and altitude, with sim speed-up. The goal is to learn to read the chart: airspace
classes, special use airspace, obstacles, airport symbols, maximum elevation figures, the isogonic line,
VOR roses and VFR cruising altitudes.

**`index.html`: real airspace, Frederick (FDK) to Bay Bridge (W29).** Airspace, airports, obstacles and VORs come
from FAA ADDS data. Water and towns are traced from the FAA Baltimore–Washington TAC, and the real TAC can be
swapped in as the map layer. The SFRA and FRZ are approximate rings. Terrain comes from AWS Terrain Tiles. **Not for navigation.**

**`3d/`: the MapLibre version.** It uses OpenFreeMap vector tiles (Positron, retinted toward sectional colors),
draws the FAA airspace as real 3D slabs at 2× vertical scale, and has a camera that rotates and pitches:
chase (track-up), orbit (drag or two-finger twist and tilt), or flat 2D. It needs a network connection for tiles.
Base map © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.

**`fictional.html`: the first prototype**, on an invented chart.

## Navigator panel (src/nav_panel.js)

A generic touchscreen navigator that mounts as a floating, draggable overlay. It's a self-contained class with
scoped CSS (`np-` prefix), no dependencies and no flight logic of its own:

```js
const nav = new NavPanel({ mount: document.body, open: true,
  onDirectTo: id => { /* make id the active waypoint */ },
  onAction: name => { /* 'quiz' | 'speed' | 'view' | 'fpl' from the Utilities page */ } });
// in your frame loop, about 4 times a second:
nav.update({ gs, trk, dis, dtk, wpt, direct, fpl, nearest, map, com, navaid, utils });
// com: { active: { freq: "128.700", name }, standby: { freq, name } } feeds the header frequency box
```

The left strip shows GS, TRK, DIS and DTK. The right screen opens on a 2×3 home grid (Map, FPL, Proc, Nav/Com,
Nearest, Utilities). The bezel's HOME and D→ buttons return to the grid and open Direct-To. In the game,
`navData()` in `src/game.html` is the adapter that builds the update from the game state.

## Six-pack instruments (src/six_pack.js)

This is a floating, draggable six-pack: airspeed, attitude, altimeter, turn coordinator, heading indicator and VSI.
It uses the SVG artwork from [QFlightInstruments](https://github.com/marek-cel/QFlightinstruments)
(MIT, © 2021 Marek M. Cel; see `third_party/qfi/LICENSE`). The Qt widgets can't run in a browser, so each gauge's
240×240 SVG layers are stacked and rotated with CSS, using the same rotation centers and scale factors as the
Qt code. `tools/build_sixpack_assets.py` packs svgo-optimized copies of the SVGs (5.6 MB down to 274 KB) into `src/sixpack_assets.js`.

```js
const six = new SixPack({ mount: document.body, onBug: deg => { /* new heading bug, magnetic */ } });
six.update({ ias, pitch, roll, alt, baro, turn, slip, hdg, bug, vs, altSel, crs, dev, brg, dist });
six.setMode('glass');   // or 'six'
```

The heading indicator has a **heading-bug knob**. Drag it round, scroll on it, or tap it to sync the bug to the
current heading. The plane now flies to the bug at standard rate, and the dock's ◀ ▶ buttons and the arrow keys move
the bug as well. The navigator's Utilities page can set the bug to the active DTK.

### Glass mode

The **SIX · GLASS** switch in the panel's top bar swaps the round gauges for the QFlightInstruments **EADI** and **EHSI**.
They're drawn on canvas from the same SVG layers, using the Qt widgets' positions, pivot points and scaling:
- **EADI:** pitch ladder and roll scale, airspeed and altitude tapes (scrolling, with live labels), an altitude bug at
  your target altitude, the VSI bar, and a heading arc with the bug.
- **EHSI:** compass card, course arrow on the active DTK, CDI bar (±2 NM full scale), bearing pointer to the waypoint, and HDG/CRS/DME readouts.

The HDG knob works in both modes.

## Intercepts and air defense

Entering the **DC SFRA** without authorization, or a prohibited area like **P-40**, brings out two interceptors.
They follow the AIM 5-6-13 procedure: the lead takes position ahead and to the left, rocks its wings, then makes a slow level
turn toward the way out. Respond with **Rock wings** (or the W key), **Call 121.5** and **Squawk 7700**, then set your
heading bug to follow. Do that and the lead breaks away ("you may proceed"), and you score points for each step.
Ignore it and you get warning flares, then the wingman fires: cartoon missiles, a fireball and a mushroom
cloud, and a debrief of what you should have done. Entering the **DC FRZ** launches a SAM. Sim speed is capped at 2×
during an intercept. Both renderers share `drawFX()`, and the 3D version projects the effects at their real
altitude using MapLibre's terrain-aware transform.

## Terrain and MEFs

`tools/build_dem.py` downloads AWS Terrain Tiles (Terrarium encoding; USGS 3DEP, SRTM and others, via Mapzen) and
writes `data/derived/dem.json`: a 0.25 nm elevation grid used for the AGL checks, the canvas hillshade and the
maximum elevation figure (MEF) for each 15′ quadrangle. MEF = highest terrain + 300 ft or highest obstacle + 100 ft,
rounded up to the next 100 ft. That matches the MEFs printed on the Baltimore–Washington TAC in every quadrangle
checked (21, 24, 13, 13, 17, 06). The 3D version also streams the same tiles for live 3D terrain and hillshading.

## Building

`index.html` and `3d/index.html` are generated, so edit `src/game.html` (game logic, shared) and `src/map_layer.js`
(the MapLibre renderer), then run `python3 tools/build_page.py` from the repo root.
To refresh the data, run `tools/fetch_faa.py` (FAA layers), `tools/masks.py` (water and town mask plus the
reprojected TAC, which needs the TAC GeoTIFF) and `tools/build_world.py` (`data/derived/world.json`). The scripts expect
the chart GeoTIFFs in a local `charts/` folder; they aren't committed.

## The real mission (index.html)

- **Route:** Frederick to Bay Bridge. The direct course cuts through the DC SFRA, so you have to plan north of it,
  under the Washington Tri-Area Class B shelves (floors from 1,500 to 4,500), past Baltimore's congested area,
  Martin State's Class D and R-4001.
- **Checkride questions** on real features:
  - the Frederick Class D [28] and Martin State's [25]
  - P-40 with R-4009 stacked on top
  - the Dulles and BWI Mode C veils
  - Bravo entry rules and the shelf you're under
  - SFRA requirements
  - real obstacle heights in MSL and (AGL)
  - congested-area minimums
  - R-4001 status, the BAL VOR rose, and the CTAF arrival at Bay Bridge
- **Radio:** Potomac Approach (a Bravo clearance isn't guaranteed), Class D towers, flight service for SUA status,
  and the Bay Bridge CTAF.
- **TAC button:** swaps the stylized map for the real FAA chart, reprojected to line up.

## The fictional prototype (fictional.html)

- **Mission:** fly from Cedar Valley to Harbor Point. The direct course runs under a Class B shelf, through a
  Class D, and over a prohibited area.
- **Chart features:**
  - Class B wedding cake, Class C, two Class Ds, and Class E 700 ft vignettes
  - Restricted area R-4401 (hot or cold, rolled each flight), prohibited area P-42, and Juniper MOA
  - Towers with MSL and (AGL) heights, a VOR compass rose, the 8°W isogonic line, MEFs, and visual checkpoints
- **Checkride questions** pop up as you reach each feature, and each answer comes with an explanation.
- **Radio:** call approach or a tower. Sometimes you'll hear "Aircraft calling… standby", which doesn't
  establish two-way communication. Capella Approach can refuse a Bravo clearance.
- **Scoring:** points for right answers, correct VFR cruising altitudes and a clean arrival. Penalties for airspace
  violations, flying too close to towers, and going below 1,000 ft AGL over towns.
- **3D:** tilts the chart so the airspace shows as stacked translucent slabs.
- **Tap to inspect:** tap anything on the map to see what it is.

One self-contained `index.html` with no build step and no dependencies. It works on phones and desktops.

## Controls

**Phone or tablet:**
- ◀ ▶: hold to turn
- ▲ ▼: change target altitude by 500 ft
- RADIO, 3D, sim speed, zoom and pause buttons
- Pinch to zoom, drag to look around, tap the map for info

**Keyboard:**
- ← → turn · ↑ ↓ altitude
- R radio · V 3D · X speed · P pause · L land · + − zoom
