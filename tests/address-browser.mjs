import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true}),base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
await mkdir('verification',{recursive:true});
try{for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let requests=0;await page.route('**/api/address-pipeline',route=>{requests++;return route.fulfill({json:{result:{status:'address-not-found',total:0,candidates:[]}}});});
  await page.goto(base+'/');await page.waitForFunction(()=>document.querySelector('#coverage')?.textContent.includes('세대 연결'));
  assert.ok(await page.locator('#saved-list a').count()>=4);
  assert.match(await page.locator('#coverage').innerText(),/전수 연결 0개 단지/);
  assert.match(await page.locator('#saved-list').innerText(),/연결 미완료/);
  await page.screenshot({path:`verification/address-home-${width}.png`,fullPage:true});
  async function search(address,building='',unit=''){
    for(const [name,value]of Object.entries({address,building,unit}))await page.fill(`[name="${name}"]`,value);
    await page.click('#linkage-form button');await page.waitForFunction(()=>!document.querySelector('#linkage-form button').disabled);
  }
  await search('서울 종로구 송월길 99 209동 1201호');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'linked');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 84A/);
  assert.equal(await page.getByRole('link',{name:'국토부 호별 원자료'}).count(),1);
  assert.ok(await page.locator('.provider-plans img').count()>=28);
  assert.equal(await page.getByRole('link',{name:'연결된 데모 보기'}).count(),0);
  await page.waitForFunction(()=>document.querySelector('#selected-plan img')?.naturalWidth>0);
  assert.match(await page.locator('#selected-plan img').getAttribute('alt'),/84A/);
  await page.screenshot({path:`verification/address-plans-${width}.png`,fullPage:false});
  await search('서울 종로구 송월길 99','209','1204');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 84B/);
  await search('서울 종로구 송월길 99','209','1203');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'linked');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 84C/);
  for(const [building,unit,type] of [['206','503','101A'],['204','604','84B']]){
    await search('서울 종로구 송월길 99',building,unit);
    assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'linked');
    assert.ok((await page.locator('#linkage-result').innerText()).includes(`연결 타입: ${type}`));
    await page.waitForFunction(()=>document.querySelector('#selected-plan img')?.naturalWidth>0);
    assert.ok((await page.locator('#selected-plan img').getAttribute('alt')).includes(type));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await search('서울 종로구 송월길 99','210','501');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'linked');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 59C/);
  await search('서울 종로구 송월길 99','204','504');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'unit-not-found');
  assert.equal(await page.locator('#selected-plan').count(),0);
  await search('평창문화로 140');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'complex-found');
  assert.equal(await page.locator('.provider-plans img').count(),0);
  assert.match(await page.locator('#linkage-result').innerText(),/원본 이미지 미확보/);
  await search('평창동 596');
  assert.equal(await page.locator('.provider-plans img').count(),1);
  await page.waitForFunction(()=>[...document.querySelectorAll('.provider-plans img')].every(i=>i.complete&&i.naturalWidth>0));
  assert.equal(requests,0,'saved addresses and plan galleries never require provider access');
  await search('평창');assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'address-candidates');
  assert.equal(requests,0,'partial input requests a local choice, not provider collection');
  // An unseen address must invoke the pipeline instead of stopping at the local index.
  await search('검증용 미등록 주소 999');assert.equal(requests,1);assert.match(await page.locator('#linkage-result').innerText(),/찾지 못했습니다/);
  assert.equal(await page.locator('.provider-plans img').count(),0);
  await search('서울특별시 종로구 사직로8길 34');assert.equal(requests,2);
  assert.match(await page.locator('#linkage-result').innerText(),/경희궁의아침/,'failed collection retains known local complex');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);await page.close();
}console.log('Address browser: PC/mobile, default search, offline road/lot aliases, plan gallery, line candidates, absent image, collection failure and stale-result removal passed');}finally{await browser.close();}
