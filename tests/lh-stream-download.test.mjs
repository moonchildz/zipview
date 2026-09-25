import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {downloadFile,fileHash} from '../scripts/lh-stream-download.mjs';

test('interrupted transfer resumes with matching ETag and exact bytes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lh-stream-'));const body=Buffer.alloc(256000,37);const requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.headers.range);const start=Number(/bytes=(\d+)-/.exec(req.headers.range??'')?.[1]??0);
  res.writeHead(start?206:200,{'Content-Length':body.length-start,ETag:'"v1"',...(start?{'Content-Range':`bytes ${start}-${body.length-1}/${body.length}`}:{})});
  if(requests.length===1){res.write(body.subarray(0,64000));setTimeout(()=>res.destroy(),50);}else res.end(body.subarray(start));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const file=path.join(dir,'file.part');await downloadFile(`http://127.0.0.1:${server.address().port}/`,file);assert.deepEqual(await fs.readFile(file),body);assert.match(requests[1],/^bytes=[1-9]\d*-/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('server ignoring Range safely replaces partial bytes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lh-stream-'));const body=Buffer.from('%PDF-complete-new-file');
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':body.length,ETag:'"new"'});res.end(body);});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const url=`http://127.0.0.1:${server.address().port}/`,file=path.join(dir,'file.part');await fs.writeFile(file,'old partial');await fs.writeFile(file+'.json',JSON.stringify({url,etag:'"old"'}));const r=await downloadFile(url,file);assert.deepEqual(await fs.readFile(file),body);assert.equal(r.resumed,false);assert.equal(r.sha256,await fileHash(file));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

test('streams files larger than the old 150 MB limit',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lh-stream-'));const size=151000000,chunk=Buffer.alloc(1000000,42);
 const server=http.createServer(async(req,res)=>{res.writeHead(200,{'Content-Length':size});for(let i=0;i<151;i++)if(!res.write(chunk))await once(res,'drain');res.end();});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const file=path.join(dir,'large.part');const r=await downloadFile(`http://127.0.0.1:${server.address().port}/`,file);assert.equal(r.bytes,size);assert.equal((await fs.stat(file)).size,size);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
