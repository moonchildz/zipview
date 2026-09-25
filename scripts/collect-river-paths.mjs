import fs from 'node:fs/promises';
import {roadProfile} from '../src/road-data.js';
const sites={yangjae:[127.051,37.481],han:[127.003,37.516]};
for(const [site,center] of Object.entries(sites)){
 const folder=`verification/${site}-grove`;await fs.mkdir(folder,{recursive:true});const file=folder+'/osm-raw.json';let raw;
 try{raw=JSON.parse(await fs.readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;
 const [lon,lat]=center,dx=.008,dy=.006;const query=`[out:json][timeout:25];way[highway](${lat-dy},${lon-dx},${lat+dy},${lon+dx});out geom;`;
 const r=await fetch('https://overpass-api.de/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`OSM HTTP ${r.status}`);raw=await r.json();if(raw.remark)throw Error(raw.remark);await fs.writeFile(file,JSON.stringify(raw));}
 const mx=111195*Math.cos(center[1]*Math.PI/180);
 const roads=raw.elements.filter(e=>e.type==='way'&&e.tags?.highway&&e.geometry?.length>1).map(e=>({id:e.id,kind:e.tags.highway,tags:e.tags,profile:roadProfile(e.tags),points:e.geometry.map(p=>[(p.lon-center[0])*mx,-(p.lat-center[1])*111195])}));
 await fs.writeFile(folder+'/osm-roads.json',JSON.stringify({center,roads,fetchedAt:new Date().toISOString(),source:'https://overpass-api.de/api/interpreter',attribution:'OpenStreetMap contributors / ODbL'}));console.log(site,roads.length);
}
