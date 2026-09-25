// Keep a verified NGII map run alive without ever opening an authentication prompt.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {writeJson} from './ngii-files.mjs';

const {values:args}=parseArgs({options:{
  state:{type:'string'},inbox:{type:'string'},output:{type:'string'},
  channel:{type:'string',default:'chrome'},'batch-size':{type:'string',default:'50'},
  'wait-minutes':{type:'string',default:'15'},'attach-pid':{type:'string'},
  'attach-error-log':{type:'string'}
}});
if(!args.state||!args.inbox||!args.output)throw Error('--state, --inbox and --output are required');
const stateDir=path.resolve(args.state),statusPath=path.join(stateDir,'supervisor.json');
const manifestPath=path.join(stateDir,'manifest.json'),stopPath=path.join(stateDir,'STOP');
const supervisorLockPath=path.join(stateDir,'supervisor.lock');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const stopped=async()=>fs.access(stopPath).then(()=>true,()=>false);
const counts=async()=>{
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(manifest.scale!==1000||manifest.sheets.some(x=>x.sourceFormat!=='ngi'))
    throw Error('Supervisor accepts only 1:1,000 NGI manifest');
  return manifest.sheets.reduce((result,sheet)=>(result[sheet.status]=(result[sheet.status]||0)+1,result),
    {total:manifest.sheets.length,verified:0,review:0,requested:0,pending:0});
};
const hasReviewToRetry=async()=>{
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  return manifest.sheets.some(sheet=>sheet.status==='review'&&(sheet.reviewRetryCount??0)<1);
};
const status=async data=>writeJson(statusPath,{...data,updatedAt:new Date().toISOString()});
const authError=text=>/NGII login expired|Portal profile has no reusable birthdate or purpose/.test(text);
let supervisorLock;
try{supervisorLock=await fs.open(supervisorLockPath,'wx');}
catch(error){
  if(error.code!=='EEXIST')throw error;
  const oldPid=Number((await fs.readFile(supervisorLockPath,'utf8').catch(()=>'' )).trim());
  const age=Date.now()-(await fs.stat(supervisorLockPath)).mtimeMs;
  if((Number.isSafeInteger(oldPid)&&oldPid>0&&alive(oldPid))||age<60000)
    throw Error(`Another NGII supervisor is running: ${supervisorLockPath}`);
  await fs.rename(supervisorLockPath,`${supervisorLockPath}.stale-${Date.now()}`);
  supervisorLock=await fs.open(supervisorLockPath,'wx');
}
await supervisorLock.writeFile(String(process.pid));
let currentPid=Number(args['attach-pid']||0),lastVerified=(await counts()).verified,failures=0,restarts=0;
let lastStatusAt=0;
try{
  while(true){
    if(await stopped()){
      if(currentPid&&alive(currentPid))try{process.kill(currentPid,'SIGINT');}catch{}
      await status({phase:'stopped-by-user',pid:currentPid,counts:await counts(),restarts});break;
    }
    if(currentPid&&alive(currentPid)){
      const current=await counts();
      if(current.verified>lastVerified){lastVerified=current.verified;failures=0;}
      if(Date.now()-lastStatusAt>30000){await status({phase:'running',pid:currentPid,counts:current,restarts});lastStatusAt=Date.now();}
      await pause(15000);continue;
    }
    const current=await counts();
    if(current.verified>lastVerified){lastVerified=current.verified;failures=0;}
    const retryReview=!current.pending&&!current.requested&&current.review>0&&await hasReviewToRetry();
    if(!current.pending&&!current.requested&&!retryReview){
      await status({phase:current.review?'finished-with-review':'finished',counts:current,restarts});break;
    }
    if(currentPid&&args['attach-error-log']&&restarts===0){
      const errorText=await fs.readFile(path.resolve(args['attach-error-log']),'utf8').catch(()=>'');
      if(authError(errorText)){
        await status({phase:'authentication-required',counts:current,restarts});break;
      }
    }
    if(failures>=5){
      await status({phase:'repeated-failures',counts:current,restarts,failures});break;
    }
    const lockPath=path.join(stateDir,'run.lock');
    const lock=await fs.stat(lockPath).catch(()=>null);
    if(lock&&Date.now()-lock.mtimeMs<65000){
      await status({phase:'waiting-for-stale-lock',counts:current,restarts});
      await pause(Math.max(1000,65000-(Date.now()-lock.mtimeMs)));continue;
    }
    if(currentPid||restarts)await pause(Math.min(60000,5000*2**failures));
    if(await stopped())continue;
    const runLabel=`run-${String(++restarts).padStart(3,'0')}`;
    const outPath=path.join(stateDir,`${runLabel}.log`),errPath=path.join(stateDir,`${runLabel}.err.log`);
    const [out,err]=await Promise.all([fs.open(outPath,'a'),fs.open(errPath,'a')]);
    const command=[path.join('scripts','collect-ngii.mjs'),'--state',stateDir,'--inbox',path.resolve(args.inbox),
      '--output',path.resolve(args.output),'--channel',args.channel,'--raw-format','ngi',
      '--batch-size',args['batch-size'],'--wait-minutes',args['wait-minutes']];
    if(retryReview)command.push('--retry-review-once');
    let child;
    try{child=spawn(process.execPath,command,{cwd:path.resolve('.'),windowsHide:true,stdio:['ignore',out.fd,err.fd]});}
    catch(error){await Promise.all([out.close(),err.close()]);throw error;}
    currentPid=child.pid;
    await status({phase:'running',pid:currentPid,counts:current,restarts,outPath,errPath});
    let exit=null;
    child.once('error',error=>{exit??={code:1,error:error.message};});
    child.once('exit',(code,signal)=>{exit??={code,signal};});
    while(!exit){
      await pause(15000);
      const progress=await counts();
      if(progress.verified>lastVerified){lastVerified=progress.verified;failures=0;}
      await status({phase:'running',pid:currentPid,counts:progress,restarts,outPath,errPath});
      if(await stopped()&&!exit)child.kill('SIGINT');
    }
    await Promise.all([out.close(),err.close()]);
    const errorText=await fs.readFile(errPath,'utf8').catch(()=>'');
    const after=await counts();
    if(after.verified>lastVerified){lastVerified=after.verified;failures=0;}
    else failures++;
    if(exit.code===3||authError(errorText)){
      await status({phase:'authentication-required',pid:null,counts:after,restarts,errPath});break;
    }
    await status({phase:'restarting',pid:null,counts:after,restarts,failures,exit,errPath});
    currentPid=0;
  }
}catch(error){
  await status({phase:'supervisor-error',pid:currentPid,counts:await counts().catch(()=>null),error:error.message,restarts});
  process.exitCode=1;
}finally{
  await supervisorLock.close();
  await fs.unlink(supervisorLockPath).catch(()=>{});
}
