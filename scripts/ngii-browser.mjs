import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
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

export async function districts(page) {
  return page.evaluate(()=>new Promise((resolve,reject)=> {
    const timer=setTimeout(()=>reject(new Error('행정구역 조회 시간 초과')),60000);
    getMainComboData(data=>{clearTimeout(timer);resolve(data.guList.filter(g=>String(g.code).startsWith('11')).map(g=>({code:g.code,name:g.codeNm})));});
  }));
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
    return {counts,items:result.items};
  },code);
}

export async function ensureLogin(page, stopped=()=>false) {
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
          && typeof downloadMapData==='function' && typeof fnDownloadNRM==='function',null,{timeout:60000});
        return;
      }
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

// Remember only the application form in this page's memory after the user submits it.
// No cookies, certificate data or form values are returned to Node or written to disk.
export async function installApplicationMemory(page) {
  await page.evaluate(()=> {
    if(window.zipviewNgii?.version===2){window.zipviewNgii.rebind();return;}
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
      version:2,rebind,ready,
      reset(){submitted=false;opened=false;stableSince=0;},
      state(){return {submitted,opened,reusable:Boolean(saved||previous?.state().reusable)};},
      fill(){
        if(!saved&&previous?.state().reusable&&form()) {
          previous.fill();
          const v=values();
          if(v.birthday&&v.purpose)saved=v;
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
  const reusable=await page.evaluate(items=> {
    window.zipviewNgii.reset();
    downloadMapData('1','online',items);
    return window.zipviewNgii.state().reusable;
  },batch.map(x=>x.payload));
  await page.locator('.mapApplication.online').waitFor({state:'visible',timeout:60000});
  await installApplicationMemory(page);
  if(reusable) {
    await page.waitForFunction(()=>window.zipviewNgii.stable(),null,{polling:200,timeout:60000});
    await page.locator('.mapApplication.online').getByRole('button',{name:'다운로드',exact:true}).click();
  } else {
    console.log('첫 다운로드 신청서의 사용 목적·동의를 확인하고 다운로드를 눌러주세요. 이후 묶음에는 같은 입력을 사용합니다.');
  }
}

export function watchBrowserDownloads(context, output, onError) {
  const jobs=new Set();
  const attach=page=>page.on('download',download=> {
    let stage='filename';
    const job=(async()=> {
      const name=safeFilename(download.suggestedFilename());
      stage='temporary-path';
      const temp=path.join(output,`.ngii-${crypto.randomUUID()}.partial`);
      stage='browser-transfer';
      await download.saveAs(temp);
      if(await download.failure())throw new Error('브라우저 파일 전송 실패');
      stage='save-file';
      // Never overwrite an existing user file. A collision is retained for inspection.
      try {await fs.copyFile(temp,path.join(output,name),1);await fs.unlink(temp);}
      catch(error) {if(error.code!=='EEXIST')throw error;throw new Error(`기존 파일과 이름 충돌: ${name}. 수신 파일은 .partial로 보존했습니다.`);}
    })().catch(error=>onError(`파일 저장 실패 (${stage}, ${error.code || error.name}): 출력 폴더의 충돌 파일 또는 .partial 파일을 확인하세요.`));
    jobs.add(job);job.finally(()=>jobs.delete(job));
  });
  context.pages().forEach(attach);context.on('page',attach);
  return async()=>Promise.all([...jobs]);
}

export async function startTransferPopup(context, attempted) {
  for(const page of context.pages()) {
    if(page.isClosed() || !page.url().startsWith('https://map.ngii.go.kr/pd/purchs/download.do') || attempted.has(page))continue;
    const button=page.getByRole('button',{name:/^전체\s*다운로드$/});
    if(await button.count()===1 && await button.isVisible() && await button.isEnabled()) {
      attempted.add(page);await button.click();
    }
  }
}
