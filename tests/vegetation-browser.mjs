import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'chrome',headless:true});
const output=process.argv[2] || 'verification/satellite-vegetation';
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(output,'review.html')).href);
 await page.waitForFunction(()=>document.querySelector('#stats').textContent.includes('west-sports-2024'));
 assert.equal(await page.locator('#region option').count(),12);
 await page.locator('#original').check();
 await page.locator('#zoom').selectOption('.5');
 assert.equal(await page.locator('canvas').evaluate(c=>c.style.width),'2048px');
 await page.locator('#original').uncheck();
 await page.locator('#grass').uncheck();
 await page.locator('#canopy').uncheck();
 await page.locator('#region').selectOption('south-rail-yard-2024');
 await page.waitForFunction(()=>document.querySelector('#stats').textContent.includes('south-rail-yard-2024'));
 await page.locator('#canopy').check();await page.locator('#grass').check();
 await page.locator('#zoom').selectOption('.25');
 await page.screenshot({path:path.join(output,'browser-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(output,'browser-mobile.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS: 12 regions, original/layers, zoom, region switching, desktop/mobile; no page errors');
} finally {await browser.close()}
