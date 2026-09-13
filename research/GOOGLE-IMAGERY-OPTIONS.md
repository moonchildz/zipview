# Google imagery checks — 2026-09-14 KST

At the Gyeonghuigung Xi scene center, authenticated Map Tiles satellite requests
returned an image at zoom 15 and HTTP 404 at zooms 16–20. This does not establish
a nationwide or permanent coverage limit.

Maps Static API returned actual satellite images at zooms 17, 18 and 19 using
`size=640x640&scale=2`. Zoom 18 also returned imagery at the Sinchon Prugio and
Hanshin Hanjin scene centers. These images were visually inspected; nationwide
coverage, acquisition date, geographic accuracy and tree heights are unverified.
The images have building lean and occlusion, and are not verified true orthophotos.

Approximate ground widths at Xi are 606m / 303m / 151m at zoom 17 / 18 / 19.
Output is 1280×1280; output pixel spacing is not a claim about source survey
resolution. Scale 2 changes output density, not geographic coverage.

Global pay-as-you-go pricing checked on 2026-09-14 KST:

| SKU | Monthly free cap | First paid tier per 1,000 requests |
| --- | ---: | ---: |
| 2D Map Tiles | 100,000 | USD 0.60 |
| Static Maps | 10,000 | USD 2.00 |

Static Maps zoom 17/18/19 have the same per-request SKU. Coverage and image
count therefore matter: one higher-zoom image cannot cover the same area as
the existing four zoom-15 tiles. Free caps are shared across projects under
the same billing account. Taxes, other usage and negotiated contracts excluded.

The default imagery now uses the selected building's geographic location via
the common Static Maps endpoint at zoom 18. The legacy tile endpoints still
support three named sites for comparison. Unknown complexes are no longer
mapped to Hanshin by the imagery client. Image download success alone does
not validate use as permanent assets or as source data for tree/facility models.
Google's terms restrict bulk extraction, caching and creation of derived content;
do not describe a nationwide image/model archive as licensed by ordinary API access.

Sources:
- https://developers.google.com/maps/documentation/maps-static/start
- https://developers.google.com/maps/documentation/maps-static/usage-and-billing
- https://developers.google.com/maps/documentation/tile/satellite
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://cloud.google.com/maps-platform/terms (3.2.2(b), 3.2.3(a)–(c))

Local visual checks and sanitized response reports are in
`verification/xi-google-review/` (not published). Keys and session tokens are
never written to these reports. Esri imagery in `verification/xi-satellite/`
is a different source and must not be labelled as Google imagery.

## Push verification

The unit/regression suite is run with
`node --test --test-skip-pattern="real adapters link every transcribed unit" tests/*.test.mjs`.
That one integration test rebuilds the entire local index twice; it is excluded
while the citywide collector is running with `--no-build`. The current catalog
is about 532 MB and full regeneration remains a separate, deferred issue.
`node node_modules/vite/bin/vite.js build` validates the app with the existing
catalog without triggering npm's citywide `prebuild`. This is not evidence that
the current download corpus has been fully indexed or all apartments verified.
