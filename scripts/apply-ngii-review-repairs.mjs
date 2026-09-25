import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {metadataMatches,verifyZip,reconcileFiles} from './ngii-files.mjs';
import {atomicJson} from './atomic-json.mjs';

const root='.tools/national';
if(await fs.access(path.join(root,'run.lock')).then(()=>true,()=>false))throw Error('Collector must be idle');
const rows=JSON.parse(await fs.readFile(path.join(root,'review-audit.json'),'utf8'));
const reportPath='verification/ngii-review-repair/repair-report.json';
const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
const byNumber=new Map(report.map(r=>[r.number,r]));
const digest=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
// Validate the entire set before importing any file or changing a manifest.
const imports=[];
for(const s of rows){
 const r=byNumber.get(s.number);
 if(!r||!['repaired','metadata-only'].includes(r.status))throw Error('Unresolved repair: '+s.number);
 if(await digest(s.review.zip)!==r.sourceSha256)throw Error('Original changed: '+s.number);
 if(!metadataMatches(await fs.readFile(s.review.xml,'utf8'),s))throw Error('Metadata mismatch: '+s.number);
 const source=r.output||s.review.zip,sha256=await verifyZip(source);
 if(r.output&&sha256!==r.outputSha256)throw Error('Repaired file changed');
 imports.push({s,r,source,sha256});
}
for(const {s,source} of imports){
 for(const src of [source,s.review.xml]){
  const dest=path.join('mapinfo',path.basename(src));
  try{await fs.copyFile(src,dest,1);}
  catch(e){if(e.code!=='EEXIST'||await digest(src)!==await digest(dest))throw e;}
 }
}
const jobs=JSON.parse(await fs.readFile(path.join(root,'jobs.json'),'utf8'));
const keys=new Map(imports.map(x=>[x.s.key,x]));const cache=new Map();let changed=0;
for(const j of jobs.filter(j=>j.dataset==='maps')){
 const file=path.join(j.state,'manifest.json');
 const manifest=await fs.readFile(file,'utf8').then(JSON.parse,()=>null);if(!manifest)continue;
 const targets=manifest.sheets.filter(s=>keys.has(s.key));if(!targets.length)continue;
 await reconcileFiles(targets,'mapinfo',cache);
 for(const s of targets){
  if(s.status!=='verified')throw Error('Reverification failed: '+s.number);
  const {r}=keys.get(s.key);s.repair={report:reportPath,originalSha256:r.sourceSha256,kind:r.status,addedFiles:r.additions,epsg:r.epsg,maxErrorMeters:r.maxErrorMeters};
 }
 await atomicJson(file,manifest);changed+=targets.length;
 j.lastResult=manifest.sheets.every(s=>s.status==='verified')&&!j.rejectedCount?'files-verified':'needs-review';
}
await atomicJson(path.join(root,'jobs.json'),jobs);
console.log(JSON.stringify({uniqueVerified:imports.length,manifestEntriesUpdated:changed,repairedArchives:imports.filter(x=>x.r.status==='repaired').length}));
