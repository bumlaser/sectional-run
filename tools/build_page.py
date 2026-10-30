"""Build both pages from src/ (run from the repo root):
  index.html     canvas version, fully self-contained (works as a Claude artifact too)
  3d/index.html  MapLibre version with OpenFreeMap tiles, 3D airspace and a rotating camera (needs network)"""
import base64, os
ML = '4.7.1'
import json
src = open('src/game.html').read(); _w = json.load(open('data/derived/world.json'))
if os.path.exists('data/derived/dem.json'): _w['dem'] = json.load(open('data/derived/dem.json'))
w = json.dumps(_w, separators=(',', ':'))
tac = 'data:image/jpeg;base64,' + base64.b64encode(open('data/derived/tac_warp.jpg', 'rb').read()).decode()
fill = lambda s: s.replace('__WORLD__', w, 1).replace("'__TAC__'", "'" + tac + "'", 1)
NAVJS = ''.join('<script>\n' + open(f).read() + '</script>\n' for f in ('src/nav_panel.js', 'src/sixpack_assets.js', 'src/six_pack.js'))
src = src.replace('<script>\n\'use strict\';\nconst WD', NAVJS + '<script>\n\'use strict\';\nconst WD', 1)
assert NAVJS in src, 'nav panel not inserted'
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
open('index.html', 'w').write(head + fill(src) + '</html>\n')

def patch(s, a, b):
    assert s.count(a) == 1, a[:60]; return s.replace(a, b)
m = src
m = patch(m, '<title>Sectional Run</title>', f'<title>Sectional Run 3D</title>\n<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@{ML}/dist/maplibre-gl.css">\n<script src="https://unpkg.com/maplibre-gl@{ML}/dist/maplibre-gl.js"></script>')
m = patch(m, '</style>', """  #map { position:fixed; inset:0; background:#dde8c6; }
  canvas#c { position:fixed; inset:0; pointer-events:none; z-index:1; }
  .maplibregl-ctrl-bottom-right { bottom:calc(118px + env(safe-area-inset-bottom, 0px)); }
  .maplibregl-ctrl-attrib { font-size:10px; }
</style>""")
m = patch(m, '<canvas id="c"', '<div id="map" aria-label="Map"></div>\n<canvas id="c"')
m = patch(m, '<button type="button" id="bView">3D</button>', '<button type="button" id="bView">CHASE</button>')
m = patch(m, '<li><b>3D</b> shows the airspace as stacked slabs · <b>TAC</b> swaps in the real FAA chart</li>',
          '<li><b>CHASE / ORBIT / 2D</b> cycles the camera: track-up behind the plane, free orbit (drag or two-finger twist and tilt), or flat north-up · <b>TAC</b> overlays the real FAA chart</li>')
m = patch(m, "  buildBase(); newGame();\n  const b = document.getElementById('startBtn'); b.disabled = false; b.textContent = 'Start flight'; b.click();",
          "  base = true; newGame(); maskReady = true; if (typeof enableStart === 'function') enableStart();")
m = patch(m, "const mimg = new Image();", "let maskReady = false;\nconst mimg = new Image();")
m = patch(m, "  if (game && base) render();", "  if (game && base && typeof mapReady !== 'undefined' && mapReady) render();")
m = patch(m, 'The SFRA and FRZ are approximate rings',
          'Base map © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors, Positron style. Airspace heights are drawn at 2× vertical scale. The SFRA and FRZ are approximate rings')
layer = open('src/map_layer.js').read() + open('src/live_traffic.js').read() + """
function enableStart() { if (!(maskReady && mapReady)) return; const b = document.getElementById('startBtn'); b.disabled = false; b.textContent = 'Start flight'; b.click(); }
function mapReadyHook() { enableStart(); }
"""
i = m.rindex('</script>\n') + len('</script>\n')   # after the game's own script
m = m[:i] + '<script>\n' + layer + '</script>\n' + m[i:]
os.makedirs('3d', exist_ok=True); open('3d/index.html', 'w').write(head + fill(m) + '</html>\n')
print('index.html', os.path.getsize('index.html') // 1024, 'KB · 3d/index.html', os.path.getsize('3d/index.html') // 1024, 'KB')
