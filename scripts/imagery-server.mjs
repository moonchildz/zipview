import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { imageryGrid } from '../src/imagery-coordinates.js';

export function imageryMiddleware({key, centers, request = fetch, limit = 160}) {
  let session, pending, calls = 0;
  const readySites = new Set();
  const fail = (status, message) => Object.assign(new Error(message), {status});
  const upstream = async (path, options) => {
    if (++calls > limit) throw fail(429, '위성사진 요청 한도에 도달했습니다. 서버 관리자에게 확인해 주세요.');
    const url = new URL(`https://tile.googleapis.com${path}`);
    url.searchParams.set('key', key);
    const response = await request(url, {...options, signal: AbortSignal.timeout(15000)});
    if (response.status === 404 && path.startsWith('/v1/2dtiles/')) throw fail(404, 'Google에서 요청한 해상도의 사진 타일을 제공하지 않았습니다. 키 인증 오류는 아닙니다.');
    if (!response.ok) throw fail(502, `Google Map Tiles 응답 ${response.status}: API 활성화·키 제한·결제·쿼터를 확인해 주세요.`);
    return response;
  };
  const getSession = async () => {
    if (session && Number(session.expiry) > Date.now() / 1000 + 60) return session;
    pending ??= upstream('/v1/createSession', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({mapType:'satellite', language:'ko-KR', region:'KR'}),
    }).then(r => r.json()).then(data => {
      if (!data.session || ![256,512,1024].includes(data.tileWidth) || data.tileHeight !== data.tileWidth) throw fail(502, '위성사진 세션 응답을 확인하지 못했습니다.');
      session = data;
      readySites.clear();
      return data;
    }).finally(() => {pending = null;});
    return pending;
  };
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/imagery/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    const json = (status, data) => {res.statusCode = status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
    try {
      if (req.method !== 'GET' || req.headers['x-zipview-imagery'] !== '1' || req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, '허용되지 않은 요청입니다.');
      const match = /^\/api\/imagery\/(sinchon|xi)\/(metadata|tile\/\d+\/\d+)$/.exec(url.pathname);
      const zoom = url.searchParams.get('zoom') ?? '18';
      if (!match || !['15','18'].includes(zoom) || [...url.searchParams.keys()].some(k=>k!=='zoom') || url.searchParams.getAll('zoom').length > 1) throw fail(400, '허용된 단지와 타일 범위만 조회할 수 있습니다.');
      const [,site,action] = match, grid = imageryGrid(centers[site],Number(zoom),zoom==='15'?2:6);
      const viewportKey = `${site}:${zoom}`;
      const [,xText,yText] = action.split('/'), x = Number(xText), y = Number(yText);
      if (action !== 'metadata' && !(Number.isInteger(x) && Number.isInteger(y) && x >= grid.left && x < grid.left + grid.count && y >= grid.top && y < grid.top + grid.count)) throw fail(400, '타일이 조회 범위 밖입니다.');
      if (!key) throw fail(503, '.env.local의 GOOGLE_MAPS_API_KEY 설정과 Map Tiles API 활성화가 필요합니다.');
      const current = await getSession();
      const params = new URLSearchParams({session:current.session});
      if (action === 'metadata') {
        for (const k of ['zoom','north','south','east','west']) params.set(k, grid[k]);
        const metadata = await (await upstream(`/tile/v1/viewport?${params}`)).json();
        if (!metadata.copyright) throw fail(502, '위성사진 출처 정보를 받지 못했습니다.');
        if (!(metadata.maxZoomRects ?? []).some(r => r.maxZoom >= grid.zoom && r.north >= grid.north && r.south <= grid.south && r.east >= grid.east && r.west <= grid.west)) throw fail(422, `이 범위의 확대 수준 ${zoom} 위성사진 지원을 확인하지 못했습니다.`);
        readySites.add(viewportKey);
        json(200, {grid, tileSize:current.tileWidth, copyright:metadata.copyright});
      } else {
        if (!readySites.has(viewportKey)) throw fail(409, '출처와 지원 범위를 먼저 확인해야 합니다.');
        const response = await upstream(`/v1/2dtiles/${grid.zoom}/${x}/${y}?${params}`);
        const type = response.headers.get('content-type') ?? '';
        if (!/^image\/(jpeg|png)/.test(type)) throw fail(502, '위성사진 이미지 응답이 아닙니다.');
        res.setHeader('Content-Type',type);
        res.end(Buffer.from(await response.arrayBuffer()));
      }
    } catch (error) {
      // Never return upstream URLs/errors, which can contain the server credential.
      json(error.status ?? 502, {error:error.status ? error.message : '위성사진 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.'});
    }
  };
}

export function satellitePlugin() {
  let middleware;
  return {
    name:'google-satellite-preview',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, 'GOOGLE_');
      const centers = Object.fromEntries([['sinchon','research/sinchon-prugio/outlook/scene.json'],['xi','research/gyeonghuigung-xi/scene.json']]
        .map(([site,path]) => [site,JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url),'utf8')).center]));
      middleware = imageryMiddleware({key:process.env.GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY, centers});
    },
    configureServer(server) {server.middlewares.use(middleware);},
    configurePreviewServer(server) {server.middlewares.use(middleware);},
  };
}
