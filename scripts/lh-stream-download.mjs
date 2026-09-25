import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';

export async function fileHash(file){const h=createHash('sha256');for await(const b of createReadStream(file))h.update(b);return h.digest('hex');}

// Partial bytes remain on disk. Resume only with a strong validator and matching range.
export async function downloadFile(url,file,{beforeRequest=async()=>{},attempts=3,idleMs=45000}={}){
 const metadata=file+'.json';
 for(let attempt=0;attempt<attempts;attempt++){
  let timer;
  try{
   await beforeRequest();
   let size=0,prior;try{size=(await fs.stat(file)).size;prior=JSON.parse(await fs.readFile(metadata,'utf8'));}catch{}
   const resume=size>0&&prior?.url===url&&prior?.etag&&!prior.etag.startsWith('W/');
   const controller=new AbortController();
   const tick=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(Error('Transfer idle timeout')),idleMs);};tick();
   const r=await fetch(url,{redirect:'error',signal:controller.signal,headers:{'Accept-Encoding':'identity',...(resume?{Range:`bytes=${size}-`,'If-Range':prior.etag}:{})}});
   if(!r.ok){await r.body?.cancel();if(r.status===416){await fs.rm(metadata,{force:true});throw Error('Range rejected; restart required');}throw Object.assign(Error(`HTTP ${r.status}`),{halt:[401,403,429].includes(r.status),permanent:[400,404,410].includes(r.status)});}
   let append=false,total;
   if(r.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('content-range')??'');
    if(!resume||!range||Number(range[1])!==size||r.headers.get('etag')!==prior.etag){await r.body?.cancel();await fs.rm(metadata,{force:true});throw Error('Invalid resume response');}
    append=true;total=Number(range[3]);
   }else{size=0;total=r.headers.has('content-length')?Number(r.headers.get('content-length')):undefined;}
   if(r.headers.get('content-encoding')&&r.headers.get('content-encoding')!=='identity'){await r.body?.cancel();throw Error('Unexpected compressed transfer');}
   if(/text\/html/i.test(r.headers.get('content-type')??'')){await r.body?.cancel();throw Object.assign(Error('HTML returned instead of attachment'),{permanent:true});}
   // Truncate before publishing a new validator, so stale bytes cannot match it.
   if(!append)await fs.writeFile(file,Buffer.alloc(0));
   await fs.writeFile(metadata,JSON.stringify({url,etag:r.headers.get('etag'),total}));
   await pipeline(Readable.fromWeb(r.body),new Transform({transform(chunk,enc,cb){tick();cb(null,chunk);}}),createWriteStream(file,{flags:'a'}),{signal:controller.signal});
   const actual=(await fs.stat(file)).size;if(!actual||(total!==undefined&&actual!==total))throw Error(`Incomplete transfer: ${actual}/${total}`);
   return {bytes:actual,sha256:await fileHash(file),resumed:append};
  }catch(e){if(e.halt||e.permanent||attempt===attempts-1)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
  finally{clearTimeout(timer);}
 }
}
