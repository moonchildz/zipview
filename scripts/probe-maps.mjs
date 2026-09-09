import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const defaultQuery = '\uC11C\uC6B8\uD2B9\uBCC4\uC2DC \uC11C\uB300\uBB38\uAD6C \uBD81\uC544\uD604\uB3D9 \uC2E0\uCD0C\uD478\uB974\uC9C0\uC624 2\uB2E8\uC9C0 210\uB3D9';

export function buildRequest(provider, query, key) {
  if (!['google', 'kakao'].includes(provider)) throw new Error('Provider must be google or kakao.');
  if (!query?.trim()) throw new Error('Query must not be empty.');
  if (!key?.trim()) throw new Error(`Missing ${provider === 'google' ? 'GOOGLE_MAPS_API_KEY' : 'KAKAO_REST_API_KEY'}; no request sent.`);
  if (provider === 'google') return {
    url: 'https://geocode.googleapis.com/v4/geocode/destinations',
    options: {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'destinations.primary,destinations.containingPlaces'},
      body: JSON.stringify({addressQuery: {addressQuery: query}, languageCode: 'ko'}),
    },
  };
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.search = new URLSearchParams({query, size: '5', page: '1'});
  return {url: url.href, options: {headers: {Authorization: `KakaoAK ${key}`}}};
}

// Presence is a capability check, not proof that a polygon is the requested dong.
export function summarize(provider, data) {
  if (provider === 'google') {
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        (data.destinations !== undefined && !Array.isArray(data.destinations))) {
      throw new Error('Unexpected Google response shape.');
    }
    const destinations = data.destinations ?? [];
    return {
      attribution: 'Google Maps',
      destinationCount: destinations.length,
      candidates: destinations.flatMap(d => [
        ...(d.primary ? [{relation: 'primary', place: d.primary}] : []),
        ...(d.containingPlaces ?? []).map(place => ({relation: 'containing', place})),
      ]).map(({relation, place}) => ({
        relation,
        name: place.displayName?.text ?? null,
        address: place.formattedAddress ?? null,
        structureType: place.structureType ?? null,
        hasDisplayPolygon: ['Polygon', 'MultiPolygon'].includes(place.displayPolygon?.type)
          && Array.isArray(place.displayPolygon.coordinates) && place.displayPolygon.coordinates.length > 0,
        identityVerified: false,
      })),
      heightStatus: 'not_verified', groundElevationStatus: 'not_verified',
    };
  }
  if (!Array.isArray(data?.documents)) throw new Error('Unexpected Kakao response shape.');
  return {
    attribution: 'Kakao Maps',
    totalCount: data.meta?.total_count ?? null,
    candidates: data.documents.map(place => ({
      name: place.place_name ?? null,
      address: place.road_address_name || place.address_name || null,
      hasCoordinates: place.x !== undefined && place.y !== undefined
        && String(place.x).trim() !== '' && String(place.y).trim() !== ''
        && Number.isFinite(Number(place.x)) && Number.isFinite(Number(place.y)),
      identityVerified: false,
    })),
    footprintStatus: 'not_provided_by_keyword_endpoint',
    heightStatus: 'not_provided_by_keyword_endpoint',
    groundElevationStatus: 'not_provided_by_keyword_endpoint',
  };
}

export async function probe(provider, query, key, request = fetch) {
  const {url, options} = buildRequest(provider, query, key);
  const response = await request(url, {...options, signal: AbortSignal.timeout(15000)});
  // Do not echo provider errors or request headers: they may contain credentials.
  if (!response.ok) throw new Error(`${provider}: HTTP ${response.status}. Check credentials, API activation, restrictions and quota. No retry sent.`);
  return summarize(provider, await response.json());
}

async function main() {
  try { loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const {values} = parseArgs({options: {
    provider: {type: 'string', default: 'google'},
    query: {type: 'string', default: defaultQuery},
    help: {type: 'boolean'},
  }});
  if (values.help) {
    console.log('npm run probe:maps -- --provider google|kakao --query "address or building name"\nOne request per run; no retries, disk cache, or scene changes. Set keys in .env.local.');
    return;
  }
  const key = process.env[values.provider === 'google' ? 'GOOGLE_MAPS_API_KEY' : 'KAKAO_REST_API_KEY'];
  const result = await probe(values.provider, values.query, key);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const keys = [process.env.GOOGLE_MAPS_API_KEY, process.env.KAKAO_REST_API_KEY].filter(Boolean);
    let message = error.message;
    for (const key of keys) message = message.replaceAll(key, '[redacted]');
    console.error(message);
    process.exitCode = 1;
  });
}
