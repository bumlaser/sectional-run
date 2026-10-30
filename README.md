# Sectional Run

A forgiving VFR practice game. You fly a little plane at a fixed 110 knots across a stylized sectional,
changing only heading and altitude, with sim speed-up. The goal is to learn to read the chart: airspace
classes, special use airspace, obstacles, airport symbols, maximum elevation figures, the isogonic line,
VOR roses and VFR cruising altitudes.

**`index.html`: real airspace, Frederick (FDK) to Bay Bridge (W29).** Airspace, airports, obstacles and VORs come
from FAA ADDS data. Water and towns are traced from the FAA Baltimore–Washington TAC, and the real TAC can be
swapped in as the map layer. The SFRA and FRZ are approximate rings, and ground heights are estimated from airport
elevations. **Not for navigation.**

**`fictional.html`: the first prototype**, on an invented chart.

## Building

`index.html` is generated, so edit `src/game.html` and run `python3 tools/build_page.py` from the repo root.
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
