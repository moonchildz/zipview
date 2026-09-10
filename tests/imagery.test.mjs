import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {tilePoint,tileLocation,imageryGrid,groundUV} from '../src/imagery-coordinates.js';
import {localPoint} from '../src/outlook-math.js';
import {imageryMiddleware} from '../scripts/imagery-server.mjs';

const center = [126.9546759125,37.5611203];
test('imagery Mercator coordinates preserve north/south and scene scale', () => {
  const grid = imageryGrid(center);
  assert.equal(grid.count ** 2,36);
  for(const p of [center,[grid.west,grid.north],[grid.east,grid.south]]) {
    const back = tileLocation(...tilePoint(...p,18),18);
    assert.ok(back.every((v,i)=>Math.abs(v-p[i])<1e-10));
  }
  const nw = groundUV(...localPoint(grid.west,grid.north,center),center,grid);
  const se = groundUV(...localPoint(grid.east,grid.south,center),center,grid);
  assert.ok(Math.abs(nw[0])<1e-10 && Math.abs(nw[1]-1)<1e-10);
  assert.ok(Math.abs(se[0]-1)<1e-10 && Math.abs(se[1])<1e-10);
  assert.ok(groundUV(0,-20,center,grid)[1]>groundUV(0,20,center,grid)[1]);
});

async function withServer(options, work) {
  const middleware = imageryMiddleware({centers:{sinchon:center,xi:center},...options});
  const server=createServer((req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(path,headers={'X-Zipview-Imagery':'1'})=>fetch(base+path,{headers});
  try {await work(get);} finally {await new Promise(resolve=>server.close(resolve));}
}

test('proxy rejects missing keys, cross-site and out-of-range requests before provider access',async()=>{
  let calls=0;
  await withServer({key:'',request:()=>{calls++;}},async get=>{
    assert.equal((await get('/api/imagery/xi/metadata')).status,503);
    assert.equal((await get('/api/imagery/xi/metadata',{})).status,403);
    assert.equal((await get('/api/imagery/xi/metadata',{'X-Zipview-Imagery':'1','Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await get('/api/imagery/xi/tile/0/0')).status,400);
    assert.equal((await get('/api/imagery/xi/metadata?key=not-accepted')).status,400);
  });
  assert.equal(calls,0);
});

test('proxy keeps key and session private, uses copyright and bounds, and enforces request budget',async()=>{
  const paths=[];
  const request=async(url)=>{
    paths.push(url.pathname);
    assert.equal(url.searchParams.get('key'),'private-key');
    if(url.pathname.endsWith('createSession'))return Response.json({session:'private-session',expiry:String(Date.now()/1000+5000),tileWidth:256,tileHeight:256});
    if(url.pathname.endsWith('viewport'))return Response.json({copyright:'TEST ONLY',maxZoomRects:[{maxZoom:18,north:90,south:-90,east:180,west:-180}]});
    return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}});
  };
  await withServer({key:'private-key',request,limit:3},async get=>{
    const r=await get('/api/imagery/sinchon/metadata');
    assert.equal(r.headers.get('cache-control'),'no-store');
    const text=await r.text();assert.ok(!text.includes('private-'));
    const data=JSON.parse(text);assert.equal(data.copyright,'TEST ONLY');
    const path=`/api/imagery/sinchon/tile/${data.grid.left}/${data.grid.top}`;
    assert.equal((await get(path)).status,200);
    assert.equal((await get(path)).status,429);
  });
  assert.deepEqual(paths.slice(0,2),['/v1/createSession','/tile/v1/viewport']);
  assert.equal(paths.length,3);
});

test('provider errors are redacted and missing imagery attribution prevents tile display',async()=>{
  await withServer({key:'private-key',request:async()=>{throw new Error('url?key=private-key');}},async get=>{
    const r=await get('/api/imagery/xi/metadata');assert.equal(r.status,502);
    assert.ok(!(await r.text()).includes('private-key'));
  });
  await withServer({key:'key',request:async url=>Response.json(url.pathname.endsWith('createSession')
    ? {session:'session',expiry:String(Date.now()/1000+5000),tileWidth:256,tileHeight:256}
    : {maxZoomRects:[]})},async get=>{
    assert.equal((await get('/api/imagery/xi/metadata')).status,502);
    const grid=imageryGrid(center);
    assert.equal((await get(`/api/imagery/xi/tile/${grid.left}/${grid.top}`)).status,409);
  });
});

test('low resolution is explicit, bounded, and has independent viewport authorization',async()=>{
  const seen=[];
  const request=async url=>{
    seen.push(url.pathname);
    if(url.pathname.endsWith('createSession'))return Response.json({session:'session',expiry:String(Date.now()/1000+5000),tileWidth:256,tileHeight:256});
    if(url.pathname.endsWith('viewport'))return Response.json({copyright:'TEST',maxZoomRects:[{maxZoom:20,north:90,south:-90,east:180,west:-180}]});
    return new Response('{}',{status:404,headers:{'Content-Type':'application/json'}});
  };
  await withServer({key:'private-key',request},async get=>{
    const low=await(await get('/api/imagery/xi/metadata?zoom=15')).json();
    assert.equal(low.grid.zoom,15);assert.equal(low.grid.count,2);
    const high=imageryGrid(center);
    assert.equal((await get(`/api/imagery/xi/tile/${high.left}/${high.top}`)).status,409);
    const r=await get(`/api/imagery/xi/tile/${low.grid.left}/${low.grid.top}?zoom=15`);
    assert.equal(r.status,404);assert.ok((await r.json()).error.includes('키 인증 오류는 아닙니다'));
    assert.equal((await get('/api/imagery/xi/metadata?zoom=20')).status,400);
    assert.equal((await get('/api/imagery/xi/metadata?zoom=15&zoom=18')).status,400);
  });
  assert.equal(seen.filter(p=>p.includes('2dtiles')).length,1);
});
