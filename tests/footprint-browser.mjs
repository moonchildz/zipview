import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mockGroundImagery} from './imagery-fixture.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await mockGroundImagery(page);
  await page.goto(base+'/?site=sinchon');
  const selector='#review-map [data-building-id="ngii:sinchon-prugio:209"]';
  await page.waitForSelector(selector,{state:'attached'});
  const parts=page.locator(selector);
  assert.equal(await parts.count(),2);
  await parts.first().evaluate(e=>e.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(await page.locator(selector+'.selected').count(),2);
  assert.match(await page.locator('#review-building-facts').innerText(),/수치지도.*11.52m/);
  await page.evaluate(()=>{
    const original=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{if(blob.type.includes('kml'))window.kmlText=blob.text();return original(blob);};
    document.querySelector('#review-kml').click();
  });
  const kml=await page.evaluate(()=>window.kmlText);
  assert.match(kml,/MultiGeometry/);assert.deepEqual(errors,[]);
  await page.goto(base+'/research/linkage/generated/footprint-review.html');
  await page.screenshot({path:'verification/footprint-review.png',fullPage:true});
  console.log('Multipart 209 inspector, KML and source comparison passed');
}finally{await browser.close();}
