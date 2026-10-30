# Chart data

- `faa/*.geojson`: FAA ADDS data (public domain), clipped to the Washington sectional area
  (lon -79.95 to -71.65, lat 35.5 to 40.28) and downloaded with `tools/fetch_faa.py`.
  - `class_airspace`: Class B, C, D and E with floor and ceiling
  - `sua`: special use airspace (restricted, MOA, warning, alert)
  - `prohibited`: P-40, P-56 and P-73
  - `airports`
  - `navaids`
  - `obstacles`: obstacles 300 ft AGL or taller
- The DC SFRA and FRZ aren't in the FAA datasets, because they're defined in 14 CFR 93. For now they're
  approximated as rings around the DCA VOR: 30 nm for the SFRA and about 15 nm for the FRZ.
- `Baltimore-Washington TAC.tfw` / `.htm`: georeferencing for the TAC GeoTIFF (Lambert Conformal Conic,
  standard parallels 33° and 45°, origin 38.9917°N 77.05°W, NAD83). `tools/lcc.py` converts between
  lat/lon and chart pixels.
- `tac_overlay_check.jpg`: the FAA Class B/D and SUA shapes plus the 30 nm SFRA ring drawn over the TAC,
  as an alignment check.

The GeoTIFF rasters themselves (about 130 MB) aren't committed.
