import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5174';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Simulate an older browser catalog. The collection endpoint and its files are real.
  await page.route('**/research/linkage/generated/catalog.json',async route=>{
    const response=await route.fetch(),catalog=await response.json();
    const target=catalog.complexes.find(c=>c.kbId==='1475');assert.ok(target);
    delete target.kbId;catalog.plans=catalog.plans.filter(p=>p.complexId!==target.id);
    await route.fulfill({json:catalog});
  });
  await page.goto(base+'/');await page.waitForSelector('#saved-list a');
  await page.fill('[name="address"]','통일로48가길 37');
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/api/address-pipeline'));
  await page.click('#linkage-form button');
  const response=await responsePromise;assert.equal(response.status(),200);
  const data=await response.json();assert.equal(data.result.complex.providerId,'1475');
  assert.equal(data.result.complex.imageCount,2);
  await page.waitForFunction(()=>!document.querySelector('#linkage-form button').disabled);
  assert.equal(await page.locator('.provider-plans img').count(),2);
  await page.waitForFunction(()=>[...document.querySelectorAll('.provider-plans img')].every(i=>i.complete&&i.naturalWidth>0));
  await page.unroute('**/research/linkage/generated/catalog.json');
  let repeatedRequests=0;await page.route('**/api/address-pipeline',route=>{repeatedRequests++;return route.abort();});
  await page.reload();await page.waitForSelector('.provider-plans img');
  const current=await page.request.get(base+'/research/linkage/generated/catalog.json');
  assert.equal(current.headers()['cache-control'],'no-store');
  assert.deepEqual(await current.json(),JSON.parse(await readFile('research/linkage/generated/catalog.json','utf8')));
  assert.equal(await page.locator('.provider-plans img').count(),2);
  assert.equal(repeatedRequests,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:'real collection endpoint and refresh persistence',providerId:'1475',images:2,externalRequests:data.result.requests,cacheHits:data.result.cacheHits,repeatedRequests}));
}finally{await browser.close();}
