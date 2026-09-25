import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeSheet} from './ngii-files.mjs';
import {atomicJson} from './atomic-json.mjs';

const jobs=JSON.parse(await fs.readFile('.tools/national/jobs.json','utf8'))
 .filter(j=>j.dataset==='maps'&&j.region==='gyeonggi'&&j.scale===1000);
if(jobs.length!==44)throw Error(`Expected 44 Gyeonggi 1:1000 district jobs, found ${jobs.length}`);
const state=path.resolve('.tools/national/raw-ngi/gyeonggi');
const existing=await fs.readFile(path.join(state,'manifest.json'),'utf8').then(JSON.parse).catch(error=>{
 if(error.code==='ENOENT')return null;throw error;
});
const old=new Map((existing?.sheets??[]).map(s=>[s.key,s]));
const byNumber=new Map(),rejected=[];
const districts=[];
let sourceRecords=0,template;
for(const job of jobs){
 const folder=path.resolve(job.state),reviewPath=path.join(folder,'source-review.json');
 template??=await fs.readFile(path.join(folder,'manifest.json'),'utf8').then(JSON.parse).catch(error=>{
  if(error.code==='ENOENT')return null;throw error;
 });
 const reviews=await fs.readFile(reviewPath,'utf8').then(JSON.parse).catch(error=>{
  if(error.code==='ENOENT')return [];throw error;
 });
 const source=await fs.readFile(path.join('.tools/national/inventory',job.district+'.json'),'utf8').then(JSON.parse);
 districts.push({code:job.district,name:source.area?.name??job.district,region:'gyeonggi'});
 for(const entry of reviews.filter(e=>e.item?.fileExt==='ngi')){
  sourceRecords++;
  let sheet;try{sheet=normalizeSheet(entry.item,job.district,1000);}catch(error){
   rejected.push({district:job.district,item:entry.item,reason:error.message});continue;
  }
  sheet.sourceFormat='ngi';
  const prior=byNumber.get(sheet.number);
  if(prior){
   if(prior.key!==sheet.key){rejected.push({district:job.district,item:entry.item,reason:'Conflicting editions for one map number'});continue;}
   prior.districts=[...new Set([...prior.districts,job.district])];
  }else byNumber.set(sheet.number,sheet);
 }
}
if(!template||byNumber.size<1000)throw Error('Gyeonggi NGI catalogue is incomplete');
const sheets=[...byNumber.values()].sort((a,b)=>a.number.localeCompare(b.number)).map(sheet=>{
 const prior=old.get(sheet.key);return prior?{...sheet,status:prior.status,...(prior.file?{file:prior.file}:{}),...(prior.review?{review:prior.review}:{})}:sheet;
});
await atomicJson(path.join(state,'manifest.json'),{schemaVersion:1,source:template.source,product:template.product,
 scale:1000,sourceFormat:'ngi',districts,sheets,inventoryCheckedAt:new Date().toISOString()});
await atomicJson(path.join(state,'catalogue-review.json'),{sourceRecords,uniqueSheets:sheets.length,invalidRecords:rejected.length,records:rejected});
console.log(JSON.stringify({state,districts:districts.length,sourceRecords,uniqueSheets:sheets.length,invalidRecords:rejected.length}));
