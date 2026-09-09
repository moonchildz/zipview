# Google / Kakao feasibility check

## Authenticated follow-up — 2026-09-10

- Used the user-provided local Google key without printing it or adding it to source control. Authentication succeeded (HTTP 200).
- Name queries for Sinchon Prugio complex 2 buildings 210, 206 and 209 each resolved to the same complex-level POINT, with no display polygon. The 206/209 requests also requested subDestinations; neither returned any.
- Location queries at the current OSM model's 210 and 206 footprint vertex means, filtered to BUILDING, both returned HTTP 200 with zero destinations. These are model-derived query points, not surveyed building locations.
- Six requests were sent in this follow-up: an initial shell-encoding-affected query (not usable evidence), three correctly encoded name queries, and two building-filtered location queries. No retries or bulk lookup were run.
- These tested queries supplied no individually identified building geometry suitable for correcting location or footprint size. This does not establish that all Google query methods or all nearby buildings lack geometry.
- The documented Geocoding PlaceView schema has no building-height field. Ground elevation is a separate quantity and must not be used as building height.
- Existing model inspection: Sinchon Prugio 210 (OSM way 902872238) has an assumed 15 m height and no level count; 206 (way 777716407) has OSM height 50 m and 17 levels. Neither was independently verified in this follow-up.
- No provider geometry was saved and scene.json was not changed. Correcting these buildings now requires an independently verified footprint/dong mapping and building height or floor-count source, such as official building records and plans. Do not shift individual buildings to the shared complex POI.

The original unauthenticated check below is retained as historical context.

Checked: 2026-09-09. This is a capability/authentication check, not verified building data.

## Actual attempts

- Google Maps public search URL: web tool failed with Internal Error; browser tool returned "No browser is available". No satellite imagery was visually inspected in this check.
- Workspace root had no .env file and relevant Google/Kakao key environment-variable names were absent before setup.
- Google Geocoding v4 SearchDestinations: one unauthenticated POST for Seoul, Seodaemun-gu, Bukahyeon-dong, Sinchon Prugio complex 2, building 210. HTTP 403, PERMISSION_DENIED; API consumer identity required.
- Kakao Local keyword endpoint: one unauthenticated GET for Sinchon Prugio complex 2, building 210. HTTP 401, AccessDeniedError; KakaoAK authorization header required.
- These responses do NOT establish that either provider lacks data for the apartment. Authenticated building queries remain untested.
- No new building geometry or elevation was acquired. Existing scene.json is unchanged.

## Google

- [SearchDestinations](https://developers.google.com/maps/documentation/geocoding/search-for-destinations) can return a primary place and containing places, with structureType and displayPolygon. An apartment-complex match or an outline is not proof of a particular dong's identity.
- [Coverage table](https://developers.google.com/maps/coverage) does not list South Korea as supported for 3D Map Tiles / Maps JavaScript 3D. It explicitly does not describe the consumer Google Maps app's feature availability. The exact neighborhood's 3D tiles were not tested.
- [Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) restrict caching/storage and specify attribution. Obtaining a response is not blanket permission to persist it as a replacement geometry database or combine it with a non-Google map. Review applicable terms before any production integration.
- The diagnostic below displays only names, addresses, structure types and polygon-presence flags in the terminal with Google Maps attribution. It does not persist responses, export geometry or modify the Three.js scene.
- Building height and first-floor ground elevation remain unverified even when a displayPolygon exists.

## Kakao

- [Local REST API](https://developers.kakao.com/docs/ko/local/dev-guide) supports address/coordinate conversion and place searches. The documented address and keyword result fields do not include building footprint polygons, building height or ground elevation.
- [Web SDK guide](https://apis.map.kakao.com/web/guide/) supports map and Roadview integration with a registered JavaScript key/domain. Public map/Roadview links can be constructed without embedding the SDK.
- [Roadview altitude documentation](https://apis.map.kakao.com/web/documentation/#Marker_setAltitude) describes a marker overlay height, NOT a real building/terrain elevation or the ability to move a panorama camera to an apartment floor. It assumes an approximately 1.7m viewing height and does not account for shooting-site elevation/tilt.
- [Quota documentation](https://developers.kakao.com/docs/ko/getting-started/quota): free Web SDK quota 300,000/day; address conversion and keyword search each 100,000/day, subject to aggregate monthly quota and the first-activated-app rule. Additional quota has separate charges. These are not unlimited free services.
- No authenticated Kakao query or local Roadview availability check has succeeded yet. Kakao is a candidate for street-level visual comparison, not a confirmed 3D geometry replacement.

## Local diagnostic

The ignored `.env.local` is prepared with blank GOOGLE_MAPS_API_KEY and KAKAO_REST_API_KEY entries. Populate locally, not in chat or source code. Enable the relevant provider API and configure suitable key restrictions/quotas. Kakao's REST key is distinct from its JavaScript key. Never use VITE_ prefixes for these server/CLI credentials.

With Node on PATH, run:

```powershell
npm.cmd run probe:maps -- --provider google --query "서울특별시 서대문구 북아현동 신촌푸르지오 2단지 210동"
npm.cmd run probe:maps -- --provider kakao --query "신촌푸르지오 2단지 210동"
```

Each invocation sends at most ONE request, with no retry, pagination or automatic fallback. Requests with valid keys may consume quota or incur charges. Query 206/209 separately after inspecting 210. Empty results, authentication errors and polygon absence are separate outcomes. Names are not automatically matched to the OSM dong labels.

Next gate: authenticated Google response -> verify individual dong identity and polygon availability -> review allowed display/use -> only then plan integration. If Google is insufficient, test Kakao place search and Roadview as a separate reference path. Neither provider's documented features alone establish the site's retaining-wall or ground-level differences.
