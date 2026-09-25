import {chromium} from 'playwright';
import path from 'node:path';
import os from 'node:os';
import {pause,watchBrowserDownloads,startTransferPopup} from './ngii-browser.mjs';
export const CAS_URL='https://map.ngii.go.kr/ms/map/nlipCASImgMap.do';
export async function openCasBrowser({interactive=false,channel='chrome'}={}){
  const browser=interactive?null:await chromium.launch({channel,headless:true});
  const context=browser?await browser.newContext():await chromium.launchPersistentContext(
    path.join(process.env.LOCALAPPDATA??os.homedir(),'Zipview','ngii-cas-'+channel),{channel,headless:false,acceptDownloads:true});
  const page=await context.newPage();
  try{await page.goto(CAS_URL,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>typeof satlitAirMap!=='undefined',{},{timeout:60000});
  }catch(e){await (browser??context).close();throw e;}
  return {page,context,close:()=> (browser??context).close()};
}
export async function searchCas(page,{bounds,start,end}){
  return page.evaluate(async({bounds:[w,s,e,n],start,end})=>{
    const body=new URLSearchParams({satlitNm:'CAS500-1',searchType:'SPCE',stDate:start,edDate:end,
      geometry:`POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`});
    const r=await fetch('/ms/satellite/nlipCASSearchCountList.do',{method:'POST',body,signal:AbortSignal.timeout(45000)});
    if(!r.ok)throw new Error(`Catalog HTTP ${r.status}`);
    const data=await r.json();if(!Array.isArray(data))throw new Error('Catalog schema changed');
    for(const row of data){
      if(row.CATALOGTYPE==='L2G'){
        const t=String(row.CATALOGID).split('_')[1]??'',date=`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`;
        if(date<start||date>end)throw new Error('Catalog ignored requested date interval; refusing incomplete inventory');
      }
    }return data;
  },{bounds,start,end});
}
export async function casLoginState(page){
  if(page.isClosed())return 'closed';
  try{
    if(new URL(page.url()).origin!=='https://map.ngii.go.kr')return 'transition';
    return await page.evaluate(async()=>{
      const r=await fetch('/mn/loginCheck.do',{method:'POST',signal:AbortSignal.timeout(10000)});
      if(!r.ok)return 'transition';const data=await r.json();
      return data.isLogin===true?'authenticated':data.isLogin===false?'anonymous':'transition';
    });
  }catch{return page.isClosed()?'closed':'transition';}
}
export async function casKeepaliveTick(page){
  const state=await casLoginState(page);
  if(state==='authenticated'){
    // Browser-local mouse activity only: no desktop cursor, clicks, focus or form edits.
    await page.mouse.move(12,12);await page.mouse.move(14,12);
  }
  return {authState:state,checkedAt:new Date().toISOString(),activity:state==='authenticated'?'session-check-and-browser-mousemove':'session-check-only'};
}
export function startCasKeepalive(page,{intervalMs=60000,shouldStop=async()=>false,onStatus=()=>{}}={}){
  if(!Number.isFinite(intervalMs)||intervalMs<30000)throw new Error('Keepalive interval must be at least 30 seconds');
  let busy=false,closed=false,timer;
  const stop=()=>{closed=true;clearInterval(timer);};
  const tick=async()=>{
    if(closed||busy)return;
    busy=true;
    try{
      if(page.isClosed()||await shouldStop()){stop();return;}
      await onStatus(await casKeepaliveTick(page));
    }catch{try{await onStatus({authState:'transition',checkedAt:new Date().toISOString(),activity:'check-failed'});}catch{/* Status reporting must not stop the collector. */}}
    finally{busy=false;}
  };
  timer=setInterval(()=>void tick(),intervalMs);void tick();return stop;
}
export async function waitCasLogin(page,stopped){
  console.log('국토정보맵 작업 창에서 로그인하세요. 인증 중에는 창을 자동으로 닫지 않습니다.');
  while(!await stopped()&&!page.isClosed()){
    try{
      if(await casLoginState(page)==='authenticated'){
        if(new URL(page.url()).pathname!=='/ms/map/nlipCASImgMap.do')await page.goto(CAS_URL,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>typeof satlitAirMap?.openApplicationDownloadTiff==='function',null,{timeout:30000});return;
      }
    }catch{/* Certificate navigation can destroy the page execution context. */}
    await pause(2000);
  }throw new Error('Login stopped or browser closed');
}
export async function prepareCasApplication(page,scene){
  if(await casLoginState(page)!=='authenticated')throw Object.assign(new Error('국토정보맵 재로그인이 필요합니다.'),{code:'LOGIN_REQUIRED'});
  await rememberCasApplication(page,{restore:false});
  await page.evaluate(row=>{satlitAirMap.searchResultList=[{...row,checked:'true'}];satlitAirMap.openApplicationDownloadTiff();},scene.payload);
  const form=page.locator('.mapApplication.satlitAir');
  try{await form.waitFor({state:'visible',timeout:60000});}catch(e){
    if(await casLoginState(page)==='anonymous')throw Object.assign(new Error('신청서 준비 중 로그인이 만료됐습니다.'),{code:'LOGIN_REQUIRED'});throw e;
  }
  // Use real site inputs and their click handlers. Never fabricate order IDs or form bands.
  const level=form.locator('input[name=saltitLevel][value=L2G]');if(await level.count())await setCasChecked(level,true);
  const inputs=form.locator('input[name^=saltitBand]');
  if(!await inputs.count())throw new Error('신청서에 영상 밴드가 없습니다. 로그인·영상 제공 상태를 확인하세요.');
  for(let i=0;i<await inputs.count();i++){
    const input=inputs.nth(i),value=await input.getAttribute('value');
    if(['R_PS','G_PS','B_PS'].includes(value)){await setCasChecked(input,true);}
    else if(await input.isChecked())await setCasChecked(input,false);
  }
  const bands=await form.locator('.catalog.list li').evaluateAll(es=>es.map(e=>({band:e.dataset.band,id:e.dataset.id,level:e.dataset.level})));
  if(bands.length!==3||!['R_PS','G_PS','B_PS'].every(b=>bands.some(v=>v.band===b&&v.id===scene.id&&v.level==='L2G')))
    throw new Error('RGB PS 3개 밴드 선택을 검증하지 못했습니다. 자동 신청을 중단합니다.');
  return rememberCasApplication(page);
}
export async function setCasChecked(input,checked){
  // Decorative <i> covers the native input. Native click still runs the site's handlers.
  await input.evaluate((el,checked)=>{if(el.disabled)throw new Error('Disabled application option');if(el.checked!==checked)el.click();},checked);
  if(await input.isChecked()!==checked)throw new Error('Application option did not change state');
}
export async function rememberCasApplication(page,{restore=true}={}){
  // Remember the first user-confirmed form only in page memory. No PII reaches Node/disk.
  return page.evaluate(({restore})=>{
    const root=()=>document.querySelector('.mapApplication.satlitAir');
    const value=s=>root()?.querySelector(s)?.value??'';
    if(!window.zipviewCasMemory){
      const original=satlitAirMap.applyDownloadTiff;
      window.zipviewCasMemory={saved:null,submitted:false};
      satlitAirMap.applyDownloadTiff=function(...args){
        const saved={birth:value('input[name=onBrthdy]'),title:value('#onPurchsTitle'),purpose:value('#onPurchsPurps'),detail:value('input[name=prcuseRealmCn]')};
        if(Object.values(saved).every(Boolean)&&root()?.querySelector('input[name=onChkAgree]#agree')?.checked){window.zipviewCasMemory.saved=saved;window.zipviewCasMemory.submitted=true;}
        return original.apply(this,args);
      };
    }
    if(!window.zipviewCasMemory.saved){
      const current={birth:value('input[name=onBrthdy]'),title:value('#onPurchsTitle'),purpose:value('#onPurchsPurps'),detail:value('input[name=prcuseRealmCn]')};
      if(Object.values(current).every(Boolean)&&root()?.querySelector('input[name=onChkAgree]#agree')?.checked)window.zipviewCasMemory.saved=current;
    }
    if(!restore)return Boolean(window.zipviewCasMemory.saved);
    window.zipviewCasMemory.submitted=false;
    const saved=window.zipviewCasMemory.saved;if(!saved)return false;
    $('input[name=onBrthdy]',root()).val(saved.birth).trigger('change');
    $('#onPurchsTitle',root()).val(saved.title);fnDetailCode(saved.purpose);
    $('input[name=prcuseRealmCn]',root()).val(saved.detail).trigger('change');
    return true;
  },{restore});
}
export async function submitRememberedCas(page){
  await page.waitForFunction(()=>{
    const r=document.querySelector('.mapApplication.satlitAir'),m=window.zipviewCasMemory?.saved;
    return m&&r?.querySelector('#onPurchsPurps')?.value===m.purpose;
  },null,{timeout:30000});
  const form=page.locator('.mapApplication.satlitAir');
  await setCasChecked(form.locator('input[name=onChkAgree]#agree'),true);
  if(!await form.locator('input[name=onChkAgree]#agree').isChecked())throw new Error('Agreement not checked');
  await form.getByRole('button',{name:'다운로드',exact:true}).click();
}
const startedPrograms=new WeakMap();
export async function startCasTransferProgram(context,opener,scene,inbox){
  if(!inbox)return;
  for(const p of context.pages()){
    if(p.isClosed()||p===opener||await p.opener()!==opener||startedPrograms.get(p)===scene.id)continue;
    if(!['https://map.ngii.go.kr','https://nlippd.ngii.go.kr'].includes(new URL(p.url()).origin))continue;
    const text=await p.locator('body').innerText().catch(()=> '');
    const normalized=text.replaceAll('\\','/').toLowerCase();
    if(!normalized.includes(inbox.replaceAll('\\','/').toLowerCase())||!text.includes(scene.id))continue;
    const button=p.getByText('전송시작',{exact:true});
    if(await button.count()===1&&await button.isVisible()&&await button.isEnabled()){
      await button.click();startedPrograms.set(p,scene.id);
    }
  }
}
export async function startCasTransfer(context,opener,scene,attempted,inbox=null){
  await startCasTransferProgram(context,opener,scene,inbox);
  for(const p of context.pages()){
    if(p.isClosed()||p===opener||attempted.has(p)||await p.opener()!==opener)continue;
    const url=new URL(p.url());if(!['https://map.ngii.go.kr','https://nlippd.ngii.go.kr'].includes(url.origin))continue;
    const text=await p.locator('body').innerText().catch(()=> '');
    const filenames=text.match(/C1_\d{14}_\d+_\d+_L2G_[A-Za-z_]+\.(?:tif|xml)/g)??[];
    const allowed=['R_PS.tif','G_PS.tif','B_PS.tif','Aux.xml'].map(s=>scene.id+'_L2G_'+s);
    if(!allowed.slice(0,3).every(f=>filenames.includes(f))||filenames.some(f=>!allowed.includes(f)))continue;
    // An open Innorix transfer dialog means the user already started this request.
    if(await p.locator('.irx_transferWin_wrapper').isVisible().catch(()=>false)){attempted.add(p);continue;}
    const button=p.getByRole('button',{name:/^전체\s*다운로드$/});
    if(await button.count()===1&&await button.isVisible()&&await button.isEnabled()){attempted.add(p);await button.click();}
  }
}
export function parseCasTransferProgress(text){
  const m=text.match(/([\d,.]+)\s*(KB|MB|GB)\s*\/\s*([\d,.]+)\s*(KB|MB|GB)/i);
  if(!m)return null;
  const bytes=(v,u)=>Number(v.replaceAll(',',''))*({KB:1024,MB:1024**2,GB:1024**3}[u.toUpperCase()]);
  return {transferredBytes:bytes(m[1],m[2]),totalBytes:bytes(m[3],m[4]),active:/파일\s*전송\s*중/.test(text)};
}
export async function readCasTransferProgress(context,opener,scene){
  if(!scene?.id)return null;
  for(const p of context.pages()){
    if(p.isClosed()||p===opener||await p.opener()!==opener)continue;
    if(!['https://map.ngii.go.kr','https://nlippd.ngii.go.kr'].includes(new URL(p.url()).origin))continue;
    const text=await p.locator('body').innerText().catch(()=>'');
    const ids=text.match(/C1_\d{14}_\d+_\d+(?=_L2G_)/g)??[];
    if(!ids.length||ids.some(id=>id!==scene.id))continue;
    const progress=parseCasTransferProgress(text);
    if(progress?.active)return progress;
  }return null;
}
export {pause,watchBrowserDownloads,startTransferPopup};
