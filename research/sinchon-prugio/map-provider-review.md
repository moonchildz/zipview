# Google / Kakao feasibility check

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
