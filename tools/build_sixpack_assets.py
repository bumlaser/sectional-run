"""Package the QFlightInstruments six-pack SVGs (MIT, (c) 2021 Marek M. Cel) as src/sixpack_assets.js.
Usage: python3 tools/build_sixpack_assets.py <path to an svgo-optimised copy of qfi/images>
(the optimised SVGs are made with: npx svgo --multipass -p 2)."""
import base64, os, sys, json
src = sys.argv[1]
out = {}
for d in ['ai', 'alt', 'asi', 'hi', 'tc', 'vsi']:
    for f in sorted(os.listdir(os.path.join(src, d))):
        if f.endswith('.svg') and f != d + '.svg':
            out[f[:-4]] = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(src, d, f), 'rb').read()).decode()
lic = open('third_party/qfi/LICENSE').read().strip().replace('*/', '* /')
js = f"/* Six-pack instrument artwork from QFlightInstruments, https://github.com/marek-cel/QFlightinstruments\n{lic}\n*/\nwindow.SIXPACK_SVG = {json.dumps(out, separators=(',', ':'))};\n"
open('src/sixpack_assets.js', 'w').write(js); print(len(out), 'layers,', len(js) // 1024, 'KB')
