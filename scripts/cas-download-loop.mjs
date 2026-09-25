import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {atomicJson} from './atomic-json.mjs';

// May also be attached to a preserved authenticated browser after a recoverable UI failure.
export async function continueCasDownloads({browser,stateDir,inbox,python='python',waitMs=3600000,retryReview=false,shouldStop=async()=>false,alreadyRequestedId=null,browserFunctions=null}){
  const {rememberCasApplication,prepareCasApplication,submitRememberedCas,startCasTransfer,readCasTransferProgress,casLoginState,waitCasLogin,pause}=browserFunctions??await import('./cas-browser.mjs');
  const file=path.join(stateDir,'transfers.json'),plan=JSON.parse(await fs.readFile(path.join(stateDir,'plan.json'),'utf8'));
  const transfer=JSON.parse(await fs.readFile(file,'utf8'));
  const save=async()=>{transfer.updatedAt=new Date().toISOString();await atomicJson(file,transfer);};
  const verify=id=>{
    const r=spawnSync(python,['scripts/verify-cas-files.py',inbox,id],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});
    if(r.error)throw r.error;try{return JSON.parse(r.stdout);}catch{throw new Error('File verifier failed');}
  };
  await rememberCasApplication(browser.page,{restore:false});
  if(alreadyRequestedId){
    if(!plan.selected.some(s=>s.id===alreadyRequestedId))throw new Error('Existing request is outside selected plan');
    transfer.scenes[alreadyRequestedId]={...transfer.scenes[alreadyRequestedId],status:'requested',requestedAt:new Date().toISOString(),recoveredExistingApplication:true};
  }
  transfer.runStatus='running';delete transfer.error;await save();
  const ensureLogin=async()=>{
    transfer.authState=await casLoginState(browser.page);
    if(transfer.authState!=='authenticated'){
      transfer.runStatus='awaiting-login';await save();
      await waitCasLogin(browser.page,shouldStop);
      transfer.authState='authenticated';transfer.runStatus='running';await save();
    }
  };
  try{
    for(const scene of plan.selected){
      if(await shouldStop()||browser.page.isClosed())break;
      const local=verify(scene.id);let state=transfer.scenes[scene.id]??{status:'pending'};
      if(local.status==='downloaded-header-checked'){transfer.scenes[scene.id]={...state,...local};await save();continue;}
      if(state.status==='review'&&!retryReview)continue;
      transfer.current=scene.id;delete transfer.progress;await save();
      if(state.status!=='requested'){
        let reusable;
        while(true){
          await ensureLogin();
          try{reusable=await prepareCasApplication(browser.page,scene);break;}
          catch(e){if(e.code!=='LOGIN_REQUIRED')throw e;}
        }
        state=transfer.scenes[scene.id]={status:'requested',requestedAt:new Date().toISOString()};await save();
        if(reusable)await submitRememberedCas(browser.page);
        else console.log('첫 신청서의 사용 목적·동의를 확인하고 다운로드를 누르세요. 다음 영상은 자동으로 신청합니다.');
      }
      console.log(JSON.stringify({stage:'transfer-wait',id:scene.id,inbox}));
      let deadline=Date.now()+waitMs,lastBytes=-1;const attempted=new WeakSet();let lastLog=0,lastAuthCheck=0;
      // A recovered user-started transfer must not be clicked a second time.
      if(scene.id===alreadyRequestedId)browser.context.pages().forEach(p=>attempted.add(p));
      while(!await shouldStop()&&!browser.page.isClosed()&&Date.now()<deadline){
        if(Date.now()-lastAuthCheck>=300000){
          transfer.authState=await casLoginState(browser.page);lastAuthCheck=Date.now();await save();
          if(transfer.authState==='anonymous')console.log('로그인이 만료됐습니다. 현재 전송은 유지하고 다음 신청 전에 재로그인을 기다립니다.');
        }
        await startCasTransfer(browser.context,browser.page,scene,attempted,inbox);
        const progress=await readCasTransferProgress(browser.context,browser.page,scene);
        if(progress&&progress.transferredBytes>lastBytes){lastBytes=progress.transferredBytes;deadline=Date.now()+waitMs;transfer.progress=progress;}
        const result=verify(scene.id);
        if(result.status==='downloaded-header-checked'){transfer.scenes[scene.id]={...state,...result};console.log(JSON.stringify({stage:'downloaded-header-checked',id:scene.id}));await save();break;}
        if(Date.now()-lastLog>30000){console.log(JSON.stringify({stage:'transfer-wait',id:scene.id,status:result.status,missing:result.missing??[],progress}));await save();lastLog=Date.now();}
        await pause(3000);
      }
      if(transfer.scenes[scene.id].status!=='downloaded-header-checked'&&!await shouldStop()){
        transfer.scenes[scene.id]={...state,status:'review',reason:'transfer-stalled-or-window-closed'};await save();break;
      }
      await save();
    }
    transfer.current=null;
    transfer.runStatus=plan.selected.every(s=>transfer.scenes[s.id]?.status==='downloaded-header-checked')?'finished':'paused';await save();
  }catch(e){transfer.runStatus='error';transfer.error=e.message;await save();throw e;}
  return transfer;
}
