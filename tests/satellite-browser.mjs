import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[];
try {
  for(const viewport of [{width:1440,height:1050},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(resolve('verification/satellite-facilities/review.html')).href);
    await page.waitForFunction(()=>document.querySelector('#canvas').width===4096);
    assert.equal(await page.locator('#counts tr').count(),15);
    await page.selectOption('#cls','tennis court');
    await page.waitForFunction(()=>document.querySelector('#sheet').complete && document.querySelector('#sheet').naturalWidth>0);
    assert.match(await page.locator('#status').textContent(),/25개/);
    await page.locator('#score').evaluate(el=>{el.value='0.5';el.dispatchEvent(new Event('input'))});
    assert.match(await page.locator('#status').textContent(),/24개/);
    await page.selectOption('#zoom','1');
    assert.equal(await page.locator('#canvas').evaluate(el=>el.getBoundingClientRect().width),4096);
    await page.selectOption('#zoom','0.25');
    await page.screenshot({path:`verification/satellite-facilities/review-${viewport.width}.png`});
    await page.selectOption('#mode','open');
    await page.waitForFunction(()=>current?.mode==='open');
    assert.equal(await page.locator('#counts tr').count(),30);
    await page.selectOption('#cls','playground');
    assert.match(await page.locator('#status').textContent(),/0개/);
    assert.match(await page.locator('#assessment').textContent(),/실패/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.selectOption('#region','east-stadium-2024');
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('east-stadium-2024'));
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('Satellite review passed: desktop/mobile, both models, class and score filters, zoom, region switch, local image loading.');
} finally {await browser.close()}
