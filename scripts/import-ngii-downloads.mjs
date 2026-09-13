import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseArgs} from 'node:util';
import {importNgiiInbox} from './ngii-inbox.mjs';

const {values:args}=parseArgs({options:{
  watch:{type:'boolean'},inbox:{type:'string',default:path.join(os.homedir(),'Downloads')},
  output:{type:'string',default:'mapinfo'},state:{type:'string',default:'.tools/ngii-downloads'}
}});
const manifestPath=path.resolve(args.state,'manifest.json');
const output=path.resolve(args.output),cache=new Map();
await fs.mkdir(output,{recursive:true});
let stopped=false,lastSummary='';
process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
console.log(`NGII 다운로드 폴더 감시: ${path.resolve(args.inbox)}\\down_* → ${output}`);
do {
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(manifest.schemaVersion!==1||manifest.product!=='수치지도2.0'||manifest.scale!==1000)throw new Error('지원하지 않는 수집 상태');
  const result=await importNgiiInbox({sheets:manifest.sheets,inbox:args.inbox,output,cache});
  if(result.imported.length)console.log(`ZIP/XML ${result.imported.length}쌍 검증 및 복사 완료 (${[...new Set(result.imported.map(x=>x.folder))].join(', ')})`);
  const counts=Object.fromEntries(['verified','requested','pending'].map(status=>[status,manifest.sheets.filter(s=>s.status===status).length]));
  const summary=JSON.stringify(counts);
  if(summary!==lastSummary){console.log(summary);lastSummary=summary;}
  if(!counts.pending&&!counts.requested)break;
  if(args.watch&&!stopped)await new Promise(resolve=>setTimeout(resolve,5000));
} while(args.watch&&!stopped);
