// Reproduce authentication reloading the opener during an in-flight session check.
// All requests are intercepted; no real login is performed.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { MAP_URL, ensureLogin, pause } from '../scripts/ngii-browser.mjs';

const browser=await chromium.launch({channel:'chrome',headless:true});
const html=`<!doctype html><script>
window.fixtureReady=false;
window.fnLogin=()=>location.reload();
setTimeout(()=>{window.mapQuery={};window.downloadMapData=()=>{};window.fnDownloadNRM=()=>{};window.fixtureReady=true;},300);
</script>`;
try {
  const context=await browser.newContext();
  await context.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
  const page=await context.newPage();
  let checks=0, observed;
  const checking=new Promise(resolve=>{observed=resolve;});
  await page.route('**/mn/loginCheck.do',async route=> {
    checks++;
    if(checks===1) {
      observed();await pause(600);
      await route.fulfill({json:{isLogin:false}}).catch(()=>{});
    } else await route.fulfill({json:{isLogin:true}});
  });
  await page.goto(MAP_URL);
  const first=ensureLogin(page);
  await checking;
  await page.reload();
  await first;
  assert.ok(checks>=2,'The session check must retry after document replacement');
  assert.equal(page.isClosed(),false);
  assert.equal(await page.evaluate(()=>window.fixtureReady),true);

  // Simulate fnLogin reloading the parent itself, and subsequent script startup.
  checks=0;
  await page.unroute('**/mn/loginCheck.do');
  await page.route('**/mn/loginCheck.do',route=>route.fulfill({json:{isLogin:++checks>1}}));
  await ensureLogin(page);
  assert.ok(checks>=2);
  assert.equal(page.isClosed(),false);
  assert.equal(await page.evaluate(()=>window.fixtureReady),true);

  // A short HTML redirect response is not a reason to close the browser either.
  checks=0;
  await page.unroute('**/mn/loginCheck.do');
  await page.route('**/mn/loginCheck.do',route=>++checks===1
    ? route.fulfill({contentType:'text/html',body:'Redirecting'})
    : route.fulfill({json:{isLogin:true}}));
  await ensureLogin(page);
  assert.ok(checks>=2);assert.equal(page.isClosed(),false);
  console.log('NGII Chrome login navigation passed: in-flight reload, login redirect, script readiness, transient HTML response. Browser stays open.');
} finally {await browser.close();}
