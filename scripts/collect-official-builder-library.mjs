import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {inspectShAsset} from './sh-asset-format.mjs';

const root='research/linkage/downloads/official-builders';
await fs.mkdir(root,{recursive:true});
const lock=`${root}/collector.lock`;
if(existsSync(lock)){const pid=Number(await fs.readFile(lock,'utf8'));try{process.kill(pid,0);throw Error(`Collector running: ${pid}`);}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(lock);}
await fs.writeFile(lock,String(process.pid),{flag:'wx'});
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=async(file,data)=>{
 await fs.writeFile(file+'.tmp',JSON.stringify(data,null,2)+'\n');
 for(let attempt=0;;attempt++){
  try{await fs.rename(file+'.tmp',file);return;}
  catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=9)throw e;await new Promise(r=>setTimeout(r,100*(attempt+1)));}
 }
};
const sources=JSON.parse(await fs.readFile('research/linkage/official-builder-sources.json','utf8'));
let last=0;
try{
 for(const source of sources){
  const dir=`${root}/${source.id}`;await fs.mkdir(dir,{recursive:true});
  const path=`${dir}/state.json`;
  const state=existsSync(path)?JSON.parse(await fs.readFile(path,'utf8')):{...source,queue:[],assets:[],pages:[],externalLinks:[],createdAt:new Date().toISOString()};
  function add(raw,parent,kind='page'){
   let u;try{u=new URL(raw,parent);}catch{return;}u.hash='';
   if(!['http:','https:'].includes(u.protocol))return;
   if(!u.href.startsWith(source.root)){if(!state.externalLinks.some(l=>l.url===u.href))state.externalLinks.push({url:u.href,parent});return;}
   if(/login|logout|register|customer|privacy|member|reservation/i.test(u.pathname))return;
   if(!state.queue.some(q=>q.url===u.href))state.queue.push({url:u.href,parent,kind,status:'pending'});
  }
  for(const url of source.seeds)add(url,source.root);
  state.status='running';state.stopReason=null;
  const persist=async()=>{state.updatedAt=new Date().toISOString();await save(path,state);};
  await persist();
  for(const q of state.queue){
   if(q.status==='done')continue;
   if(existsSync(`${root}/STOP`)){state.status='paused';state.stopReason='Stop requested';await persist();throw Error('Stop requested');}
   if(state.pages.length>=1000){state.status='paused';state.stopReason='Page review limit reached';break;}
   q.status='running';state.current=q.url;await persist();
   try{
    await new Promise(r=>setTimeout(r,Math.max(0,last+1000-Date.now())));last=Date.now();
    const response=await fetch(q.url,{signal:AbortSignal.timeout(120000),redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){add(response.headers.get('location'),q.url,q.kind);q.status='done';q.redirect=response.headers.get('location');await response.body?.cancel();continue;}
    if(!response.ok){await response.body?.cancel();throw Object.assign(Error(`HTTP ${response.status}`),{halt:[401,403,429].includes(response.status)});}
    const chunks=[];let length=0;for await(const b of response.body){length+=b.length;if(length>150_000_000)throw Error('Attachment exceeds 150 MB');chunks.push(b);}
    const bytes=Buffer.concat(chunks),sha256=hash(bytes);
    const html=/text\/html/i.test(response.headers.get('content-type')??'')||/^\s*(?:<!doctype html|<html)/i.test(bytes.subarray(0,200).toString());
    if(html){
     if(q.kind==='asset')throw Error('HTML returned instead of attachment');
     const file=`${dir}/page-${sha256}.html`;await fs.writeFile(file,bytes);
     const text=bytes.toString('utf8'),$=load(text);
     state.pages.push({url:q.url,file,sha256,title:$('title').text(),retrievedAt:new Date().toISOString()});
     const asset=/\.(?:pdf|dwg|dxf|zip|7z|rar|hwp|hwpx|xlsx?|docx?|png|jpe?g|gif|webp|tiff?|bmp|svg)(?:[?#]|$)/i;
     for(const a of $('a[href],iframe[src],img').toArray()){
      const el=$(a),raw=el.attr('href')??el.attr('data-src')??el.attr('src');
      if(!raw||/^(?:javascript:|#|mailto:|tel:)/i.test(raw))continue;
      add(raw,q.url,a.tagName==='img'||asset.test(raw)?'asset':'page');
     }
     // Literal links in inline scripts/styles are publicly supplied source URLs.
     for(const match of text.matchAll(/["']([^"'<>\s]+\.(?:pdf|dwg|dxf|zip|hwp|hwpx|png|jpe?g|webp|gif))(?:\?[^"'<>\s]*)?["']/gi))add(match[1],q.url,'asset');
    }else{
     const meta=await inspectShAsset(bytes,new URL(q.url).pathname),file=`${dir}/${sha256}.${meta.format}`;
     if(!existsSync(file))await fs.writeFile(file,bytes,{flag:'wx'});
     state.assets.push({url:q.url,parent:q.parent,file,sha256,bytes:bytes.length,...meta,retrievedAt:new Date().toISOString()});
    }
    q.status='done';delete q.error;
   }catch(e){q.status='failed';q.error=e.message;if(e.halt){state.status='paused';state.stopReason=e.message;await persist();throw e;}}
   await persist();console.log(JSON.stringify({source:source.id,pages:state.pages.length,assets:state.assets.length,queued:state.queue.length,current:q.url,status:q.status}));
  }
  if(state.status==='running')state.status=state.queue.some(q=>q.status==='failed')?'finished-with-errors':'finished';state.current=null;await persist();
 }
}finally{await fs.unlink(lock);}
