import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startCasTransferProgram} from '../scripts/cas-browser.mjs';
import {readCasTransferProgress} from '../scripts/cas-browser.mjs';
test('progress ignores a completed older scene popup before the current transfer',async()=>{
  const opener={};
  const previous='C1_20240611014916_17892_00718251',current='C1_20240606014634_17816_00340169';
  const popup=text=>({isClosed:()=>false,opener:async()=>opener,url:()=> 'https://nlippd.ngii.go.kr/transfer',locator:()=>({innerText:async()=>text})});
  const old=popup(previous+'_L2G_R_PS.tif 4.82 GB/4.82 GB 파일 전송 중');
  const active=popup(current+'_L2G_R_PS.tif 100 MB/5.24 GB 파일 전송 중');
  const context={pages:()=>[old,active]};
  assert.equal((await readCasTransferProgress(context,opener,{id:current})).transferredBytes,100*1024**2);
  assert.equal(await readCasTransferProgress({pages:()=>[old]},opener,{id:current}),null);
  assert.equal(await readCasTransferProgress(context,opener),null);
});
test('transfer program checks the scene and destination and starts only once',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();
    await context.route('https://map.ngii.go.kr/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
    const page=await context.newPage();await page.goto('https://map.ngii.go.kr/fixture');
    const [popup]=await Promise.all([page.waitForEvent('popup'),page.evaluate(()=>{window.open('/transfer');})]);
    await popup.waitForLoadState('domcontentloaded');
    const scene={id:'C1_fixture'},inbox='C:/downloads/satellite';
    const button='<button onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1)">전송시작</button>';
    await popup.setContent(scene.id+' C:/wrong'+button);
    await startCasTransferProgram(context,page,scene,inbox);
    assert.equal(await popup.locator('body').getAttribute('data-clicks'),null);
    await popup.setContent('wrong_scene '+inbox+button);
    await startCasTransferProgram(context,page,scene,inbox);
    assert.equal(await popup.locator('body').getAttribute('data-clicks'),null);
    await popup.setContent(scene.id+' '+inbox+button);
    await startCasTransferProgram(context,page,scene,inbox);
    await startCasTransferProgram(context,page,scene,inbox);
    assert.equal(await popup.locator('body').getAttribute('data-clicks'),'1');
  }finally{await browser.close();}
});
import {searchCas,startCasTransfer,setCasChecked,parseCasTransferProgress,casLoginState,prepareCasApplication,casKeepaliveTick} from '../scripts/cas-browser.mjs';
test('catalog uses site date parameter names and refuses a server ignoring them',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();let request,rows=[];
    await page.route('https://map.ngii.go.kr/**',async route=>{
      if(route.request().method()==='POST'){request=new URLSearchParams(route.request().postData());await route.fulfill({json:rows});}
      else await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture</title>'});
    });
    await page.goto('https://map.ngii.go.kr/fixture');
    const query={bounds:[126,37,127,38],start:'2025-01-01',end:'2025-02-01'};
    assert.deepEqual(await searchCas(page,query),[]);
    assert.equal(request.get('stDate'),query.start);assert.equal(request.get('edDate'),query.end);
    assert.equal(request.get('searchType'),'SPCE');assert.ok(request.get('geometry').includes('126 37'));
    rows=[{CATALOGTYPE:'L2G',CATALOGID:'C1_20211024021358_03282_00201284'}];
    await assert.rejects(searchCas(page,query),/ignored requested date/);
  }finally{await browser.close();}
});
test('transfer progress parses bytes without exposing file or form details',()=>{
  assert.deepEqual(parseCasTransferProgress('3% (139.73 MB/5.24 GB) 파일 전송 중입니다.'),{transferredBytes:139.73*1024**2,totalBytes:5.24*1024**3,active:true});
  assert.equal(parseCasTransferProgress('다운로드 대기'),null);
});
test('expired login blocks application before opening its form',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();let loggedIn=false;
    await page.route('https://map.ngii.go.kr/**',route=>route.request().method()==='POST'?route.fulfill({json:{isLogin:loggedIn}}):route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture</title>'}));
    await page.goto('https://map.ngii.go.kr/fixture');
    assert.equal(await casLoginState(page),'anonymous');
    await assert.rejects(prepareCasApplication(page,{payload:{}}),e=>e.code==='LOGIN_REQUIRED');
    loggedIn=true;assert.equal(await casLoginState(page),'authenticated');
    await page.setContent('<input value="unchanged"><script>window.moves=0;window.clicks=0;document.addEventListener("mousemove",()=>window.moves++);document.addEventListener("click",()=>window.clicks++);</script>');
    assert.equal((await casKeepaliveTick(page)).authState,'authenticated');
    const activity=await page.evaluate(()=>({moves:window.moves,clicks:window.clicks,value:document.querySelector('input').value}));
    assert.ok(activity.moves>0);assert.equal(activity.clicks,0);assert.equal(activity.value,'unchanged');
  }finally{await browser.close();}
});
test('decorated checkbox runs native change handlers despite an overlaid icon',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{const page=await browser.newPage();await page.setContent('<label style="position:relative"><input type="checkbox" onchange="document.body.dataset.changed=String(this.checked)"><i style="position:absolute;inset:0;background:red"></i></label>');
    const input=page.locator('input');await setCasChecked(input,true);assert.equal(await page.locator('body').getAttribute('data-changed'),'true');
    await setCasChecked(input,false);assert.equal(await page.locator('body').getAttribute('data-changed'),'false');
  }finally{await browser.close();}
});
test('transfer starts only for a trusted popup listing exactly the planned bands',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext();await context.route('https://map.ngii.go.kr/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture</title>'}));
    const page=await context.newPage();await page.goto('https://map.ngii.go.kr/fixture');
    const [popup]=await Promise.all([page.waitForEvent('popup'),page.evaluate(()=>{window.open('/transfer');})]);
    await popup.waitForLoadState('domcontentloaded');
    const scene={id:'C1_20211024021358_03282_00201284'},attempted=new WeakSet();
    const button='<button onclick="document.body.dataset.clicked=\'yes\'">전체 다운로드</button>';
    await popup.setContent('unrelated file'+button);
    await startCasTransfer(context,page,scene,attempted);assert.equal(await popup.locator('body').getAttribute('data-clicked'),null);
    await popup.setContent(['R_PS','G_PS','B_PS'].map(b=>scene.id+'_L2G_'+b+'.tif').join(' ')+button);
    await startCasTransfer(context,page,scene,attempted);assert.equal(await popup.locator('body').getAttribute('data-clicked'),'yes');
  }finally{await browser.close();}
});
