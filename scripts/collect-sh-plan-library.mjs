import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {inspectShAsset} from './sh-asset-format.mjs';

const {values:args}=parseArgs({options:{limit:{type:'string'},status:{type:'boolean'}}});
const root='research/linkage/downloads/portal-library/sh',statePath=`${root}/state.json`;
const hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(root,{recursive:true});
let state=existsSync(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):{version:1,source:'https://www.i-sh.co.kr/houseinfo/',targets:[],searches:[],createdAt:new Date().toISOString()};
const summary=()=>({status:state.status,updatedAt:state.updatedAt,targets:state.targets.length,completed:state.targets.filter(t=>t.status==='done').length,failed:state.targets.filter(t=>t.status==='failed').length,assets:state.targets.reduce((n,t)=>n+(t.assets??0),0),current:state.current,stopReason:state.stopReason});
if(args.status){console.log(JSON.stringify(summary(),null,2));process.exit(0);}
const limit=args.limit?Number(args.limit):Infinity;if(!(limit>0))throw Error('Invalid limit');
const lock=`${root}/collector.lock`;
if(existsSync(lock)){const pid=Number(await fs.readFile(lock,'utf8'));let live=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')live=false;else throw e;}if(live)throw Error(`Collector running: ${pid}`);await fs.unlink(lock);}
await fs.writeFile(lock,String(process.pid),{flag:'wx'});
const saveJSON=async(file,data)=>{await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');await fs.rename(file+'.tmp',file);};
const save=async()=>{state.updatedAt=new Date().toISOString();await saveJSON(statePath,state);await saveJSON(`${root}/summary.json`,summary());};
let browser,lastRequest=0,stopped=false;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
async function pace(){if(stopped||existsSync(`${root}/STOP`))throw Object.assign(Error('Stop requested'),{halt:true});const delay=lastRequest+1000-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,delay));lastRequest=Date.now();}
try{
 state.status='running';state.stopReason=null;await save();
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.goto(state.source,{timeout:45000});await page.waitForFunction(()=>typeof window.selectSrcList==='function');
 const html=await page.content();await fs.writeFile(`${root}/discovery.html`,html);
 async function request(url,form){
  await pace();const r=await page.request.fetch(url,{method:form?'POST':'GET',...(form?{form}:{}),timeout:45000});
  if(!r.ok()){const e=Object.assign(Error(`HTTP ${r.status()}: ${url}`),{halt:[401,403,429].includes(r.status())});await r.dispose();throw e;}
  const bytes=await r.body();await r.dispose();return bytes;
 }
 async function query(endpoint,params){
  const url=new URL(endpoint,'https://www.i-sh.co.kr/houseinfo/').href;
  const file=`${root}/query-${hash(url+JSON.stringify(params))}.json`;
  if(existsSync(file))return JSON.parse(await fs.readFile(file,'utf8')).data;
  const data=JSON.parse((await request(url,params)).toString('utf8'));await saveJSON(file,{source:url,params,retrievedAt:new Date().toISOString(),data});return data;
 }
 const add=(id,seed={})=>{if(/^\d+$/.test(id)&&!state.targets.some(t=>t.id===id))state.targets.push({id,status:'pending',...seed});};
 // Only IDs exposed in the public notice links; never enumerate guessed IDs.
 for(const m of html.matchAll(/selectHouseList\(1,'([\d,]+)'/g))for(const id of m[1].split(','))add(id,{discovery:'public-notice'});
 const keywords=['강남구','강동구','강북구','강서구','관악구','광진구','구로구','금천구','노원구','도봉구','동대문구','동작구','마포구','서대문구','서초구','성동구','성북구','송파구','양천구','영등포구','용산구','은평구','종로구','중구','중랑구','푸르지오','자이','래미안','힐스테이트','위례'];
 for(const keyword of keywords){
  if(state.searches.includes(keyword))continue;
  const response=await query('main/selectSearchList.do',{keyword});
  for(const list of Object.values(response))if(Array.isArray(list))for(const r of list)if(r.biznsCd)add(String(r.biznsCd),{name:r.nm,category:r.hsSe,discovery:keyword});
  state.searches.push(keyword);await save();
 }
 // Apartment-type records first; other publicly listed housing remains queued.
 state.targets.sort((a,b)=>(b.status==='failed')-(a.status==='failed')||(a.id.length>5)-(b.id.length>5)||a.id.localeCompare(b.id));await save();
 let processed=0;
 for(const t of state.targets){
  if(t.status==='done')continue;if(processed>=limit)break;
  state.current=t.id;t.status='running';await save();
  try{
   const detail=await query('map/selectHouseBscDetail.do',{biznsCd:t.id,ctgrCd:t.category??'10'});
   if(!detail.result?.biznsCd)throw Error('No public complex detail');
   const types=await query('map/selectSplyTyInfo.do',{biznsCd:t.id});
   const categories=await query('map/selectCmmCdList.do',{biznsCd:t.id,cateId:'SH0175'});
   const manifest={id:t.id,name:detail.result.biznsViewNm,address:detail.result.addr,source:page.url(),retrievedAt:new Date().toISOString(),detail:detail.result,types:types.result??[],categories:categories.result??[],assets:[],errors:[]};
   const requests=[...(types.result??[]).map(r=>({type:r.splyTy,kind:'type-plan',endpoint:'map/selectSplyTyImgInfo.do',params:{biznsCd:t.id,splyTy:r.splyTy}})),...(categories.result??[]).map(r=>({type:r.cd,kind:'category-image',endpoint:'map/selectImgList.do',params:{biznsCd:t.id,imgTy:r.cd}}))];
   for(const q of requests){
    try{
     const result=await query(q.endpoint,q.params);
     for(const entry of result.result??[]){
      try{
      const url=new URL('../'+entry.imgPath+entry.imgNewFileNm,page.url()).href;
      if(new URL(url).origin!=='https://www.i-sh.co.kr')throw Error('Unrecognized asset origin');
      const metaFile=`${root}/asset-${hash(url)}.json`;let asset;
      if(existsSync(metaFile)){asset=JSON.parse(await fs.readFile(metaFile,'utf8'));if(!existsSync(asset.file)||hash(await fs.readFile(asset.file))!==asset.sha256)asset=null;}
      if(!asset){const bytes=await request(url);const meta=await inspectShAsset(bytes,entry.imgNewFileNm);
       const sha256=hash(bytes),file=`${root}/${sha256}.${meta.format}`;if(!existsSync(file))await fs.writeFile(file,bytes,{flag:'wx'});asset={url,file,sha256,bytes:bytes.length,...meta,originalFileName:entry.imgNewFileNm,retrievedAt:new Date().toISOString()};await saveJSON(metaFile,asset);}
      manifest.assets.push({...asset,type:q.type,kind:q.kind,name:entry.imgNm});
      }catch(e){if(e.halt)throw e;manifest.errors.push({type:q.type,name:entry.imgNm,fileName:entry.imgNewFileNm,error:e.message});}
     }
    }catch(e){if(e.halt)throw e;manifest.errors.push({type:q.type,error:e.message});}
    await saveJSON(`${root}/complex-${t.id}.json`,manifest);
   }
   await saveJSON(`${root}/complex-${t.id}.json`,manifest);
   Object.assign(t,{name:manifest.name,address:manifest.address,types:manifest.types.length,assets:manifest.assets.length,status:manifest.errors.length?'failed':'done',errors:manifest.errors});
   console.log(JSON.stringify({id:t.id,name:t.name,types:t.types,assets:t.assets,status:t.status}));
  }catch(e){t.status='failed';t.error=e.message;if(e.halt)throw e;console.log(JSON.stringify({id:t.id,error:e.message}));}
  processed++;await save();
 }
 state.current=null;state.status=state.targets.some(t=>t.status!=='done')?'paused':'finished';await save();
}catch(e){state.status='paused';state.stopReason=e.message;await save();console.error(e.message);process.exitCode=1;}
finally{await browser?.close();await fs.unlink(lock);}
console.log(JSON.stringify(summary(),null,2));
