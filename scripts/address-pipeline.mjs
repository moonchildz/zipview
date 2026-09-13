import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {extractPublicComplex,parseSearch,parseDongList,parseHoList} from './kb-public-source.mjs';
import {normalizeAddress} from '../src/unit-linkage.js';
import {splitAddressInput} from '../src/address-input.js';
import {atomicJson} from './atomic-json.mjs';
import sharp from 'sharp';
export {splitAddressInput} from '../src/address-input.js';

const ROOT='research/linkage',CACHE=`${ROOT}/cache`,PROVIDERS=`${ROOT}/providers/kb`;
const hash=s=>createHash('sha256').update(s).digest('hex');
const saveJSON=atomicJson;
export const canonicalRoadAddress=value=>normalizeAddress(String(value??'').replace(/\s*\([^()]*\)\s*$/,''));
export function chooseCandidate(query,search){
  const q=normalizeAddress(query),matches=search.candidates.filter(c=>[c.name,c.address,c.landAddress].some(v=>normalizeAddress(v)===q));
  if(matches.length===1&&search.total<=search.candidates.length)return matches[0];
  // A unique provider search hit is still a candidate; the UI reports this matching basis.
  return search.total===1&&search.candidates.length===1?search.candidates[0]:null;
}
export function createAddressPipeline({fetchImpl=fetch,refresh=false,maxRequests=90,cacheRoot=CACHE,providerRoot=PROVIDERS,
  imageRoot=`${ROOT}/downloads/kb`,minIntervalMs=0,shouldStop=()=>false,onProgress=()=>{}}={}){
  let requests=0,cacheHits=0,lastRequest=0,halt=null;
  const pending=new Map();
  async function download(url,{image=false}={}){
    if(halt)throw halt;
    if(shouldStop())throw Object.assign(new Error('수집 중지 요청; 저장된 자료에서 재개할 수 있습니다.'),{code:'COLLECTION_STOPPED'});
    const u=new URL(url);if(!['https://api.kbland.kr','https://kbland.kr','https://file.kbland.kr'].includes(u.origin))throw new Error('Unsupported source URL');
    const key=hash(url),file=`${cacheRoot}/${key}.bin`,meta=`${cacheRoot}/${key}.json`;
    if(!refresh&&existsSync(file)&&existsSync(meta)){
      const m=JSON.parse(await readFile(meta,'utf8'));
      if(Date.now()-Date.parse(m.fetchedAt)<(image?30:7)*86400000){const b=await readFile(file);if(hash(b)===m.sha256){cacheHits++;return b;}}
    }
    if(requests>=maxRequests)throw (halt=Object.assign(new Error('이번 실행의 외부 요청 상한에 도달했습니다. 캐시를 유지하고 다음 실행에서 이어갑니다.'),{code:'REQUEST_BUDGET'}));
    const delay=lastRequest+minIntervalMs-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));
    if(shouldStop())throw Object.assign(new Error('수집 중지 요청'),{code:'COLLECTION_STOPPED'});
    requests++;
    lastRequest=Date.now();
    const r=await fetchImpl(url,{signal:AbortSignal.timeout(20000),redirect:'error',headers:{'User-Agent':'Zipview-Address-Pipeline/0.1 (https://github.com/moonchildz/zipview)'}});
    if(!r.ok) {
      const error=Object.assign(new Error(`Source HTTP ${r.status}; automatic retries disabled`),{status:r.status});
      if([403,429].includes(r.status))halt=Object.assign(error,{code:'PROVIDER_BLOCKED'});
      throw error;
    }
    const limit=image?5_000_000:12_000_000,chunks=[];let size=0;
    for await(const chunk of r.body){size+=chunk.length;if(size>limit)throw new Error('Source exceeds download size limit');chunks.push(chunk);}
    const b=Buffer.concat(chunks);
    if(image&&!(b[0]===255&&b[1]===216||b.subarray(1,4).toString()==='PNG'||b.subarray(0,4).toString()==='RIFF'))throw new Error('Not a supported raster image');
    await mkdir(cacheRoot,{recursive:true});await writeFile(file+'.tmp',b);await rename(file+'.tmp',file);
    await saveJSON(meta,{url,fetchedAt:new Date().toISOString(),sha256:hash(b),bytes:b.length});return b;
  }
  async function api(path,params){const u=new URL(`https://api.kbland.kr/${path}`);u.search=new URLSearchParams(params);return JSON.parse((await download(u.href)).toString('utf8'));}
  async function collectComplex(id,{expectedAddress}={}){
    if(!/^\d+$/.test(id))throw new Error('Invalid provider ID');
    if(pending.has(id))return pending.get(id);
    const work=(async()=>{
      onProgress({stage:'complex',providerId:id});
      const html=(await download(`https://kbland.kr/se/c/${id}`)).toString('utf8');
      const result=extractPublicComplex(html,id);result.errors=[];result.buildings=[];result.units=[];
      if(expectedAddress&&canonicalRoadAddress(result.address)!==canonicalRoadAddress(expectedAddress))
        throw Object.assign(new Error('공급자 상세 주소가 수집 대상 주소와 다릅니다.'),{code:'ADDRESS_MISMATCH'});
      for(const p of result.plans)for(const v of p.variants){
        try{
          const bytes=await download(v.url,{image:true}),ext=bytes[0]===255?'jpg':bytes.subarray(0,4).toString()==='RIFF'?'webp':'png';
          const raster=sharp(bytes,{limitInputPixels:40000000});
          const metadata=await raster.metadata();await raster.stats();
          v.file=`${imageRoot}/${id}/${p.areaId}-${v.variant}.${ext}`;
          await mkdir(resolve(v.file,'..'),{recursive:true});await writeFile(v.file,bytes);v.sha256=hash(bytes);
          v.width=metadata.width;v.height=metadata.height;
        }catch(e){if(e.code)throw e;result.errors.push({stage:'plan-image',areaId:p.areaId,variant:v.variant,reason:e.message});}
      }
      try{
        result.buildings=parseDongList(await api('land-complex/complexComm/dongList',{'단지기본일련번호':id}));
        for(const dong of result.buildings){
          try{result.units.push(...parseHoList(await api('land-extra/myHouse/dongHoList',{'단지기본일련번호':id,'동일련번호':dong.providerDongId}),dong,new Set(result.plans.map(p=>p.areaId))));}
          catch(e){if(e.code)throw e;result.errors.push({stage:'unit-chart',building:dong.building,reason:e.message});}
        }
      }catch(e){if(e.code)throw e;result.errors.push({stage:'dong-chart',reason:e.message});}
      result.linkStatus=result.units.some(u=>u.areaId)?'provider-units-linked':'plans-only';
      result.imageCount=result.plans.flatMap(p=>p.variants).filter(v=>v.file).length;
      if(!result.imageCount){result.errors.push({stage:'plan-images',reason:'공개 평형 정보는 있지만 내려받을 수 있는 평면도 이미지가 없습니다.'});if(result.linkStatus==='plans-only')result.linkStatus='types-only';}
      if(!result.buildings.length)result.errors.push({stage:'unit-chart',reason:'공개 공급자가 동호수 연결표를 반환하지 않았습니다. 평면도만 확보했습니다.'});
      result.parserVersion=1;result.collectedAt=new Date().toISOString();
      await saveJSON(`${providerRoot}/${id}.json`,result);
      return result;
    })();pending.set(id,work);try{return await work;}catch(e){pending.delete(id);throw e;}
  }
  async function run(input,{providerId,strictAddress=false}={}){
    const request=splitAddressInput(input);let candidate,search;
    if(providerId){if(!/^\d+$/.test(providerId))throw new Error('Invalid provider ID');candidate={providerId};}
    else{
      onProgress({stage:'search',address:request.address});
      search=parseSearch(await api('land-complex/serch/intgraSerch',{'검색설정명':'SRC_HSCM','검색키워드':request.address,'출력갯수':'20','페이지설정값':'1'}));
      candidate=chooseCandidate(request.address,search);
      if(strictAddress) {
        const exact=search.candidates.filter(c=>canonicalRoadAddress(c.address)===canonicalRoadAddress(request.address));
        candidate=exact.length===1&&search.total<=search.candidates.length?exact[0]:null;
      }
    }
    if(!candidate)return {request,status:search.total?'ambiguous-address':'address-not-found',candidates:search.candidates,total:search.total,requests,cacheHits};
    const complex=await collectComplex(candidate.providerId,strictAddress?{expectedAddress:request.address}:{});
    const exact=[complex.name,complex.address,complex.landAddress].some(s=>normalizeAddress(s)===normalizeAddress(request.address));
    return {request,status:complex.linkStatus,matchBasis:providerId?'selected-provider-id':exact?'exact-name-or-address':'unique-provider-search-candidate',complex,requests,cacheHits};
  }
  return {run,stats:()=>({requests,cacheHits})};
}
export async function runAddressBatch(addresses,options={}){
  const pipeline=createAddressPipeline(options),results=[];
  for(const address of addresses){try{const r=await pipeline.run(address);results.push(r);console.log(JSON.stringify({address,status:r.status,complex:r.complex?.name,types:r.complex?.plans.length,images:r.complex?.plans.flatMap(p=>p.variants).filter(v=>v.file).length,units:r.complex?.units.length}));}catch(e){results.push({request:{address},status:'failed',reason:e.message});}}
  const report={ranAt:new Date().toISOString(),...pipeline.stats(),results};await saveJSON(`${ROOT}/generated/address-run.json`,report);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const {values,positionals}=parseArgs({allowPositionals:true,options:{file:{type:'string'},refresh:{type:'boolean'},'max-requests':{type:'string'}}});
    const addresses=values.file?JSON.parse(await readFile(values.file,'utf8')):positionals;
    if(!Array.isArray(addresses)||!addresses.length||!addresses.every(a=>typeof a==='string'))throw new Error('주소 인수 또는 --file addresses.json (문자열 배열)이 필요합니다.');
    const maxRequests=Number(values['max-requests']??90);if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>200)throw new Error('max-requests must be 1..200');
    const r=await runAddressBatch(addresses,{refresh:values.refresh,maxRequests});
    console.log(JSON.stringify({requests:r.requests,cacheHits:r.cacheHits,failed:r.results.filter(r=>r.status==='failed').length}));
    if(r.results.some(r=>r.status==='failed'))process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
