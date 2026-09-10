import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true}),base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
try{for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?site=catalog');await page.waitForFunction(()=>document.querySelector('#coverage')?.textContent.includes('세대 연결'));
  async function search(address,building='',unit=''){
    for(const [name,value]of Object.entries({address,building,unit}))await page.fill(`[name="${name}"]`,value);
    await page.click('#linkage-form button');await page.waitForFunction(()=>!document.querySelector('#linkage-form button').disabled);
  }
  await search('서울 종로구 송월길 99 209동 1201호');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'image-line-candidate');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 84A/);
  assert.equal(await page.getByRole('link',{name:'판독 근거: 원본 배치도'}).count(),1);
  assert.ok(await page.locator('.provider-plans img').count()>=28);
  assert.equal(await page.getByRole('link',{name:'연결된 데모 보기'}).count(),0);
  await page.waitForFunction(()=>[...document.querySelectorAll('.provider-plans img')].some(i=>i.naturalWidth>0));
  await search('서울 종로구 송월길 99','209','1204');
  assert.match(await page.locator('#linkage-result').innerText(),/연결 타입: 84B/);
  await search('서울 종로구 송월길 99','209','1203');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'unit-unlinked');
  await search('부산 해운대구 마린시티2로 38','1','301');
  assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'linked');
  assert.equal(await page.locator('.provider-plans img').count(),0);
  assert.match(await page.locator('#linkage-result').innerText(),/원본 이미지 미확보/);
  // An unseen address must invoke the pipeline instead of stopping at the local index.
  let requests=0;await page.route('**/api/address-pipeline',route=>{requests++;return route.fulfill({json:{result:{status:'address-not-found',total:0,candidates:[]}}});});
  await search('검증용 미등록 주소 999');assert.equal(requests,1);assert.match(await page.locator('#linkage-result').innerText(),/찾지 못했습니다/);
  assert.equal(await page.locator('.provider-plans img').count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);await page.close();
}console.log('Address browser: PC/mobile, full input, Xi plan gallery, Busan unit link, absent image, automatic collection and stale-result removal passed');}finally{await browser.close();}
