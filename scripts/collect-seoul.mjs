import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';

export const RAW='research/seoul/raw';
export const SOURCES={
  apartments:{file:'apartments.json',url:'https://datafile.seoul.go.kr/bigfile/iot/sheet/json/download.do',
    method:'POST',body:new URLSearchParams({srvType:'S',infId:'OA-15818',serviceKind:'0',pageNo:'1',ssUserId:'SAMPLE_VIEW',strWhere:'',strOrderby:'SN ASC'}).toString(),
    license:'KOGL-1 (Seoul OA-15818)',maxBytes:20_000_000},
  osm:{file:'osm.json',url:'https://overpass-api.de/api/interpreter',method:'POST',
    body:new URLSearchParams({data:'[out:json][timeout:180];area["ISO3166-2"="KR-11"]["admin_level"="4"]->.a;(way["building"](area.a);relation["building"](area.a);way["building:part"](area.a);way["highway"](area.a);relation["ISO3166-2"="KR-11"]["admin_level"="4"];);out geom;'}).toString(),
    license:'ODbL-1.0 / OpenStreetMap contributors',maxBytes:300_000_000},
  'daebang-site':{file:'daebang-site.png',url:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457653',license:'reference-only; redistribution not cleared',maxBytes:5_000_000},
  'daebang-units':{file:'daebang-units.png',url:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457654',license:'reference-only; redistribution not cleared',maxBytes:5_000_000},
  'daebang-plan':{file:'daebang-55ah.png',url:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457871',license:'reference-only; redistribution not cleared',maxBytes:5_000_000},
};
export function validateDownload(key,buffer,{allowPartial=false}={}){
  if(key==='apartments'){
    const d=JSON.parse(buffer.toString('utf8'));if(!Array.isArray(d.DATA)||!d.DESCRIPTION?.APT_CD||d.DATA.length<1)throw new Error('Invalid full apartment export');
  }else if(key==='osm'){
    const d=JSON.parse(buffer.toString('utf8'));
    if((d.remark&&!allowPartial)||!d.osm3s?.timestamp_osm_base||!Array.isArray(d.elements)||!d.elements.some(e=>e.tags?.['ISO3166-2']==='KR-11'))throw new Error('Incomplete or wrong-area OSM response');
    return {queryComplete:!d.remark,providerRemark:d.remark??null};
  }else PNG.sync.read(buffer);
}
export async function saveDownload(key,buffer,metadata={}){
  const source=SOURCES[key];if(!source||buffer.length>source.maxBytes)throw new Error('Unknown/oversized source');
  const validation=validateDownload(key,buffer,{allowPartial:metadata.allowPartial===true});await mkdir(RAW,{recursive:true});
  const path=`${RAW}/${source.file}`;
  await writeFile(path+'.tmp',buffer);await rename(path+'.tmp',path);
  const record={key,url:source.url,method:source.method??'GET',requestBody:source.body??null,license:source.license,
    acquiredAt:new Date().toISOString(),bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),...metadata,...validation};
  await writeFile(path+'.meta.json',JSON.stringify(record,null,2));return record;
}
export async function collect(key){
  const s=SOURCES[key];if(!s)throw new Error('Choose: '+Object.keys(SOURCES).join(', '));
  const response=await fetch(s.url,{method:s.method??'GET',body:s.body,
    headers:{'User-Agent':'Zipview-Seoul-Research/0.1 (https://github.com/moonchildz/zipview)',...(s.body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},signal:AbortSignal.timeout(240000)});
  if(!response.ok)throw new Error(`Download failed: HTTP ${response.status}; no automatic retry`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>s.maxBytes)throw new Error('Download size cap exceeded');chunks.push(chunk);}
  return saveDownload(key,Buffer.concat(chunks),{lastModified:response.headers.get('last-modified')});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [key,importPath,option]=process.argv.slice(2);
  try{
    if(option&&option!=='--allow-partial')throw new Error('Unknown import option');
    console.log(JSON.stringify(importPath?await saveDownload(key,await readFile(importPath),{importedFrom:importPath,allowPartial:option==='--allow-partial'}):await collect(key),null,2));
  }
  catch(e){console.error(e.message);process.exitCode=1;}
}
