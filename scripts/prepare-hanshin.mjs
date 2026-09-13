import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {localPoint,geographicPoint} from '../src/outlook-math.js';
import {terrainHeight,roadProfile} from '../src/road-data.js';
import {estimateFacade} from '../src/estimated-view.js';

const root='research/linkage/downloads/hanshin-hanjin',dir='research/hanshin-hanjin';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const original=await read('research/sinchon-prugio/outlook/scene.json');
const osmBytes=await readFile(`${root}/osm.json`),osm=JSON.parse(osmBytes);
const source205=osm.elements.find(e=>e.id===559970274);
if(source205?.tags.name!=='205동'||source205.tags['building:levels']!=='21'||source205.tags['building:flats']!=='84')throw new Error('Hanshin 205 OSM crosswalk changed');
const html=await readFile(`${root}/205-detail.html`,'utf8'),dom=load(html),basic=dom('table').first().text().replace(/\s+/g,' ');
if(!basic.includes('한진아파트(205동)')||!basic.includes('성북로4길 52')||!basic.includes('지상 21층')||!basic.includes('84세대'))throw new Error('Hanshin 205 registry identity mismatch');
const center=source205.geometry.slice(0,-1).reduce((s,p,_,a)=>[s[0]+p.lon/a.length,s[1]+p.lat/a.length],[0,0]);
const translate=p=>{const geo=geographicPoint(...p,original.center);return localPoint(geo.lon,geo.lat,center);};
const sample=(x,z)=>{const geo=geographicPoint(x,z,center),p=localPoint(geo.lon,geo.lat,original.center);
  if(p.some(v=>Math.abs(v)>original.terrain.extent))throw new Error('Hanshin DEM sampling outside acquired coverage');
  return terrainHeight(original.terrain,...p);
};
const terrain={size:321,extent:10000,heights:[],source:'Mapzen Terrarium DEM resampled from the existing regional grid; approximately 62.5m spacing'};
for(let row=0;row<terrain.size;row++)for(let col=0;col<terrain.size;col++)terrain.heights.push(sample(-terrain.extent+col*62.5,-terrain.extent+row*62.5));
const buildings=new Map(original.buildings.map(b=>[b.id,{...b,points:b.points.map(translate)}]));
const roads=new Map(original.roads.map(r=>[r.id,{...r,points:r.points.map(translate)}]));
for(const way of osm.elements){
  if(!way.geometry?.length||way.geometry.some(p=>!Number.isFinite(p.lon)||!Number.isFinite(p.lat)))continue;
  const points=way.geometry.map(p=>localPoint(p.lon,p.lat,center)),tags=way.tags;
  if(tags.building&&points.length>=4){
    const midpoint=points.slice(0,-1).reduce((s,p,_,a)=>[s[0]+p[0]/a.length,s[1]+p[1]/a.length],[0,0]);
    const levels=Number(tags['building:levels'])||null,height=Number.parseFloat(tags.height),target=way.id===source205.id;
    buildings.set(way.id,{id:way.id,name:tags.name??'',label:target?'한신한진아파트 205동':tags.name??`주변 건물 #${way.id}`,
      kind:tags.building,points,base:sample(...midpoint),baseSource:'mapzen-terrarium-dem',
      height:Number.isFinite(height)?height:levels?levels*2.9:15,levels,
      heightSource:Number.isFinite(height)?'osm-height':target?'official-levels-times-assumed-2.9':'levels-times-2.9',
      source:`https://www.openstreetmap.org/way/${way.id}`,siteSource:target?'https://kbland.kr/se/c/36331':null,
      nameSource:target?'osm-name-and-official-register-household-level-crosscheck':'osm-name',
      ...(target?{heightEvidence:'https://www.hub.go.kr/portal/gis/bld/idx-bld-detail.do',officialBuilding:{registryId:'100915676',building:'205',households:84,levels:21,height:null}}:{})});
  }else if(tags.highway)roads.set(way.id,{id:way.id,points,kind:tags.highway,name:tags.name??'',tags,profile:roadProfile(tags)});
}
const target=buildings.get(source205.id),window=estimateFacade({...target,center});
const scene={...original,center,targetBuildingId:target.id,targetLabel:'205동',terrain,window,previousWindow:{...window},
  buildings:[...buildings.values()],roads:[...roads.values()],greens:original.greens.map(g=>({...g,points:g.points.map(translate)})),
  landmarks:original.landmarks.map(l=>({...l,point:translate(l.point),...(l.points?{points:l.points.map(translate)}:{})})),
  source:{...original.source,buildings:'https://overpass.kumi.systems/api/interpreter',osmTimestamp:osm.osm3s.timestamp_osm_base,
    osmSha256:createHash('sha256').update(osmBytes).digest('hex'),notes:'Hanshin 205: exact OSM name, 21 levels and 84 flats corroborated by building register. Height assumes 2.9m per floor; terrain base is not surveyed FFL.'}};
await mkdir(dir,{recursive:true});
await writeFile(`${dir}/scene.json.tmp`,JSON.stringify(scene));await rename(`${dir}/scene.json.tmp`,`${dir}/scene.json`);
console.log(JSON.stringify({center,ground:target.base,height:target.height,levels:target.levels,buildings:scene.buildings.length,roads:scene.roads.length}));
