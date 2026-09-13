import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {hubPublicSession} from './hub-public-client.mjs';
const dir='research/linkage/downloads/hanshin-hanjin';
await mkdir(dir,{recursive:true});
const save=async(name,value)=>{await writeFile(`${dir}/${name}.tmp`,value);await rename(`${dir}/${name}.tmp`,`${dir}/${name}`);};
if(!existsSync(`${dir}/205-detail.html`)){
  const session=await hubPublicSession('/portal/gis/bld/idx-bld-list.do');
  const html=await session.post('/portal/gis/bld/idx-bld-detail.do',{bldrgstSeqno:'100915676'},{json:true,html:true});
  if(!html.includes('한진아파트(205동)'))throw new Error('Hanshin registry identity changed');
  await save('205-detail.html',html);
}
if(!existsSync(`${dir}/osm.json`)){
  const query='[out:json][timeout:45];(way[building](37.589,127.002,37.603,127.019);way[highway](37.589,127.002,37.603,127.019);way[landuse=residential](37.589,127.002,37.603,127.019););out geom;';
  const r=await fetch('https://overpass.kumi.systems/api/interpreter',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',
    'User-Agent':'Zipview-Research/0.1 (https://github.com/moonchildz/zipview)'},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(55000)});
  if(!r.ok)throw new Error(`Hanshin OSM HTTP ${r.status}; saved sources preserved`);
  const data=await r.json();if(data.remark||!data.elements?.some(e=>e.id===559970274))throw new Error('Incomplete Hanshin OSM response');
  await save('osm.json',JSON.stringify(data));
}
const data=JSON.parse(await readFile(`${dir}/osm.json`,'utf8'));
console.log(`Hanshin sources ready: registry 205, ${data.elements.length} OSM features`);
