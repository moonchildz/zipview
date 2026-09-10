import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockGroundImagery} from './imagery-fixture.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
try{for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await mockGroundImagery(page);
  await page.goto(base+'/?site=catalog');await page.waitForFunction(()=>document.querySelector('#coverage')?.textContent.includes('세대 연결'));
  async function query(address,building,unit){for(const [k,v] of Object.entries({address,building,unit}))await page.fill(`[name="${k}"]`,v);await page.click('#linkage-form button');}
  await query('경희궁자이 2단지','211','1201');
  assert.match(await page.locator('#linkage-result').innerText(),/84A/);
  await query('경희궁자이 2단지','211','1207');assert.equal(await page.locator('#linkage-result').getAttribute('data-status'),'unit-unlinked');assert.equal(await page.getByRole('link',{name:'연결된 데모 보기'}).count(),0);
  await query('서울대방','101','201');assert.match(await page.locator('#linkage-result').innerText(),/55AH/);
  await query('신촌푸르지오','204','802');assert.match(await page.locator('#linkage-result').innerText(),/84E/);
  await page.getByRole('link',{name:'연결된 데모 보기'}).click();await page.waitForFunction(()=>document.querySelector('#unit-title')?.textContent.includes('802'));
  assert.match(await page.locator('#type-value').innerText(),/84E/);
  await page.goto(base+'/?site=catalog&address=gyeonghuigung-xi&building=211&unit=1202');
  await page.getByRole('link',{name:'연결된 데모 보기'}).click();
  await page.waitForSelector('#outlook-host[data-interior="active"][data-plan-id="84A"]');
  assert.equal(await page.locator('#outlook-host').getAttribute('data-unit-line'),'2');
  assert.equal(await page.locator('#outlook-host').getAttribute('data-selected-building'),'211');
  assert.deepEqual(errors,[]);await page.close();
}console.log('Linkage browser: 1440/390, three complexes, missing unit, two scene routes passed');}finally{await browser.close();}
