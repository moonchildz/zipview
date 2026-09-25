import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {load} from 'cheerio';
import {inspectShAsset} from './sh-asset-format.mjs';
import {downloadFile,fileHash} from './lh-stream-download.mjs';
const {values:args}=parseArgs({options:{limit:{type:'string'},'discover-only':{type:'boolean'},'queued-only':{type:'boolean'},'all-attachments':{type:'boolean'},'first-year':{type:'string',default:'2000'},status:{type:'boolean'}}});
const root='research/linkage/downloads/portal-library/lh',statePath=`${root}/state.json`,origin='https://apply.lh.or.kr';
await fs.mkdir(root,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const state=existsSync(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):{version:1,targets:[],lists:[],createdAt:new Date().toISOString()};
const summary=()=>({status:state.status,updatedAt:state.updatedAt,targets:state.targets.length,completed:state.targets.filter(t=>t.status==='done').length,failed:state.targets.filter(t=>t.status==='failed').length,assets:state.targets.reduce((n,t)=>n+(t.assets??0),0),current:state.current,stopReason:state.stopReason});
if(args.status){console.log(JSON.stringify(summary(),null,2));process.exit(0);}
const limit=Number(args.limit??Infinity),firstYear=Number(args['first-year']),year=new Date().getFullYear();
if(!(limit>0)||!Number.isInteger(firstYear)||firstYear<2000||firstYear>year)throw Error('Invalid options');
const lock=`${root}/collector.lock`;
if(existsSync(lock)){let live=true;const pid=Number(await fs.readFile(lock,'utf8'));try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')live=false;else throw e;}if(live)throw Error(`Collector running: ${pid}`);await fs.unlink(lock);}
await fs.writeFile(lock,String(process.pid),{flag:'wx'});
const saveJSON=async(file,value)=>{await fs.writeFile(file+'.tmp',JSON.stringify(value,null,2)+'\n');for(let i=0;;i++){try{await fs.rename(file+'.tmp',file);break;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||i>=9)throw e;await new Promise(r=>setTimeout(r,100*(i+1)));}}};
const save=async()=>{state.updatedAt=new Date().toISOString();await saveJSON(statePath,state);await saveJSON(`${root}/summary.json`,summary());};
let last=0,stopped=false,processed=0;process.on('SIGINT',()=>stopped=true);process.on('SIGTERM',()=>stopped=true);
let requestGate=Promise.resolve();
function pace(){const next=requestGate.then(async()=>{if(stopped||existsSync(`${root}/STOP`))throw Object.assign(Error('Stop requested'),{halt:true});await new Promise(r=>setTimeout(r,Math.max(0,last+1000-Date.now())));if(stopped)throw Object.assign(Error('Stop requested'),{halt:true});last=Date.now();});requestGate=next.catch(()=>{});return next;}
async function get(url){
 if(stopped||existsSync(`${root}/STOP`))throw Object.assign(Error('Stop requested'),{halt:true});
 if(new URL(url).origin!==origin)throw Error('Unexpected origin');
 await pace();
 const r=await fetch(url,{signal:AbortSignal.timeout(300000),redirect:'error'});
 if(!r.ok)throw Object.assign(Error(`HTTP ${r.status}: ${url}`),{halt:[401,403,429].includes(r.status)});
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>150_000_000)throw Error('Asset exceeds 150 MB');chunks.push(chunk);}return Buffer.concat(chunks);
}
async function cachedPage(url){const file=`${root}/page-${hash(url)}.html`;if(existsSync(file))return await fs.readFile(file,'utf8');const b=await get(url);await fs.writeFile(file,b);return b.toString('utf8');}
async function collect(t){
 if((t.status==='done'&&(!args['all-attachments']||t.allAttachments))||processed>=limit)return;
 state.current=t.id;t.status='running';await save();
 try{
  const html=await cachedPage(t.url),$=load(html);
  const manifest={...t,retrievedAt:new Date().toISOString(),assets:[],errors:[],links:[]};
  const jobs=[],seenFiles=new Set();
  for(const a of $('a').toArray()){
   const label=$(a).text().trim(),href=$(a).attr('href')??'',id=href.match(/fileDownLoad\(['"](\d+)['"]\)/i)?.[1];
   if(!id)continue;
   manifest.links.push({fileId:id,label});
   if(!args['all-attachments']&&!/평면|팸플|팜플|동호|배치|주택목록|주택내역|공급주택|브로슈어|도면|설계|dwg|dxf/i.test(label))continue;
   if(seenFiles.has(id))continue;seenFiles.add(id);jobs.push({id,label});
  }
  let cursor=0,fatal;
  async function worker(){while(cursor<jobs.length&&!fatal){const {id,label}=jobs[cursor++];
   try{
    const url=`${origin}/lhapply/lhFile.do?fileid=${id}`,metaFile=`${root}/asset-${id}.json`;let asset;
    if(existsSync(metaFile)){asset=JSON.parse(await fs.readFile(metaFile,'utf8'));if(!existsSync(asset.file)||await fileHash(asset.file)!==asset.sha256)asset=null;}
    if(!asset){const partial=`${root}/partial-${id}.part`,result=await downloadFile(url,partial,{beforeRequest:pace});
     const handle=await fs.open(partial,'r');const head=Buffer.alloc(Math.min(65536,result.bytes));try{await handle.read(head,0,head.length,0);}finally{await handle.close();}
     const meta=await inspectShAsset(head,label.trim());
     // Only a prefix is inspected; never report a full image decode from it.
     if(meta.verification==='image-decoded')meta.verification='header-only';
     const sha256=result.sha256,file=`${root}/${sha256}.${meta.format}`;
     if(!existsSync(file))await fs.rename(partial,file);else await fs.unlink(partial);
     await fs.rm(partial+'.json',{force:true});
     asset={fileId:id,url,file,sha256,bytes:result.bytes,...meta,resumed:result.resumed,originalFileName:label,retrievedAt:new Date().toISOString()};await saveJSON(metaFile,asset);
    }
    manifest.assets.push({...asset,label});
   }catch(e){manifest.errors.push({fileId:id,label,error:e.message});if(e.halt){fatal=e;stopped=true;}}
  }}
  await Promise.all([worker(),worker(),worker()]);
  await saveJSON(`${root}/notice-${t.id}.json`,manifest);
  if(fatal)throw fatal;
  t.assets=manifest.assets.length;t.status=manifest.errors.length?'failed':'done';t.errors=manifest.errors;t.allAttachments=Boolean(args['all-attachments']);
  console.log(JSON.stringify({id:t.id,name:t.name,assets:t.assets,status:t.status}));
 }catch(e){t.status='failed';t.error=e.message;if(e.halt)throw e;}
 processed++;await save();
}
try{
 state.status='running';state.stopReason=null;await save();
 // Preserve geographic order, but do not let old failed transfers block new notices.
 if(!args['discover-only'])for(const t of [...state.targets.filter(t=>t.status!=='failed'),...state.targets.filter(t=>t.status==='failed')])await collect(t);
 let regions=[];
 if(!args['queued-only']){
  const initial=load(await cachedPage(`${origin}/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1026`));
  regions=initial('#cnpCd option').map((i,e)=>initial(e).attr('value')).get().filter(Boolean);
  if(!regions.includes('11')||!regions.includes('41'))throw Error('Public region selector missing Seoul/Gyeonggi');
  regions=['11','41',...regions.filter(r=>!['11','41'].includes(r))];state.regions=regions;await save();
 }
 outer:for(const cnpCd of regions)for(let y=year;y>=firstYear;y--)for(const family of ['rental','sale']){
  const seen=new Set();
  for(let currPage=1;currPage<=1000;currPage++){
   if(processed>=limit)break outer;
   const key=`${cnpCd}:${y}:${currPage}${family==='sale'?':sale':''}`,previous=state.lists.find(l=>l.key===key);
   if(previous?.paginationVersion===2){if(previous.fingerprint)seen.add(previous.fingerprint);if(previous.last)break;continue;}
   const url=new URL('/lhapply/apply/wt/wrtanc/selectWrtancList.do',origin);
   url.search=new URLSearchParams({mi:family==='sale'?'1027':'1026',srchUppAisTpCd:family==='sale'?'053954':'061339',uppAisTpCd:family==='sale'?'05':'06',cnpCd,panSs:'',schTy:'0',startDt:`${y}-01-01`,endDt:`${y}-12-31`,listCo:'50',prevListCo:'50',currPage:String(currPage),srchY:'N'});
   const $=load(await cachedPage(url.href)),rows=$('.wrtancInfoBtn').toArray();
   const actualPage=$('form[name=pagingForm] input[name=currPage]').val();
   const lastPage=Number(/goPaging\((\d+)\)/.exec($('.pgeR2').attr('onclick')??'')?.[1]);
   const fingerprint=rows.map(e=>$(e).attr('data-id1')).join(',');
   // A full final page may be returned again when requesting beyond the end.
   // Accept only an explicit last-page control and an already recorded identical list.
   if(rows.length&&Number(actualPage)===currPage-1&&lastPage===Number(actualPage)&&seen.has(fingerprint)){
    const finalKey=`${cnpCd}:${y}:${actualPage}${family==='sale'?':sale':''}`;
    const finalRecord=state.lists.find(l=>l.key===finalKey);
    if(!finalRecord||finalRecord.fingerprint!==fingerprint)throw Error('Final-page evidence mismatch');
    finalRecord.last=true;finalRecord.lastPageEvidence={requested:currPage,returned:Number(actualPage),lastPage};await save();break;
   }
   if(rows.length&&String(actualPage)!==String(currPage))throw Error(`Unexpected page ${actualPage}; requested ${currPage}`);
   if(rows.length&&seen.has(fingerprint))throw Error(`Pagination repeated: ${key}`);seen.add(fingerprint);
   for(const e of rows){const a=$(e),panId=a.attr('data-id1'),ccr=a.attr('data-id2');if(!/^\d+$/.test(panId??''))continue;
    const id=`${ccr}-${panId}`;if(state.targets.some(t=>t.id===id))continue;
    const detail=new URL('/lhapply/apply/wt/wrtanc/selectWrtancInfo.do',origin);detail.search=new URLSearchParams({mi:'1026',panId,ccrCnntSysDsCd:ccr,uppAisTpCd:a.attr('data-id3'),aisTpCd:a.attr('data-id4')});
    state.targets.push({id,name:a.text().replace(/\s+/g,' ').trim(),region:cnpCd,year:y,url:detail.href,status:'pending'});
   }
   const isLast=rows.length<50||lastPage===currPage;
   const listing={key,url:url.href,count:rows.length,last:isLast,paginationVersion:2,fingerprint};
   if(previous)Object.assign(previous,listing);else state.lists.push(listing);state.discoveryCurrent={region:cnpCd,year:y,family,page:currPage};await save();
   if(!args['discover-only'])for(const t of state.targets)await collect(t);
   if(isLast)break;
   if(currPage===1000)throw Error(`Page limit reached: ${key}`);
  }
 }
 if(args['discover-only'])state.discoveryCompletedAt=new Date().toISOString();
 state.status=args['discover-only']?'discovered':processed>=limit?'paused':state.targets.some(t=>t.status==='failed')?'finished-with-errors':'finished';state.current=null;await save();
}catch(e){state.status='paused';state.stopReason=e.message;await save();console.error(e.message);process.exitCode=1;}
finally{await fs.unlink(lock);}
console.log(JSON.stringify(summary(),null,2));
