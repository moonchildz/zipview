# Two Target Complexes

## Terrain-derived views — 2026-09-12

Implemented and executed `npm run pipeline:elevations`: **Xi2 14 buildings/1148 homes, Sinchon2 10 buildings/426 homes, Hanshin Hanjin205 84 homes**. All1658 source homes now resolve an estimated exterior view, even when the plan image or exact window registration is missing. The ordinary `pipeline:targets` also runs this stage and reports `estimatedComplete` independently from fully verified registration.

Each record carries ground, first-floor/floor/eye elevations, the2.9m floor-height assumption, building-height provenance, and an estimated facade point. Existing Xi204 DEM base49.27736770844799m is preserved. Sinchon uses NGII correction including separate209/210 footprints. Hanshin205 uses the existing regional Mapzen DEM,21 official floors and60.9m assumed building height; its84 official homes all have132.96㎡ exclusive area. The SH32㎡ rental plan is not used for205.

Search results provide a terrain-view link; Sinchon plan views also route their Outlook tab to the selected household. The new route uses50° horizontal FOV, actual available floors in that line, per-dong ground elevation, editable floor/eye heights and site-specific imagery coordinates. Existing plan-registered Xi interior routes remain available. This is usable **estimated exterior/elevation coverage**, not a claim that every plan is already georegistered or that floor elevations were surveyed.

Review: http://127.0.0.1:5173/research/linkage/generated/elevation-review.html

## Latest implementation — 2026-09-12

The user's requested full per-unit direction/reflection and geographic window registration is **not complete**. The work below is implemented and tested; the older checkpoints describe superseded states.

- Recovered Sinchon209 as a distinct building using three address/dong-labelled NGII features, merging the sheet seam into two physical parts. Separated210's eastern wing from the merged OSM outline, excluding209. The two geometries have zero overlapping area. Both Sinchon and Xi views reproject this same correction into their own origins. Official building heights propagate to all parts; bases remain contour estimates. **210's outer boundary is still OSM-based**, not a labelled surveyed footprint.
- Corrected **45 rental homes in203**: provider images for34AT/34B/49A were terrace-family drawings, while SH's rental guide and the site blueprint identify different rental layouts. They now use distinct SH34A/34B/49A plans, three new models and13 traced openings. The source sheet is cropped for the selected type in the viewer; its original remains accessible. Dimensions are approximate printed wall-line readings.
- Transferred dimension readings to **22 target homes**:15 34AT homes in207/208 and7 49A homes in209/210. The34B terrace reading is available only in type viewing; it cannot apply to203's different rental layout. Calibration is scoped by source hash and building. Unequal horizontal/vertical raster scales preserve perpendicular metric window-camera insets.
- `npm run build:footprints` regenerates geometry and a before/after review. Requires Python with numpy, pyproj and shapely; the local mapinfo environment includes them. `ZIPVIEW_PYTHON` can select another interpreter. `pipeline:targets` includes geometry regeneration after source collection.

Review: http://127.0.0.1:5173/research/linkage/generated/footprint-review.html

Examples: `/?site=sinchon&building=203&unit=204` (SH34B),203-205 (SH34A),203-206 (SH49A),207-101 and210-101 (dimension-calibrated terrace plans).

Validation:106 unit tests passed; the final scope/geometry checks passed again after the last guard change. SH three-type source/model/window flows and dimension-reference links passed at1440/390px; the shared target browser suite passed. Multipart209 selection, finite facade geometry and KML MultiGeometry export passed. The production build includes the footprint correction and every active dimension/source image. These checks establish the implemented paths, not all-home geographic accuracy.

Full completion still needs per-floor plans that show **unit numbers, entrance/core and opening positions together**; the available type drawings, whole-site blueprints and unit-stack charts do not establish all those correspondences. Existing Xi interior routes remain106; the remaining Xi models have not been created by this change. Exact84F/F1 assignment and FFL/vertical opening data remain missing as described in `PLACEMENT-DATA-GAPS.md`.

Additional collection on 2026-09-12: SH original architectural sheets and dimensioned guide, Sinchon209 terrace detail, three reposted dimension plans, Xi84F photos/plan and Dongso-mun Hanjin rental drawings are now downloaded. See [source review and commands](ADDITIONAL-EVIDENCE.md). These are acquired references, not completed model registration.

Updated 2026-09-12. User resumed work: complete both target complexes first, then extend to Seongbuk-gu Hanshin Hanjin apartment building 205. The second site is queued; no completion of either current target is claimed.

## Local restoration and environment separation, 2026-09-12

The current Windows workspace now has the national inventory ZIP and verified complete CSV extraction, both official site blueprints, official building records, and supplemental Xi 77A/116A images. The table below was reproduced locally, not merely copied from the previous machine's report. All 1,574 target household identities are reachable; 1,559 have plan images. Xi's 15 ambiguous 84F/F1 units remain unresolved.

`npm run pipeline:targets` restores missing target sources, compiles the index, and runs the target audit. `--offline` uses local files only. Exit code 2 means the target flow is incomplete, even if collection and compilation succeeded. `generated/target-pipeline.json` records the executed stages and result. This command does not turn provisional geometry or incomplete window evidence into a verified view.

`src/neighborhood.js` now separates a regional snapshot from the default home/window selection and caches source requests, including concurrent requests. Outlook uses that store; facade adapters receive independent working data, so changing one view cannot mutate a later view's cached geometry. Failed requests can be retried. This is shared source-data loading within a page, not yet shared GPU geometry, cross-page regional tiling, or geographic placement of all interiors.

Fixed a specific building crosswalk gap: the source label `208동` was excluded by numeric-only matching. It now receives the official 3-floor, 11.52 m building height within the correct complex. The catalog also retains official height/level metadata and uses the same terrain correction as the renderer, including its provisional base-elevation source. Terrain elevation is not replaced by that building height. The Sinchon 209/210 geometry conflict is still unresolved: the supplied NGII review contains three polygons labelled 209동 while OSM has a combined-looking 210 outline. No nearest-building reassignment was made.

Validation: 98 unit tests passed, including cache isolation/retry and scoped dong-label normalization; target-flow browser samples passed at 1440 and 390 pixels. These checks do not establish accurate geographic placement of every window. Next required work is still the source-based plan registration, floor elevations, missing Xi interior traces, and shared window scene listed below. Hanshin Hanjin 205 follows completion of those tasks.

| Target | Official buildings | Households | Indexed actual units | Plan images linked | Indoor model route |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sinchon Prugio phase 2 | 10 | 426 | 426 | 426 | 426 |
| Gyeonghuigung Xi phase 2 | 14 | 1,148 | 1,148 | 1,133 | 106 |

The indoor model route is not a verified window position or a verified real-world view. Sinchon still has a separate fixed 206 comparison implementation. Xi still only models the 59A wings of 204/205 and the 84A wings of 211. The common catalog must not be mistaken for a complete 3D implementation.

## Paused Checkpoint: Source-Scoped Local Windows

`src/plan-traces/sinchon.js` now contains 17 manually traced source images and 130 glazed segments, including room-to-balcony glazing. These are raster-reading drafts, not a verified exhaustive window schedule or as-built measurements. Image bytes, dimensions, wall association and interior-side anchors are checked by `scripts/compile-plan-traces.mjs`; changed/missing sources withhold the model metadata. `src/plan-models.js` selects a trace by complex, source file and source hash instead of a bare type name. Three historical source-specific models remain for 24 historical unit links.

All 426 Sinchon target units resolve to a local model in the audit. Source plans and 3D glass support window selection, moving to a local camera 0.35 rendering meters inside the glass at 1.5 rendering meters eye height. Only the new 59D trace has a printed dimension chain for scale; the other new traces normalize their longest dimension to 10 rendering meters, explicitly not measured meters. Sill/head heights and mullions remain assumptions. The exterior of these local scenes is empty, not a final geographic outlook. Reflection and north-up geographic registration have not been added by this change.

Checkpoint verification: build succeeded; existing 95 unit tests passed; all 17 trace geometry/source checks attached without errors; the 426-unit audit exercised each registered local opening pose. A Playwright smoke check on 210-305 (34CT) at 1440/390 pixels clicked the source-plan living-room window, reached the matching local camera, found nonblank canvas pixels and no page errors/horizontal overflow. Screenshots are in `verification/trace-plan-*.png` and `verification/trace-window-*.png`. This is not browser coverage of all 426 units or all 130 new segments. `target-flow-browser.mjs` now explicitly opens the plan tab before selecting the 34CT window. The user subsequently requested this checkpoint and the shared-neighborhood TODO be committed and pushed; implementation expansion remains paused.

## TODO: One Shared Neighborhood, Many Window Cameras

Agreed architecture: build the surrounding world once for each geographic area, not once per home. Store household/window placement separately from the environment. Neighboring complexes can reference overlapping regional tiles instead of duplicating the same buildings, roads and terrain. This is a pending integration task, not a completed feature.

- [ ] Separate the shared environment (terrain, buildings, roads, imagery, vegetation and landmarks) from the selected home, floor and camera. Preserve source identities, coordinate reference, vertical datum and version on regional data.
- [ ] Remove target-house state from reusable environment snapshots. Resolve the selected building/unit independently; use one geographic transform for the indoor model, the north-up/reflected plan, facade openings and observer.
- [ ] Connect all supported local window models to that shared scene. Store plan-to-building placement and floor-base elevation, then compute each window camera's position, outward direction and eye height. Do not copy or rebuild the neighborhood per unit/window.
- [ ] Keep each building's irregular outline, stepped wings, terrain and floor exceptions. A floor change may change the unit geometry, not only the camera height. Missing placement evidence stays unknown rather than borrowing a neighboring unit's view.
- [ ] Share/cache regional geometry and imagery across nearby complexes. The current Sinchon and Xi scene files are separate snapshots; a common renderer alone is not a regional data-sharing pipeline.
- [ ] Verify same-region unit/window changes reuse the same environment resources and change only the required local interior/camera state. Test all 1,574 actual units, floor exceptions, window positions, occlusion and reflection before claiming the final flow is complete.

Current state: `OutlookScene` renders the same scene with two cameras for floor comparison. The supported Xi units reuse their complex scene; Sinchon outlook remains tied to the 206 comparison. New Sinchon local interior models are not separate neighborhood reconstructions and do not yet have the real surrounding environment attached.

## Official Unit Inventory

Source: https://www.data.go.kr/data/3073746/fileData.do

The downloaded 2025-01-01 housing-price CSV contains 15,580,435 rows. Its complete uncompressed SHA-256 was verified against the portal's published value:
`bbadcb0e85787f3db157b199a6b9df1601e995228a3976106ec5440c2cd8935c`.

The extractor streams the ZIP, selects exact road address, legal dong, and lot number, and retains unit identity, exclusive area, source row, and building-register linkage key. It does not retain housing prices or resident/owner information. The full ZIP is 151,192,872 bytes; the main CSV is 3,457,575,809 bytes and is never extracted to a giant local file.

Xi's 1,148 units agree with the independently retrieved building-register household counts in every one of the 14 buildings. Provider type matching requires a unique provider area ID under the source's two-decimal truncation convention, a matching whole-type household total, and no contradiction with available line-chart evidence. Area alone never selects among multiple subtype IDs. Original exact exclusive areas are preserved.

All 18 Xi area groups have matching provider household totals, including the combined 15 units at 84.9339 square meters. That group remains unresolved: provider 84F has 5 households and 84F1 has 10, but the per-unit subtype allocation is not yet evidenced. Actual units are 201/202/203 buildings' 302/402/502 and 204/205 buildings' 303/403/503. Do not assume floor 3 means F and floors 4/5 mean F1 without independent evidence.

Sinchon's public price inventory contains only 777 of the combined 940 households, including 382 of the target phase's 426. It corroborates 382 existing provider links without deleting the other 44. The earlier 17-unit provider gap is in phase 1 building 105, outside the target scope. Missing price rows are not proof of nonexistent homes.

## Official Building Details and Blueprints

Sources:
- https://www.hub.go.kr/portal/gis/bld/idx-bld-list.do
- https://www.hub.go.kr/portal/opn/tyb/idx-batch-flrpln.do

The public forms are used with their session, CSRF token, and observed request encodings. No login or CAPTCHA bypass is implemented. Blueprint lookup returned one 4800x3600 image for each target. The response's legacy `/api/fileDownload.do` URL is stale; the actual public viewer uses `/blcmapi/fileDownload.do`. The public viewer key is obtained from the form and is not persisted in the report.

Building heights and levels are applied only to the exact complex/site and dong identity. Public GIS coordinates are parcel centroids shared by many buildings and are deliberately not assigned as building centers. The blueprint provides useful site, footprint, wing-level and terrain annotations, but is not a complete set of per-floor interior/window schedules.

## Supplemental Plans

The 77A and 116A images were inspected in these source posts, which explicitly identify phase 2 and the type:
- https://w2althy.tistory.com/15598544
- https://w2althy.tistory.com/15598500

`plan-supplements.json` records original image URLs, hashes, and review notes. Original watermarks are retained. This is local research acquisition, not a claim of public redistribution permission. The plan's optional configuration and actual window sill/head heights remain unverified.

## Reproduction

```powershell
node scripts/download-housing-inventory.mjs
node scripts/extract-housing-inventory.mjs
node scripts/collect-target-buildings.mjs
node scripts/probe-target-blueprints.mjs
node scripts/download-plan-supplements.mjs
npm.cmd run build:linkage
npm.cmd run verify:targets
```

Existing KB snapshots and images must also be present (see README's address pipeline). Research downloads are Git-ignored. The national CSV download follows the portal's ordinary limit check and stops if a human CAPTCHA is requested. It does not retry through another identity.

## Remaining Work

1. Obtain the actual 84F/F1 subtype and plan differences for the remaining 15 Xi units.
2. Expand sourced interior/window traces to all target types, keeping identities scoped by complex. Xi 84A and Sinchon 84A are different plans.
3. Register source plan features to independent site features, including a holdout, so reflection is inferred from evidence rather than guessed from line number.
4. Georeference the official site outlines; add missing Sinchon 208/209 geometry and reconcile wing levels and floor base elevations. Overall building height does not establish floor elevation.
5. Route every unit through the common window scene, removing the remaining hardcoded 206 and Xi wing restrictions.
6. Enumerate actual units and every opening in end-to-end tests. Do not mark completion merely because address lookup or a sampled screenshot passes.

Current `verify:targets -- --require-complete` must still fail. `viewReady` and `verified` remain false because the full spatial registration and final flow have not been completed.
