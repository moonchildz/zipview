# Exact missing placement and elevation evidence

For both Xi2 and Sinchon2 the unit inventory, individual type images, site blueprints, official whole-building heights and local contour data are present. These answer different questions; they do not together specify every apartment's coordinate transform and floor datum.

## What is already implemented for Xi204

Do not describe this as an absence of all height data or an unimplemented height calculation. Xi204 already renders the interior, window and observer at calculated floor elevations:

- Ground reference:49.27736770844799m in `research/gyeonghuigung-xi/scene.json`, from the resampled Mapzen DEM. This is an estimated ground value, not an independently established1F finished-floor level.
- Whole-building height:65.05m,21 above-ground floors, from the acquired building-register record. `applyOfficialBuildingFacts` applies this height but deliberately retains the ground reference.
- Per-floor increment:2.9m by default, ground offset0m and eye height1.5m, in `src/outlook.js` and `src/xi-main.js`. These controls support a height calculation; they do not contain a measured per-floor schedule.
- For204-201 with defaults, floor elevation is52.17736770844799m and eye elevation53.67736770844799m. Interior and observer use the same formula. The59A wing's18-floor shell height is separately estimated by scaling the whole-building height by18/21.

The same calculation can be used provisionally for other buildings with explicit source/assumption status. What remains missing is independent confirmation of finished-floor datums and each floor's actual vertical increment, especially at podium/pilotis/storey transitions. Exact-height verification must not be conflated with having no usable height data or being unable to implement other buildings.

| Required evidence | Fields needed | What it resolves |
| --- | --- | --- |
| Floor-by-floor building plans (층별 평면도, 저층·기준층·최상층) | Dong/ho, boundaries, entrance, stair/elevator core, actual window openings, north/coordinate reference, revision | Each home's position, direction and reflection, including floor exceptions. This is also a prerequisite to finishing task1, which was previously understated. |
| Xi2 approved unit-type schedule (동호수별 주택형 일람표) | 84F versus84F1 for201/202/203-302/402/502 and204/205-303/403/503 | Fifteen same-area homes. Exclusive area84.9339㎡ and subtype totals5/10 do not identify which home belongs to which subtype. |
| Building sections / floor-level schedule (종·횡단면도, 층별 레벨표) | Each dong/wing's1F finished-floor elevation, per-floor finished-floor levels, pilotis/raised entries, basement-to-ground relationship | Absolute observer altitude. Whole-building height divided by floors does not establish these values. |
| Surveyed ground/finished levels (현황측량도·대지 종횡단면·레벨도) | Datum, spot/finished-ground elevations at buildings, retaining-wall top/bottom, cut/fill and terrace levels | Building-to-ground relation and terrain steps; contour interpolation smooths over retaining walls. Site blueprint spot numbers are not automatically1F finished floors. |
| Window/door schedule and detailed sections (창호일람표·창호상세도) | Opening ID matched to plan, sill and head above finished floor, balcony level differences and glazing limits | Actual eye-level aperture and visible obstruction. Floorplans show horizontal openings but normally lack these vertical dimensions. |
| Sinchon210 labelled as-built footprint | Closed georeferenced outer ring and structure/core membership | Independent verification of210's remaining OSM-derived eastern outline.209's NGII sheet seam and209/210 overlap have been resolved geometrically. |

The most direct next source is the project's approved/as-built drawing set (준공 설계도서), usually a package of floor plans, sections and schedules. No correspondence to owners, management offices or public bodies has been sent. The current application continues to identify all provisional vertical values and unregistered geographic placements as such.
