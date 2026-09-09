import {readFile,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
import {localPoint,geographicPoint,insideFootprint} from '../src/outlook-math.js';
import {terrainHeight,roadProfile} from '../src/road-data.js';

const dir='research/gyeonghuigung-xi';
const original=JSON.parse(await readFile('research/sinchon-prugio/outlook/scene.json','utf8'));
const xml=load(await readFile(`${dir}/osm.xml`,'utf8'),{xmlMode:true});
const nodes=new Map(xml('node').toArray().map(n=>[xml(n).attr('id'),{lon:+xml(n).attr('lon'),lat:+xml(n).attr('lat')}]));
const ways=xml('way').toArray().map(w=>({id:+xml(w).attr('id'),tags:Object.fromEntries(xml(w).find('tag').toArray().map(t=>[xml(t).attr('k'),xml(t).attr('v')])),geometry:xml(w).find('nd').toArray().map(n=>nodes.get(xml(n).attr('ref')))}));
const target=ways.find(w=>w.id===608374570);
const site=ways.find(w=>w.id===359124892);
if(!target||target.tags.name!=='204'||!site)throw new Error('204/site source missing');
const center=target.geometry.slice(0,-1).reduce((s,p,_,a)=>[s[0]+p.lon/a.length,s[1]+p.lat/a.length],[0,0]);
const shift=localPoint(...center,original.center);
const translate=p=>[p[0]-shift[0],p[1]-shift[1]];
const terrain={...original.terrain,heights:[]};
for(let row=0;row<terrain.size;row++)for(let col=0;col<terrain.size;col++){
  const x=-terrain.extent+col*2*terrain.extent/(terrain.size-1),z=-terrain.extent+row*2*terrain.extent/(terrain.size-1);
  terrain.heights.push(terrainHeight(original.terrain,x+shift[0],z+shift[1]));
}
terrain.source='Existing Mapzen DEM resampled around Xi; no NGII coverage at this site';
const buildings=new Map(original.buildings.map(b=>[b.id,{...b,points:b.points.map(translate)}]));
const roads=new Map(original.roads.map(r=>[r.id,{...r,points:r.points.map(translate)}]));
const sitePoints=site.geometry.map(p=>localPoint(p.lon,p.lat,center));
for(const w of ways){
  if(w.geometry.some(p=>!p)||w.geometry.length<2)continue;
  const points=w.geometry.map(p=>localPoint(p.lon,p.lat,center));
  if(w.tags.building&&points.length>=4){
    const c=points.slice(0,-1).reduce((s,p,_,a)=>[s[0]+p[0]/a.length,s[1]+p[1]/a.length],[0,0]);
    const height=Number.parseFloat(w.tags.height),levels=Number.parseFloat(w.tags['building:levels']);
    const inSite=points.filter(p=>insideFootprint(p,sitePoints)).length/points.length>.8;
    const name=w.tags.name??'';
    buildings.set(w.id,{id:w.id,name,kind:w.tags.building,points,base:terrainHeight(terrain,...c),height:Number.isFinite(height)?height:Number.isFinite(levels)?levels*2.9:15,levels:Number.isFinite(levels)?levels:null,heightSource:Number.isFinite(height)?'osm-height':Number.isFinite(levels)?'levels-times-2.9':'assumed',label:inSite&&/^\d+$/.test(name)?`경희궁자이2단지 ${name}동`:name||`이름 미확인 #${w.id}`,nameSource:inSite?'osm-name-and-site-containment':name?'osm-name':'missing',siteSource:inSite?'https://www.openstreetmap.org/way/359124892':null,source:`https://www.openstreetmap.org/way/${w.id}`});
  }else if(w.tags.highway)roads.set(w.id,{id:w.id,points,kind:w.tags.highway,name:w.tags.name??'',tags:w.tags,profile:roadProfile(w.tags)});
}
const b=buildings.get(target.id);
const siteCenter=sitePoints.reduce((s,p,_,a)=>[s[0]+p[0]/a.length,s[1]+p[1]/a.length],[0,0]);
const facades=[];
for(let i=0;i<b.points.length-1;i++){
  const a=b.points[i],c=b.points[i+1],dx=c[0]-a[0],dz=c[1]-a[1],length=Math.hypot(dx,dz);
  if(length<8)continue;
  let normal=[-dz/length,dx/length];const mid=[(a[0]+c[0])/2,(a[1]+c[1])/2];
  if(insideFootprint([mid[0]+normal[0],mid[1]+normal[1]],b.points))normal=normal.map(v=>-v);
  const point=[mid[0]+normal[0]*.8,mid[1]+normal[1]*.8];
  if(insideFootprint(point,b.points))continue;
  const bearing=(Math.atan2(normal[0],-normal[1])*180/Math.PI+360)%360;
  const score=(normal[0]*siteCenter[0]+normal[1]*siteCenter[1])/Math.hypot(...siteCenter);
  facades.push({edge:i,point,bearing,length,score,...geographicPoint(...point,center)});
}
facades.sort((a,b)=>b.score-a.score||b.length-a.length);
const chosen=facades[0];
const output={...original,center,targetBuildingId:target.id,targetLabel:'204동',terrain,buildings:[...buildings.values()],roads:[...roads.values()],greens:original.greens.map(g=>({...g,points:g.points.map(translate)})),landmarks:original.landmarks.map(l=>({...l,point:translate(l.point),...(l.points?{points:l.points.map(translate)}:{})})),window:{lon:chosen.lon,lat:chosen.lat,bearing:chosen.bearing,status:'Courtyard-facing facade candidate calculated from OSM geometry; NOT verified as unit 201 window'},previousWindow:{lon:chosen.lon,lat:chosen.lat,bearing:chosen.bearing},facadeCandidates:facades,unit:{building:'204',unit:'201',floor:2,type:null,windowVerified:false},source:{...original.source,buildings:'https://www.openstreetmap.org/api/0.6/map?bbox=126.961,37.568,126.968,37.574',notes:'New OSM snapshot merged with earlier surrounding geometry; NGII mapinfo does not cover Xi'}};
await writeFile(`${dir}/scene.json`,JSON.stringify(output));
console.log(JSON.stringify({center,target:{id:b.id,height:b.height,levels:b.levels,base:b.base},chosen,buildings:output.buildings.length,roads:output.roads.length}));
