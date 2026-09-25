import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const site=['xi','yangjae','han'].includes(process.argv[2])?process.argv[2]:'northwest',out=`verification/${site}-grove`;
try{const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5176/northwest-grove.html?site='+site);await page.waitForFunction(()=>!!window.northwestReview,{},{timeout:120000});
const report=await page.evaluate(()=>({trees:northwestReview.scene.getObjectByName('vegetation').userData.treeCount,buildings:northwestReview.data.buildings.length,registration:northwestReview.data.registration}));
assert.ok(report.trees>0);assert.ok(report.buildings>0);assert.equal(report.registration.status,'provisional');
if(['yangjae','han'].includes(site)){assert.ok(await page.evaluate(()=>northwestReview.scene.getObjectByName('water-candidates').visible));await page.locator('#water').uncheck();assert.equal(await page.evaluate(()=>northwestReview.scene.getObjectByName('water-candidates').visible),false);await page.locator('#water').check();}
assert.equal(await page.evaluate(()=>northwestReview.scene.getObjectByName('low-vegetation-3d').visible),true);
await page.locator('#low').uncheck();assert.equal(await page.evaluate(()=>northwestReview.scene.getObjectByName('low-vegetation-3d').visible),false);
await page.locator('#low').check();await page.locator('#lowMode').selectOption('mask');assert.equal(await page.evaluate(()=>northwestReview.scene.getObjectByName('low-vegetation-candidates').visible),true);await page.locator('#lowMode').selectOption('3d');await page.locator('#lowThreshold').selectOption('050');assert.ok((await page.locator('#lowStatus').textContent()).includes('도로 제외'));await page.locator('#lowThreshold').selectOption('035');
await page.screenshot({path:out+'/oblique.png',fullPage:true});
assert.ok(await page.evaluate(()=>northwestReview.data.terrain.max>northwestReview.data.terrain.min+10));
await page.locator('#terrain').uncheck();await page.locator('#terrain').check();
await page.locator('#trees').uncheck();await page.locator('#top').click();await page.waitForTimeout(400);await page.screenshot({path:out+'/top.png',fullPage:true});
await page.locator('#trees').check();await page.locator('#height').selectOption('.5');await page.locator('#maps').uncheck();await page.locator('#photo').uncheck();await page.locator('#oblique').click();await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await page.screenshot({path:out+'/mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
}finally{await browser.close()}
