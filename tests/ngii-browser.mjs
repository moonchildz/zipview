// Integration test: real public NGII JS/DOM, intercepted login/application/transfer.
// No real authentication, orders, or third-party downloads are performed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {chromium} from 'playwright';
import {MAP_URL,ensureLogin,openApplication,watchBrowserDownloads,startTransferPopup,pause} from '../scripts/ngii-browser.mjs';
import {normalizeSheet,reconcileFiles} from '../scripts/ngii-files.mjs';
import {rawSheet,xml,zipFixture} from './ngii-fixture.mjs';

const output=await fs.mkdtemp(path.join(os.tmpdir(),'zipview-ngii-browser-'));
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
try {
  const context=await browser.newContext();
  let requests=0,forms=0,loginChecks=0,secondFormAt=0;const errors=[];
  const fileBase='(B010)수치지도_376082071_2025_test';
  await context.route('**/mn/loginCheck.do',r=>r.fulfill({json:{isLogin:++loginChecks>1}}));
  // Block every application/transfer path unless explicitly handled below.
  await context.route('**/pd/**',async route=> {
    const url=new URL(route.request().url());
    if(url.pathname==='/pd/shbtManage/dowloadRequestForm.do') {
      forms++;
      if(forms===2)secondFormAt=Date.now();
      const delayedReset=forms===2?`<script>setTimeout(()=>{document.querySelector('#agree').checked=false;document.querySelector('input[name=onBrthdy]').value='';},600)</script>`:'';
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<input name="onBrthdy"><select id="onPurchsPurps"><option value="">선택</option><option value="BAAAC00008">기타</option></select><input name="onDetailCn"><input type="radio" name="onChkAgree" id="agree">${delayedReset}`});
    } else if(url.pathname==='/pd/shbtManage/shbtInsertNRM.do') {
      requests++;
      if(requests===2)assert.ok(Date.now()-secondFormAt>=1400,'Wait for delayed form reset and stable consent before submission');
      const data=new URLSearchParams(route.request().postData());
      assert.equal(data.get('brthdy'),'20000101');assert.equal(data.get('detailCn'),'test fixture');
      assert.equal(data.get('data[0][orderTp]'),'3');assert.equal(data.get('data[0][mapScale]'),'1000');
      await route.fulfill({json:{resultCode:'1',allDataMap:{orderDownList:'test-only',unityOrderNo:'test-only'}}});
    } else if(url.pathname==='/pd/purchs/download.do') {
      const files=[{ext:'zip',base64:zipFixture().toString('base64')},{ext:'xml',base64:Buffer.from(xml).toString('base64')}];
      await route.fulfill({contentType:'text/html; charset=utf-8',body:`<script>async function transfer(){for(const f of ${JSON.stringify(files)}){const bytes=Uint8Array.from(atob(f.base64),c=>c.charCodeAt(0));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes]));a.download='${fileBase}.'+f.ext;document.body.append(a);a.click();await new Promise(r=>setTimeout(r,500));}}</script><button onclick="transfer()">전체 다운로드</button>`});
    } else await route.abort();
  });
  watchBrowserDownloads(context,output,message=>errors.push(message));
  const page=await context.newPage();
  await page.goto(MAP_URL,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof downloadMapData==='function'&&typeof mapQuery!=='undefined');
  await page.evaluate(()=>{window.fixtureLoginPrompts=0;window.fnLogin=()=>window.fixtureLoginPrompts++;});
  await ensureLogin(page);
  assert.equal(await page.evaluate(()=>window.fixtureLoginPrompts),1);
  const sheet=normalizeSheet(rawSheet,'서대문구');
  await openApplication(page,[sheet]);
  assert.equal(requests,0,'The first application must wait for user input');
  await page.locator('input[name=onBrthdy]').fill('20000101');
  await page.locator('#onPurchsPurps').selectOption('BAAAC00008');
  await page.locator('input[name=onDetailCn]').fill('test fixture');
  await page.locator('#agree').check();
  await page.locator('.mapApplication.online').getByRole('button',{name:'다운로드',exact:true}).click();
  await page.waitForFunction(()=>window.zipviewNgii.state().opened);
  assert.equal(requests,1);
  const attempted=new WeakSet();
  for(let i=0;i<40&&sheet.status!=='verified';i++) {
    await startTransferPopup(context,attempted);await pause(250);await reconcileFiles([sheet],output);
  }
  assert.deepEqual(errors,[]);
  assert.equal(sheet.status,'verified',JSON.stringify({files:await fs.readdir(output),pages:context.pages().map(p=>p.url())}));
  loginChecks=0;await ensureLogin(page);
  assert.equal(await page.evaluate(()=>window.fixtureLoginPrompts),2,'Session expiry should request authentication again');
  await page.evaluate(()=>{
    const prior=window.zipviewNgii;
    // Simulate upgrading an already open tab with the first-generation memory API.
    window.zipviewNgii={state:()=>prior.state(),fill:()=>prior.fill()};
  });
  // Second form must reuse inputs and submit automatically, through the site's handler.
  await openApplication(page,[sheet]);
  await page.waitForFunction(()=>window.zipviewNgii.state().opened);
  assert.equal(forms,2);assert.equal(requests,2);
  assert.equal(await page.evaluate(()=>window.zipviewNgii.version),2);
  assert.deepEqual(await page.evaluate(()=>Object.keys(window.zipviewNgii.state()).sort()),['opened','reusable','submitted']);
  console.log('NGII browser integration passed: manual first form, automatic next batch, popup, ZIP/XML download and verification. (Mock authentication/orders)');
} finally {await browser.close();await fs.rm(output,{recursive:true,force:true});}
