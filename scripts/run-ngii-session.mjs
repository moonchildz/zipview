// Continue map downloads in the user's already authenticated Playwright context.
// No cookies or application form values are exported to files or logs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJson} from './atomic-json.mjs';
import {reconcileFiles,nextBatch} from './ngii-files.mjs';
import {importNgiiInbox} from './ngii-inbox.mjs';
import {MAP_URL,ensureLogin,openApplication,startTransferPopup,pause,watchBrowserDownloads} from './ngii-browser.mjs';

export async function runNgiiSession(browser,{root='.tools/national',region='busan',resumePage=null}={}){
 const config=JSON.parse(await fs.readFile(path.join(root,'config.json'),'utf8'));
 if(JSON.stringify(config.scales)!=='[1000]')throw Error('Only 1:1000 is allowed');
 const seoul=JSON.parse(await fs.readFile(path.join(config.existingSeoulState,'transfers.json'),'utf8'));
 if(seoul.runStatus!=='finished')throw Error('Seoul satellite queue is not finished');
 const lock=await fs.open(path.join(root,'run.lock'),'wx');await lock.writeFile(String(process.pid));
 const output=path.resolve(config.mapOutput),inbox=path.resolve(config.mapInbox),cache=new Map(),inboxCache=new Map();
 globalThis.__zipviewNgiiTransferInbox=inbox;
 let page,timer,saveDownloads;const stopped=async()=>Boolean(globalThis.__zipviewStopMaps)||await fs.access(path.join(root,'STOP')).then(()=>true,()=>false);
 const state={region,pid:process.pid,scale:1000,phase:'starting'};
 const status=async extra=>{Object.assign(state,extra,{updatedAt:new Date().toISOString()});await atomicJson(path.join(root,'map-session.json'),state);};
 try{
  const jobs=JSON.parse(await fs.readFile(path.join(root,'jobs.json'),'utf8'));
  const selected=jobs.filter(j=>j.region===region&&j.dataset==='maps'&&j.availability==='available');
  if(selected.some(j=>j.scale!==1000))throw Error('Invalid scale in queue');
  page=resumePage&&!resumePage.isClosed()?resumePage:await browser.context.newPage();globalThis.__zipviewMapPage=page;
  if(!resumePage||resumePage.isClosed())await page.goto(MAP_URL,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>typeof mapQuery!=='undefined',null,{timeout:60000,polling:500});
  await status({phase:'checking-login'});await ensureLogin(page,()=>Boolean(globalThis.__zipviewStopMaps));
  timer=setInterval(()=>page.evaluate(()=>fetch('/mn/loginCheck.do',{method:'POST'}).then(r=>r.json()).then(d=>d.isLogin)).catch(()=>{}),240000);
  let downloadError;saveDownloads=watchBrowserDownloads(browser.context,output,e=>{downloadError=e;});
  for(const job of selected){
   if(await stopped())break;
   const manifestPath=path.join(job.state,'manifest.json'),manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
   if(manifest.scale!==1000)throw Error('Wrong manifest scale');
   const save=()=>atomicJson(manifestPath,manifest);
   const refresh=async()=>{await importNgiiInbox({sheets:manifest.sheets,inbox,output,cache:inboxCache});await reconcileFiles(manifest.sheets,output,cache);await save();};
   await status({phase:'verifying-files',job:job.id,total:manifest.sheets.length});
   await refresh();
   while(!await stopped()){
    let batch=manifest.sheets.filter(s=>s.status==='requested');
    if(!batch.length){batch=nextBatch(manifest.sheets,100);if(!batch.length)break;
     const disk=await fs.statfs(output);if(Number(disk.bavail)*Number(disk.bsize)<config.minimumFreeGB*1e9)throw Error('Insufficient disk space');
     await ensureLogin(page,()=>Boolean(globalThis.__zipviewStopMaps),{allowPrompt:false});
     for(const s of batch)s.status='requested';await save();
     await status({phase:'application',job:job.id,batch:batch.length,verified:manifest.sheets.filter(s=>s.status==='verified').length,total:manifest.sheets.length});
     await openApplication(page,batch);
    }
    await status({phase:'waiting-transfer',job:job.id,batch:batch.length});
    const attempted=new WeakSet();let deadline=Date.now()+3600000,lastDone=-1,lastHistoryCheck=Date.now();
    while(!await stopped()&&batch.some(s=>!['verified','review'].includes(s.status))){
     if(page.isClosed())throw Error('Map page closed');
     await startTransferPopup(browser.context,attempted);await refresh();
     const done=batch.filter(s=>s.status==='verified').length;if(done>lastDone){lastDone=done;deadline=Date.now()+3600000;}
     const transferOpen=browser.context.pages().some(p=>!p.isClosed()&&/^https:\/\/(?:nlippd\.ngii\.go\.kr\/nlippd\/pd\/innorix\/innorixdownLoad\.do|map\.ngii\.go\.kr\/pd\/purchs\/download\.do)(?:[?#]|$)/.test(p.url()));
     if(!transferOpen&&batch.some(s=>s.status==='requested')&&Date.now()-lastHistoryCheck>=60000){
      lastHistoryCheck=Date.now();
      await status({phase:'recovering-history'});
      const {resumeFromHistory}=await import('./ngii-history.mjs');
      const recovery=await resumeFromHistory(browser.context,batch);
      await status({historyRecovery:{...recovery,at:new Date().toISOString()}});
     }
     await status({phase:'waiting-transfer',verified:manifest.sheets.filter(s=>s.status==='verified').length,total:manifest.sheets.length});
     if(downloadError)throw Error(downloadError);
     if(Date.now()>deadline)throw Error('Transfer stalled; requested state preserved for resume');
     await pause(5000);
    }
   }
   job.lastResult=manifest.sheets.every(s=>s.status==='verified')&&!job.rejectedCount?'files-verified':'needs-review';job.lastStartedAt=state.updatedAt;await atomicJson(path.join(root,'jobs.json'),jobs);
  }
  await status({phase:await stopped()?'paused':'finished-available-jobs',note:'Source review records remain incomplete'});
 }catch(e){await status({phase:'error',error:e.message});throw e;}
 finally{clearInterval(timer);if(saveDownloads){await saveDownloads();saveDownloads.dispose?.();}await lock.close();await fs.unlink(path.join(root,'run.lock'));}
}
