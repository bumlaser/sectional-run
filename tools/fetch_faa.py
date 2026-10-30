import json, subprocess, sys, urllib.parse, os, time
B = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services"
ENV = "-79.95,35.5,-71.65,40.28"   # Washington sectional bounds
OUT = sys.argv[1]
PAGE = 150
ONLY = sys.argv[2:]
LAYERS = {
  'class_airspace': ('Class_Airspace', '1=1'),
  'sua': ('Special_Use_Airspace', '1=1'),
  'prohibited': ('Prohibited_Areas', '1=1'),
  'nda_tfr': ('National_Defense_Airspace_TFR_Areas', '1=1'),
  'airports': ('US_Airport', '1=1'),
  'navaids': ('NAVAIDSystem', '1=1'),
  'obstacles': ('Digital_Obstacle_File', 'AGL >= 300'),
}
def get(url):
    for attempt in range(6):
        subprocess.run(['curl', '-sS', '-m', '180', '-o', '_page.json', url])
        d = json.load(open('_page.json'))
        if d.get('error', {}).get('code') == 429: print('  429, waiting 65s', flush=True); time.sleep(65); continue
        time.sleep(2); return d
    return d
for key, (svc, where) in LAYERS.items():
    if ONLY and key not in ONLY: continue
    feats, off = [], 0
    while True:
        q = urllib.parse.urlencode({'where': where, 'geometry': ENV, 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
                                    'outFields': '*', 'outSR': 4326, 'f': 'geojson', 'resultOffset': off, 'resultRecordCount': PAGE, 'geometryPrecision': 5, 'maxAllowableOffset': 0.0003})
        try: d = get(f"{B}/{svc}/FeatureServer/0/query?{q}")
        except Exception as e: print(key, 'ERR', e); break
        if 'features' not in d: print(key, 'resp', str(d)[:200]); break
        feats += d['features']; off += len(d['features'])
        if len(d['features']) < PAGE and not d.get('properties', {}).get('exceededTransferLimit'): break
        if not d['features']: break
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, key + '.geojson'), 'w'))
    print(key, len(feats), flush=True); print(key, len(feats), os.path.getsize(os.path.join(OUT, key + '.geojson')) // 1024, 'KB')
