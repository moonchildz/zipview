import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createAddressPipeline} from './address-pipeline.mjs';
import {atomicJson} from './atomic-json.mjs';
import {apartmentInventory,collectionResult,apartmentSummary} from './seoul-apartment-queue.mjs';

const {values:args}=parseArgs({options:{status:{type:'boolean'},'retry-incomplete':{type:'boolean'},
  state:{type:'string',default:'research/linkage/generated/seoul-apartment-collection.json'},
  inventory:{type:'string',default:'research/seoul/raw/apartments.json'},
  'interval-ms':{type:'string',default:'1000'},'max-requests':{type:'string',default:'150000'},
  limit:{type:'string'},'rebuild-every':{type:'string',default:'50'},'no-build':{type:'boolean'}}});
const statePath=path.resolve(args.state),lockPath=statePath+'.lock';
let state={schemaVersion:1,targets:[]};
try {state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(args.status) {console.log(JSON.stringify(apartmentSummary(state),null,2));process.exit(0);}
const interval=Number(args['interval-ms']),budget=Number(args['max-requests']),limit=args.limit?Number(args.limit):Infinity,
  rebuildEvery=Number(args['rebuild-every']);
if(!Number.isInteger(interval)||interval<250||!Number.isInteger(budget)||budget<1||!(limit>0)
  ||!Number.isInteger(rebuildEvery)||rebuildEvery<1)throw new Error('Invalid collection limits');
await fs.mkdir(path.dirname(statePath),{recursive:true});
let lock;
try {lock=await fs.open(lockPath,'wx');}
catch(error) {
  if(error.code!=='EEXIST')throw error;
  const pid=Number(await fs.readFile(lockPath,'utf8'));
  if(!Number.isInteger(pid)||pid<=0)throw new Error('Invalid collection lock');
  let alive=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
  if(alive)throw new Error('서울 아파트 수집기가 이미 실행 중입니다: '+pid);
  await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx');
}
let stopped=false,count=0,lastLog=0;
const stop=()=>{stopped=true;};process.on('SIGINT',stop);process.on('SIGTERM',stop);
const stopFile=statePath+'.stop';
const pipeline=createAddressPipeline({maxRequests:budget,minIntervalMs:interval,shouldStop:()=>stopped||existsSync(stopFile),
  onProgress:event=>{if(Date.now()-lastLog>30000){console.log(JSON.stringify({current:state.current,stage:event.stage,...pipeline.stats()}));lastLog=Date.now();}}});
const save=async()=>{state.updatedAt=new Date().toISOString();state.network=pipeline.stats();await atomicJson(statePath,state);
  await atomicJson(statePath.replace(/\.json$/,'.summary.json'),apartmentSummary(state));};
const build=()=>{
  if(args['no-build'])return;
  const r=spawnSync(process.execPath,['scripts/build-linkage.mjs'],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  state.lastBuild={at:new Date().toISOString(),exitCode:r.status,error:r.status?r.stderr?.slice(-2000)||r.error?.message:null};
  if(r.status)console.error('조회 인덱스 갱신 실패; 수집 원본과 실패 기록은 보존합니다.');
};
try {
  await lock.writeFile(String(process.pid));
  const bytes=await fs.readFile(args.inventory),inventory=apartmentInventory(JSON.parse(bytes),state.targets);
  state={...state,...inventory,schemaVersion:1,source:'https://data.seoul.go.kr/dataList/OA-15818/S/1/datasetView.do',
    scope:'서울시 단지 목록의 아파트·주상복합 계열; 서울 모든 소규모 아파트의 누락 없음은 미검증',
    inventorySha256:createHash('sha256').update(bytes).digest('hex'),runStatus:'running',startedAt:new Date().toISOString(),stopReason:null};
  if(args['retry-incomplete'])for(const r of state.targets)if(['partial','no-plans','not-found','review','failed'].includes(r.status))r.status='pending';
  await save();console.log(JSON.stringify(apartmentSummary(state)));
  for(const target of state.targets) {
    if(target.status!=='pending')continue;
    if(stopped||existsSync(stopFile)||count>=limit)break;
    target.status='running';target.attempts++;state.current={id:target.id,name:target.name,address:target.address};await save();
    try {
      if(!target.address)throw new Error('수집 주소 없음');
      const result=await pipeline.run(target.address,{strictAddress:true});
      Object.assign(target,collectionResult(result,target));
    }catch(error) {
      if(['PROVIDER_BLOCKED','REQUEST_BUDGET','COLLECTION_STOPPED'].includes(error.code)) {
        target.status='pending';state.stopReason={code:error.code,message:error.message};await save();break;
      }
      target.status='failed';target.reason=error.message;
    }
    target.checkedAt=new Date().toISOString();count++;
    console.log(JSON.stringify({processed:count,id:target.id,name:target.name,status:target.status,images:target.images??0,unitsWithPlans:target.unitsWithPlans??0}));
    if(count%rebuildEvery===0)build();
    await save();
  }
  state.runStatus=state.targets.some(r=>['pending','running'].includes(r.status))?'paused':'finished';state.current=null;
  if(!state.stopReason&&state.runStatus==='paused')state.stopReason={code:count>=limit?'RUN_LIMIT':'STOP_REQUESTED'};
  build();await save();console.log(JSON.stringify(apartmentSummary(state),null,2));
}catch(error) {
  state.runStatus='error';state.stopReason={message:error.message};await save();throw error;
}finally {
  process.off('SIGINT',stop);process.off('SIGTERM',stop);await lock.close();await fs.unlink(lockPath);
}
