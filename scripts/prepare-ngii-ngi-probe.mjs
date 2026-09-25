import fs from 'node:fs/promises';
import path from 'node:path';
import {normalizeSheet} from './ngii-files.mjs';
import {atomicJson} from './atomic-json.mjs';

const jobs=JSON.parse(await fs.readFile('.tools/national/jobs.json','utf8'));
let selected;
for(const job of jobs.filter(j=>j.dataset==='maps'&&j.region==='gyeonggi'&&j.scale===1000)){
 const file=path.join(job.state,'source-review.json');
 let entries;try{entries=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
 for(const entry of entries.filter(e=>e.item?.fileExt==='ngi')){
  try{selected={job,sheet:normalizeSheet(entry.item,job.district,1000)};break;}catch{/* Malformed catalogue rows stay in source-review.json. */}
 }
 if(selected)break;
}
if(!selected)throw Error('No valid Gyeonggi 1:1000 NGI source record for a transfer probe');
const original=JSON.parse(await fs.readFile(path.join(selected.job.state,'manifest.json'),'utf8'));
const state=path.resolve('.tools/national/raw-ngi/probe-'+selected.job.district);
await atomicJson(path.join(state,'manifest.json'),{schemaVersion:1,source:original.source,product:original.product,
 scale:1000,districts:original.districts,sheets:[selected.sheet],inventoryCheckedAt:new Date().toISOString()});
console.log(JSON.stringify({state,district:selected.job.district,number:selected.sheet.number,sourceFormat:'ngi'}));
