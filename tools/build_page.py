"""Assemble index.html from src/game.html + data/derived (run from the repo root)."""
import base64
s = open('src/game.html').read(); w = open('data/derived/world.json').read()
tac = 'data:image/jpeg;base64,' + base64.b64encode(open('data/derived/tac_warp.jpg', 'rb').read()).decode()
s = s.replace('__WORLD__', w, 1).replace("'__TAC__'", "'" + tac + "'", 1)
head = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
open('index.html', 'w').write(head + s + '</html>\n'); print('index.html', len(s) // 1024, 'KB')
