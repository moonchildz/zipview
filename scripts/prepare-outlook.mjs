import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { facadeView, geographicPoint } from '../src/outlook-math.js';
import { landmarkData } from './landmark-data.mjs';
import { roadProfile } from '../src/road-data.js';
import { attachBuildingNames } from './building-names.mjs';

const dir = 'research/sinchon-prugio/outlook';
await mkdir(`${dir}/terrain`, { recursive: true });
const center = [126.9546759125, 37.5611203];
const rad = Math.PI / 180;
const metersLat = 111195, metersLon = metersLat * Math.cos(center[1] * rad);
const local = p => [(p.lon - center[0]) * metersLon, (center[1] - p.lat) * metersLat];
const raw = JSON.parse(await readFile(`${dir}/osm.json`, 'utf8'));
const target = raw.elements.find(e => e.id === 777716407);
if (!target || target.tags.name !== '206') throw new Error('Target building missing');
const tiles = new Map();
const z = 12, n = 2 ** z;
function tilePoint(lon, lat) { return [(lon + 180) / 360 * n * 256, (1 - Math.asinh(Math.tan(lat * rad)) / Math.PI) / 2 * n * 256]; }
async function tile(x, y) {
  const key = `${x}-${y}`;
  if (tiles.has(key)) return tiles.get(key);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const file = `${dir}/terrain/${z}-${key}.png`;
  let buffer;
  try { buffer = await readFile(file); }
  catch {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Terrain ${res.status}: ${url}`);
    buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(file, buffer);
  }
  const image = PNG.sync.read(buffer);
  tiles.set(key, image);
  console.log(`Terrain ${key}: ${buffer.length} bytes`);
  return image;
}
const extent = 16000, size = 513;
const [minX, minY] = tilePoint(center[0] - extent / metersLon, center[1] + extent / metersLat);
const [maxX, maxY] = tilePoint(center[0] + extent / metersLon, center[1] - extent / metersLat);
for (let x = Math.floor(minX / 256); x <= Math.floor(maxX / 256); x++) for (let y = Math.floor(minY / 256); y <= Math.floor(maxY / 256); y++) await tile(x, y);
function heightAt(lon, lat) {
  const [px, py] = tilePoint(lon, lat);
  const x = Math.floor(px), y = Math.floor(py);
  const sample = (sx, sy) => {
    const image = tiles.get(`${Math.floor(sx / 256)}-${Math.floor(sy / 256)}`);
    if (!image) throw new Error('Missing terrain tile');
    const i = ((sy % 256) * 256 + sx % 256) * 4;
    return image.data[i] * 256 + image.data[i + 1] + image.data[i + 2] / 256 - 32768;
  };
  const fx = px - x, fy = py - y;
  return (sample(x,y) * (1-fx) + sample(x+1,y)*fx)*(1-fy) + (sample(x,y+1)*(1-fx)+sample(x+1,y+1)*fx)*fy;
}
const heights = [];
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) heights.push(+heightAt(center[0]+(-extent+x*extent*2/(size-1))/metersLon,center[1]-(-extent+y*extent*2/(size-1))/metersLat).toFixed(2));
const buildings = [], roads = [], greens = [];
for (const e of raw.elements) {
  const points = e.geometry.map(local);
  const centerGeo = e.geometry.reduce((s,p) => [s[0]+p.lon/e.geometry.length,s[1]+p.lat/e.geometry.length],[0,0]);
  const base = heightAt(...centerGeo);
  if (e.tags.building && points.length >= 4) {
    const measured = Number.parseFloat(e.tags.height);
    const levels = Number.parseFloat(e.tags['building:levels']);
    const height = Number.isFinite(measured) ? measured : Number.isFinite(levels) ? levels * 2.9 : e.tags.building === 'apartments' ? 15 : e.tags.building === 'school' ? 15 : 9;
    buildings.push({ id:e.id,name:e.tags.name??'',kind:e.tags.building,points,base:+base.toFixed(2),height,heightSource:Number.isFinite(measured)?'osm-height':Number.isFinite(levels)?'levels-times-2.9':'assumed',levels:Number.isFinite(levels)?levels:null });
  } else if(e.tags.highway) roads.push({id:e.id,points,kind:e.tags.highway,name:e.tags.name??'',tags:e.tags,profile:roadProfile(e.tags)});
  else if(e.tags.leisure==='park'||e.tags.landuse==='forest'||e.tags.landuse==='grass') greens.push({points});
}
const revisedView = facadeView(buildings.find(b => b.id === target.id).points);
await attachBuildingNames(buildings, local);
const landmarks = await landmarkData(local, heightAt);
const output = {
  center, fetchedAt:raw.fetchedAt, targetBuildingId:target.id,
  window:{...geographicPoint(...revisedView.point, center),bearing:revisedView.bearing,status:'site-plan-reviewed southeast candidate; window not surveyed',facadeEdge:9,clearance:0.8},
  previousWindow:{lon:126.954844,lat:37.561200,bearing:78,status:'rejected east-facing assumption'},
  assumption:{floorHeight:2.9,firstFloorOffset:0,eyeHeight:1.5,roadWidths:'OSM width where available; otherwise lane/class assumptions',facades:'photo-informed palette; procedural window layout, not surveyed'},
  terrain:{size,extent,heights,source:'Mapzen / Tilezen terrain tiles on AWS; Terrarium z12; not surveyed'},
  buildings,roads,greens,landmarks,
  source:{buildings:raw.source,terrain:'https://registry.opendata.aws/terrain-tiles/',osmLicense:'https://www.openstreetmap.org/copyright',terrainLicense:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'},
};
await writeFile(`${dir}/scene.json`,JSON.stringify(output));
console.log(JSON.stringify({buildings:buildings.length,landmarks:landmarks.length,terrainSamples:heights.length,minElevation:heights.reduce((a,b)=>Math.min(a,b),Infinity),maxElevation:heights.reduce((a,b)=>Math.max(a,b),-Infinity)},null,2));
