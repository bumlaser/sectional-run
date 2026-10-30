# Sectional Run (prototype)

A forgiving VFR practice game. You fly a little plane at a fixed 110 knots across a stylized sectional,
changing only heading and altitude, with sim speed-up. The goal is to learn to read the chart: airspace
classes, special use airspace, obstacles, airport symbols, maximum elevation figures, the isogonic line,
VOR roses and VFR cruising altitudes.

**The chart in this prototype is entirely fictional.** None of the airports, airspace, towers or place names
are real. Never use it for navigation. Real FAA airspace data (public domain) can replace it later.

## What's in it

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
