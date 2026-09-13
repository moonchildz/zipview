# Satellite ground rendering

## Current default — 2026-09-14 KST

The default is now **Maps Static API, zoom 18, size 640×640, scale 2**
(1280×1280 output). The image is centered on the selected building's footprint
in geographic coordinates, including complexes beyond the original three pilots.
The client uses `/api/imagery/static/metadata` and `/api/imagery/static/image`
with validated longitude, latitude and zoom. Metadata is calculated locally;
loading an image makes one billable provider request. The old tile endpoints
remain available for comparison but are not the default.

At Seoul latitude one image spans approximately 303m, so far-away terrain uses
the plain ground material color. Zoom 18 does not cover the old 2km tile viewport.
The original image remains complete, with an original-image attribution link.
Floor/window/visibility changes reuse the texture in memory. Errors retain the
plain ground and allow an explicit retry; there is no automatic low-resolution
fallback, disk cache, citywide prefetch or tree/facility extraction pipeline.
Enable **Maps Static API** on the server-side key; Map Tiles permission alone
does not enable this product. This remains a development/preview proxy.

See [API verification, prices and usage limitations](GOOGLE-IMAGERY-OPTIONS.md).
Earlier implementation details below describe the prior Map Tiles default.

Implemented 2026-09-10 for Sinchon Prugio and Gyeonghuigung Xi.

## Status

Default-loading update: both sites now load the zoom-15 2 by 2 viewport automatically, as requested by the user. The previous high-resolution-first/manual-fallback workflow described in the historical verification below is no longer the default. No high-resolution request or failure retry is automatic. Windows, floors, resize and visibility changes reuse the loaded texture; a fresh page load requests imagery again and can incur API usage.

The user has now configured the local Google key. Session and viewport requests succeeded (HTTP 200). Actual high-resolution Xi-area satellite requests at zoom 16, 17 and 18 returned HTTP 404, despite overlapping high-zoom rectangles in viewport metadata. This is not an authentication failure or proof of nationwide unavailability. The documented example tile and world tile returned JPEGs, confirming that the request endpoint works. Xi center requests at zoom 15, 14 and 13 returned JPEGs.

An explicit low-resolution fallback now offers zoom 15 with a 2 by 2 tile viewport after a zoom-18 tile 404 or unsupported-viewport response. All four Xi fallback tiles loaded successfully. Live browser checks passed on desktop and mobile, using the same in-memory imagery without downloading it again on resize. The real screenshots imagery-live-xi-* were visually inspected: the ground is visibly photographed but blurry, unsuitable for identifying narrow paths and flower beds. At this latitude, zoom 15 is approximately 3.8 metres per image pixel. Actual geographic alignment, acquisition date and Sinchon live imagery remain unverified.

Browser screenshots named imagery-fixture-* still use explicitly labeled synthetic checker images, not satellite imagery. Do not use those screenshots as evidence of realism or geographic alignment.

## Run

Set GOOGLE_MAPS_API_KEY locally in .env.local, enable Google Map Tiles API, and allow that API in the key's API restrictions. Geocoding-only permission is insufficient. Restart the Vite server after changing the key.

Use npm run dev, or npm run build followed by the Vite preview server. The Google proxy is a Vite plugin for local development/preview. A static dist deployment alone does not include the proxy; production hosting needs an authenticated backend and provider-compliant access controls. No key is bundled into client code.

Opening either apartment automatically requests metadata and four low-resolution image tiles at zoom 15 (approximately 1.94 km wide). Google session/viewport metadata requests are additional to the image requests. Requests can consume quota or incur charges. On failure the existing terrain and road settings remain, and a manual retry button becomes available. No automatic retry, scraping, disk imagery cache or repository imagery copy is used. Toggling the loaded image uses the in-memory texture only.

The local proxy allows only the two configured sites and their fixed tile coordinates, requires the app's request header, rejects cross-site fetches, and caps upstream requests at 160 per server instance. This is a development safeguard, NOT a billing-account spending cap. Set provider quotas and key restrictions separately. Do not expose this development proxy publicly.

## Rendering

- Each terrain vertex's existing local coordinates are converted back to longitude/latitude, then into Web Mercator image coordinates. Latitude orientation is preserved; north is the top of the image.
- Both coarse terrain and the Sinchon local correction mesh receive the same geographic texture coordinates. No terrain heights, building footprints, camera positions, floor heights or eye heights are modified.
- A photo-colour material avoids multiplying the baked photographic lighting by the synthetic scene lights. Anisotropic filtering improves oblique ground sampling.
- Estimated road ribbons remain enabled by default over the photograph. The road checkbox is independent: loading or toggling imagery never changes the user's road-overlay choice. These ribbons still use estimated geometry and can disagree with the photograph.
- Images activate only after every tile succeeds. Partial failure leaves the existing terrain and road settings intact. Google viewport attribution is required before image access. Google imagery attribution and the separate model attribution appear below the view.
- The photo viewport is finite; outside it the ground remains a simple base colour. Low-altitude oblique views can magnify source pixels. Photograph roofs/shadows may disagree with OSM buildings, and roofs visible in the image are not additional 3D objects. Tree canopies, retaining walls, road kerbs and facade geometry are not reconstructed from imagery. Acquisition date and actual spatial registration remain unverified.

## Verification

42 unit tests passed, including coordinate orientation/round-trip, original terrain heights, credential redaction, allowed tile bounds, missing-key handling, attribution requirement, independent low-resolution viewport authorization and request cap. Production build passed with the existing large-chunk warning.

`node tests/imagery-browser.mjs` runs against port 5174 by default (TEST_BASE_URL overrides it). It uses synthetic tile responses for both sites at widths 1440 and 390, checks automatic low-resolution loading (one metadata plus four image requests), canvas-pixel changes for imagery and roads, default-on roads and independent road visibility, no new tile requests on a toggle, unchanged camera heights, metadata/tile failures, explicit-only retries, shader errors and horizontal overflow. Results are in ignored verification/imagery-results.json. Other browser suites also intercept automatic imagery requests with fixtures to avoid unintended live API use.

`node tests/imagery-live.mjs` is an explicit, quota-consuming live check and is not part of npm test. The Xi run used 7 local requests: high-resolution metadata and a tile 404, then low-resolution metadata and 4 successful image tiles. It confirmed 120,288 changed canvas pixels, unchanged camera elevations (53.68/68.18 m), real provider attribution, desktop/mobile display and no script/shader errors. Separate diagnostic requests were also made. Results are in ignored verification/imagery-live-xi.json. Ground-photo loading is verified, but detailed paths/planting and geographic accuracy are not.

The latest automatic-loading Xi live check used exactly 5 local requests (zoom-15 metadata + 4 successful tiles), with no high-resolution probe or retry. It confirmed 144,253 changed canvas pixels, unchanged camera elevations (53.68/68.18 m), provider attribution and desktop/mobile display. The updated script no longer clicks a load/fallback command. The latest results and screenshots overwrite the above verification paths; the 7-request result is historical.

## Provider references

- [Satellite tile requests](https://developers.google.com/maps/documentation/tile/satellite)
- [Session requests](https://developers.google.com/maps/documentation/tile/session_tokens)
- [Viewport coverage and attribution](https://developers.google.com/maps/documentation/tile/2d-tiles-overview)
- [Map Tiles policies and hybrid visualization attribution](https://developers.google.com/maps/documentation/tile/policies)
