import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {installApplicationMemory,openApplication} from '../scripts/ngii-browser.mjs';

test('restarted browser submits prefilled portal application without another manual click',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<div class="mapApplication online">
      <input name="onBrthdy" value="20000101">
      <select id="onPurchsPurps"><option value="">선택하세요</option><option value="CAAAC00002" selected>지도서비스</option></select>
      <input name="onDetailCn" value=""><label><input id="agree" name="onChkAgree" type="checkbox">동의</label>
      <button type="button" onclick="fnDownloadNRM('1','online')">다운로드</button>
    </div>`);
    await page.evaluate(()=>{
      window.downloadMapData=()=>{};
      window.fnDownloadNRM=()=>{window.__submitted=(window.__submitted||0)+1;};
      window.fnFileDownload=()=>{};
    });
    page.waitForResponse=async predicate=>{
      const response={url:()=> 'https://map.ngii.go.kr/pd/shbtManage/shbtInsertNRM.do',
        request:()=>({method:()=> 'POST'}),ok:()=>true,status:()=>200,
        json:async()=>({resultCode:'1',allDataMap:{orderDownList:[]}})};
      assert.equal(predicate(response),true);
      return response;
    };
    await openApplication(page,[{payload:{mapScale:'1000',mapNo:'376121861'}}]);
    assert.equal(await page.evaluate(()=>window.__submitted),1);
    assert.equal(await page.locator('#agree').isChecked(),true);
  }finally{await browser.close();}
});

test('server rejection is not counted as an accepted application',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<div class="mapApplication online">
      <input name="onBrthdy" value="20000101">
      <select id="onPurchsPurps"><option value="CAAAC00002" selected>지도서비스</option></select>
      <label><input id="agree" name="onChkAgree" type="checkbox">동의</label>
      <button type="button" onclick="fnDownloadNRM('1','online')">다운로드</button>
    </div>`);
    await page.evaluate(()=>{window.downloadMapData=()=>{};window.fnDownloadNRM=()=>{};window.fnFileDownload=()=>{};});
    page.waitForResponse=async()=>({ok:()=>true,status:()=>200,json:async()=>({resultCode:'0'})});
    await assert.rejects(openApplication(page,[{payload:{mapScale:'1000',mapNo:'376121865'}}]),
      error=>error.code==='APPLICATION_REJECTED');
  }finally{await browser.close();}
});

test('application memory does not invent missing profile details',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<div class="mapApplication online">
      <input name="onBrthdy"><select id="onPurchsPurps"><option value="">선택하세요</option></select>
      <label><input id="agree" name="onChkAgree" type="checkbox">동의</label>
    </div>`);
    await page.evaluate(()=>{window.fnDownloadNRM=()=>{};window.fnFileDownload=()=>{};});
    await installApplicationMemory(page);
    assert.equal(await page.evaluate(()=>window.zipviewNgii.fill()),false);
    assert.equal(await page.locator('#agree').isChecked(),false);
  }finally{await browser.close();}
});
