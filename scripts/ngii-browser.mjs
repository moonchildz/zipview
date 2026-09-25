import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import { safeFilename } from './ngii-files.mjs';

export const MAP_URL='https://map.ngii.go.kr/ms/map/NlipMap.do?tabGb=total';
export const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function launchBrowser({inventory=false,channel=process.platform==='win32'?'msedge':'chromium'}) {
  if(channel==='chromium')channel=undefined;
  const profile=path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share'),'Zipview',channel==='chrome'?'ngii-browser-chrome':'ngii-browser');
  const browser=inventory ? await chromium.launch({channel,headless:true}) : null;
  const context=browser ? await browser.newContext() : await chromium.launchPersistentContext(profile,{channel,headless:false,acceptDownloads:true});
  try {
    const page=await context.newPage();
    await page.goto(MAP_URL,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>typeof mapQuery!=='undefined' && typeof getMainComboData==='function',null,{timeout:60000});
    return {context,page,close:()=>browser?browser.close():context.close()};
  } catch(error) {await (browser?browser.close():context.close());throw error;}
}

export async function districts(page, prefix='11') {
  return page.evaluate(prefix=>new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>reject(new Error('행정구역 조회 시간 초과')),60000);
    getMainComboData(data=>{clearTimeout(timer);resolve(data.guList.filter(g=>String(g.code).startsWith(prefix)).map(g=>({code:g.code,name:g.codeNm})));});
  }),prefix);
}

export async function queryDistrict(page, code) {
  return page.evaluate(async code=> {
    const call=fn=>new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>reject(new Error('도엽 조회 시간 초과')),60000);
      fn(data=>{clearTimeout(timer);data?resolve(data):reject(new Error('도엽 조회 실패'));});
    });
    mapQuery.clear();simple.settings.scale=null;integ.searchForm=1;
    const area=await call(r=>mapQuery.searchSigu(code,r));
    const a=area.items[0];
    // Unfiltered count and list must agree before selecting scale 1000 locally.
    const counts=await call(r=>mapQuery.searchCombine(1,a.minx,a.miny,a.maxx,a.maxy,a.wkt,a.num,code,null,r));
    const result=await call(r=>mapQuery.searchSuchi('3',null,null,r));
    return {counts,items:result.items,area:a};
  },code);
}

export async function queryMapBounds(page,bounds) {
  return page.evaluate(async bounds=>{
    const call=fn=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Spatial inventory timeout')),60000);fn(data=>{clearTimeout(timer);data?resolve(data):reject(Error('Empty spatial response'));});});
    const [x0,y0,x1,y1]=bounds;
    mapQuery.clear();simple.settings.scale=null;integ.searchForm=2;
    const wkt=`POLYGON ((${x0} ${y0},${x1} ${y0},${x1} ${y1},${x0} ${y1},${x0} ${y0}))`;
    const counts=await call(r=>mapQuery.searchCombine(1,x0,y0,x1,y1,wkt,null,null,null,r));
    const result=await call(r=>mapQuery.searchSuchi('3',null,null,r));
    return {counts,items:result.items};
  },bounds);
}

export async function ensureLogin(page, stopped=()=>false, {allowPrompt=true}={}) {
  let prompted=false, transitionReported=false;
  while(!stopped()) {
    if(page.isClosed())throw new Error('작업 브라우저가 닫혔습니다. 같은 명령으로 재개하세요.');
    try {
      const loginState=await page.evaluate(async()=> {
        // Authentication can reload the opener or temporarily redirect it.
        // Only check the session on the expected origin; never inspect auth pages.
        if(location.origin !== 'https://map.ngii.go.kr')return 'transition';
        try {
          const r=await fetch('/mn/loginCheck.do',{method:'POST',signal:AbortSignal.timeout(10000)});
          if(!r.ok)return 'transition';
          const data=await r.json();
          return data.isLogin === true ? 'authenticated' : data.isLogin === false ? 'anonymous' : 'transition';
        } catch {return 'transition';}
      });
      if(loginState==='authenticated') {
        if(new URL(page.url()).pathname!=='/ms/map/NlipMap.do') {
          await page.goto(MAP_URL,{waitUntil:'domcontentloaded',timeout:60000});
        }
        // A successful login response can arrive before the reloaded map scripts.
        await page.waitForFunction(()=>document.readyState!=='loading' && typeof mapQuery!=='undefined'
          && typeof downloadMapData==='function' && typeof fnDownloadNRM==='function',null,{timeout:60000,polling:500});
        return;
      }
      if(loginState==='anonymous'&&!allowPrompt)
        throw new Error('NGII login expired; collection paused without opening a login window');
      if(loginState==='anonymous'&&!prompted) {
        console.log('작업 브라우저에서 간편인증 로그인을 완료하세요. 인증 완료를 자동으로 기다립니다.');
        // Set before invocation: fnLogin itself may cause navigation.
        prompted=true;
        const opened=await page.evaluate(()=> {
          if(typeof fnLogin!=='function')return false;
          fnLogin();return true;
        });
        if(!opened)prompted=false;
      }
    } catch(error) {
      if(page.isClosed())throw new Error('작업 브라우저가 닫혔습니다. 같은 명령으로 재개하세요.');
      if(!/Execution context was destroyed|Cannot find context|navigation|net::ERR_ABORTED/i.test(error.message)
          && error.name!=='TimeoutError')throw error;
      if(!transitionReported) {
        console.log('인증 후 페이지 전환을 기다립니다. 브라우저를 유지하고 로그인 상태를 다시 확인합니다.');
        transitionReported=true;
      }
    }
    await pause(3000);
  }
  throw new Error('중단됨');
}

// Reuse the profile's prefilled application details and remember them in this page.
// No cookies, certificate data or form values are returned to Node or written to disk.
export async function installApplicationMemory(page) {
  await page.evaluate(()=> {
    if(window.zipviewNgii?.version===3){window.zipviewNgii.rebind();return;}
    const previous=window.zipviewNgii;
    let saved=null,submitted=false,opened=false;
    let stableSince=0,wrappedRequest,wrappedTransfer;
    const form=()=>document.querySelector('.mapApplication.online');
    const input=selector=>form()?.querySelector(selector);
    const agree=()=>input('input[name=onChkAgree][id=agree]');
    const values=()=>({birthday:input('input[name=onBrthdy]')?.value||'',purpose:input('#onPurchsPurps')?.value||'',detail:input('input[name=onDetailCn]')?.value||''});
    const ready=()=> {
      const v=values(),a=agree();
      return Boolean(v.birthday&&v.purpose&&(v.purpose!=='BAAAC00008'||v.detail)&&a?.checked&&!a.disabled);
    };
    const capture=()=>{if(ready())saved=values();};
    const rebind=()=> {
      if(window.fnDownloadNRM!==wrappedRequest) {
        const original=window.fnDownloadNRM;
        wrappedRequest=window.fnDownloadNRM=function(...args) {
          if(args[0]==='1'&&args[1]==='online') {
            capture();
            submitted=true;
          }
          return original.apply(this,args);
        };
      }
      if(window.fnFileDownload!==wrappedTransfer) {
        const transfer=window.fnFileDownload;
        wrappedTransfer=window.fnFileDownload=function(...args){opened=true;return transfer.apply(this,args);};
      }
    };
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('button');
      if(button?.textContent.trim()==='다운로드'&&form()?.contains(button))capture();
    },true);
    window.zipviewNgii={
      version:3,rebind,ready,
      reset(){submitted=false;opened=false;stableSince=0;},
      state(){return {submitted,opened,reusable:Boolean(saved||previous?.state().reusable)};},
      fill(){
        if(!saved&&previous?.state().reusable&&form()) {
          previous.fill();
          const v=values();
          if(v.birthday&&v.purpose)saved=v;
        }
        if(!saved&&form()) {
          const v=values();
          if(v.birthday&&v.purpose&&(v.purpose!=='BAAAC00008'||v.detail))saved=v;
        }
        if(!saved)return false;
        const birthday=input('input[name=onBrthdy]'),purpose=input('#onPurchsPurps'),detail=input('input[name=onDetailCn]'),a=agree();
        if(!birthday||!purpose||!a||a.disabled)return false;
        if(birthday.value!==saved.birthday)$(birthday).val(saved.birthday).trigger('input').trigger('change');
        if(purpose.value!==saved.purpose)$(purpose).val(saved.purpose).trigger('change');
        if(detail&&detail.value!==saved.detail)$(detail).val(saved.detail).trigger('input').trigger('change');
        if(!a.checked)a.click();
        return ready();
      },
      stable(){
        const before=ready(),after=this.fill();
        if(!before||!after||!stableSince)stableSince=Date.now();
        return after&&Date.now()-stableSince>=1000;
      }
    };
    rebind();
  });
}

export async function openApplication(page,batch) {
  if(!batch.length||batch.length>100)throw new Error('신청 도엽은 1~100개여야 합니다.');
  await installApplicationMemory(page);
  await page.evaluate(items=> {
    window.zipviewNgii.reset();
    downloadMapData('1','online',items);
  },batch.map(x=>x.payload));
  await page.locator('.mapApplication.online').waitFor({state:'visible',timeout:60000});
  await installApplicationMemory(page);
  try {
    await page.waitForFunction(()=>window.zipviewNgii.stable(),null,{polling:200,timeout:60000});
  } catch(error) {
    if(error.name==='TimeoutError') {
      const loginState=await page.evaluate(async()=>{
        try {
          const response=await fetch('/mn/loginCheck.do',{method:'POST',signal:AbortSignal.timeout(10000)});
          return (await response.json()).isLogin===true;
        }catch{return null;}
      });
      if(loginState===false)throw new Error('NGII login expired while application form was open');
      const incomplete=new Error('Portal profile has no reusable birthdate or purpose; application was not submitted');
      incomplete.code='APPLICATION_FORM_INCOMPLETE';throw incomplete;
    }
    throw error;
  }
  // The click only calls fnDownloadNRM. The portal can reject its asynchronous
  // application while leaving that callback and the browser process alive.
  const receipt=page.waitForResponse(response=>
    response.url().includes('/pd/shbtManage/shbtInsertNRM.do')
      && response.request().method()==='POST',{timeout:190000});
  await page.locator('.mapApplication.online').getByRole('button',{name:'다운로드',exact:true}).click();
  const response=await receipt;
  let result;
  try {result=await response.json();}catch{}
  if(!response.ok()||result?.resultCode!=='1') {
    const error=new Error(`Portal rejected map application (HTTP ${response.status()}, resultCode ${String(result?.resultCode??'none')})`);
    error.code='APPLICATION_REJECTED';
    throw error;
  }
  return {accepted:true,hasTransferList:Array.isArray(result?.allDataMap?.orderDownList)};
}

// The portal sometimes records an application without opening its transfer
// window. Recover that exact batch from the user's application history.
export async function openRequestedFromHistory(context,batch) {
  const numbers=new Set(batch.map(x=>String(x.number)));
  if(!numbers.size||numbers.size!==batch.length||batch.length>100)
    throw new Error('Invalid application-history batch');
  const page=await context.newPage();
  try {
    await page.goto('https://map.ngii.go.kr/pd/purchs/userPurchsDtlsList2.do',
      {waitUntil:'domcontentloaded',timeout:60000});
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
      page.evaluate(()=>fn_purchs_dtls_page('1','1'))
    ]);
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),
      page.selectOption('#selectNumbox','100')
    ]);
    const selected=await page.evaluate(wanted=>{
      const numbers=new Set(wanted),found=new Set();
      for(const row of document.querySelectorAll('table tbody tr')) {
        const cells=[...row.querySelectorAll('td')].map(cell=>cell.innerText.trim());
        const number=cells[5],checkbox=row.querySelector('input[name=orderList]');
        if(!checkbox||!numbers.has(number)||found.has(number))continue;
        const button=row.querySelector('button.fn');
        if(cells[2].replace(/\s/g,'')!=='수치지도V2.0'||cells[3]!=='1:1,000'||cells[6]!=='NGI'
            ||checkbox.dataset.complate!=='true'||!button||!/'0'\s*\);?\s*$/.test(button.getAttribute('onclick')||''))
          throw new Error(`Application-history item is not ready 1:1,000 NGI: ${number}`);
        checkbox.click();
        found.add(number);
      }
      return {found:[...found],checked:document.querySelectorAll('input[name=orderList]:checked').length};
    },[...numbers]);
    if(selected.found.length!==numbers.size||selected.checked!==numbers.size) {
      const error=new Error(`Application history has ${selected.found.length}/${numbers.size} requested sheets; no transfer started`);
      error.code='HISTORY_NOT_READY';throw error;
    }
    await page.getByRole('button',{name:'선택 다운로드',exact:true}).click();
    return page;
  }catch(error){await page.close().catch(()=>{});throw error;}
}

async function fileHash(filename) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(filename))hash.update(chunk);
  return hash.digest('hex');
}

export function watchBrowserDownloads(context, output, onError,{allowNgi=false}={}) {
  const jobs=new Set();
  const listeners=new Map();
  const attach=page=>{if(listeners.has(page))return;const handler=download=> {
    let stage='filename';
    const job=(async()=> {
      const name=safeFilename(download.suggestedFilename(),{allowNgi});
      stage='temporary-path';
      const temp=path.join(output,`.ngii-${crypto.randomUUID()}.partial`);
      stage='browser-transfer';
      await download.saveAs(temp);
      if(await download.failure())throw new Error('브라우저 파일 전송 실패');
      stage='save-file';
      // Never overwrite an existing user file. A collision is retained for inspection.
      const destination=path.join(output,name);
      try {await fs.copyFile(temp,destination,1);await fs.unlink(temp);}
      catch(error) {
        if(error.code!=='EEXIST')throw error;
        const [received,existing]=await Promise.all([fs.stat(temp),fs.stat(destination)]);
        if(received.size===existing.size&&await fileHash(temp)===await fileHash(destination)){
          await fs.unlink(temp);return;
        }
        throw new Error(`기존 파일과 이름 충돌: ${name}. 수신 파일은 .partial로 보존했습니다.`);
      }
    })().catch(error=>onError(`파일 저장 실패 (${stage}, ${error.code || error.name}): 출력 폴더의 충돌 파일 또는 .partial 파일을 확인하세요.`));
    jobs.add(job);job.finally(()=>jobs.delete(job));
  };listeners.set(page,handler);page.on('download',handler);};
  context.pages().forEach(attach);context.on('page',attach);
  const drain=async()=>Promise.all([...jobs]);
  drain.dispose=()=>{context.off('page',attach);for(const [page,handler] of listeners)page.off('download',handler);listeners.clear();};
  return drain;
}

export async function startTransferPopup(context, attempted) {
  // Batches and runner restarts must not restart an already handled document.
  const key=Symbol.for('zipview.ngii.transferAttempts');
  attempted=context[key]??=attempted;
  attempted.watched??=new WeakSet();
  for(const page of context.pages()) {
    try {
    if(page.isClosed() || !/^https:\/\/(?:map\.ngii\.go\.kr\/pd\/purchs\/download\.do|nlippd\.ngii\.go\.kr\/nlippd\/pd\/innorix\/innorixdownLoad\.do)(?:[?#]|$)/.test(page.url()))continue;
    if(!attempted.watched.has(page)){
      attempted.watched.add(page);
      page.on?.('framenavigated',frame=>{
        if(frame===page.mainFrame()){
          attempted.delete(page);attempted.programStarted?.delete(page);
        }
      });
    }
    const inbox=globalThis.__zipviewNgiiTransferInbox;
    if(inbox){
      const start=page.getByText('전송시작',{exact:true});
      if(await start.count()===1&&await start.isVisible()&&await start.isEnabled()){
        const text=await page.locator('body').innerText();
        const expected=globalThis.__zipviewNgiiTransferRawFormat==='ngi'
          ? /\(B010\).+?_\d{9}_\d{4}_.+?\.(?:ngi|nda|xml)/i
          : /\(B010\).+?_\d{9}_\d{4}_.+?\.zip/i;
        if(text.replaceAll('\\','/').toLowerCase().includes(inbox.replaceAll('\\','/').toLowerCase())&&expected.test(text)){
          attempted.programStarted??=new WeakSet();
          if(!attempted.programStarted.has(page)){await page.bringToFront();await start.click();attempted.programStarted.add(page);attempted.add(page);}
        }
        continue;
      }
    }
    // An Innorix progress/completion dialog covers the underlying download button.
    if(await page.locator('.irx_transferWin_wrapper:visible').count()){
      // Also remember transfers started by the user or an earlier runner.
      attempted.add(page);continue;
    }
    if(attempted.has(page))continue;
    const button=page.getByRole('button',{name:/^전체\s*다운로드$/});
    if(await button.count()===1 && await button.isVisible() && await button.isEnabled()) {
      // The dialog can appear between inspection and click (including user clicks).
      try {await page.bringToFront();await button.click({timeout:1500});attempted.add(page);}
      catch(error){if(page.isClosed())continue;if(error.name!=='TimeoutError')throw error;}
    }
    } catch(error) {
      // The portal closes completed transfer popups while they are being inspected.
      if(page.isClosed()||/Target page, context or browser has been closed|Execution context was destroyed/i.test(error.message))continue;
      throw error;
    }
  }
}
