# Two Target Complexes

Updated 2026-09-11. User requested a pause and status report. Work is incomplete; do not resume expansion until requested.

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
