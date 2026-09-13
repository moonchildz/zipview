import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5173';
try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    for(const [unit,type] of [['204','34B'],['205','34A'],['206','49A']]){
      await page.goto(`${base}/?site=sinchon&building=203&unit=${unit}`);
      await page.waitForSelector(`#canvas-host[data-model="sinchon-prugio/sh-rental-${type}"]`);
      await page.getByRole('tab',{name:'평면도',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#reference-image').naturalWidth===1654);
      assert.equal(await page.locator('#cropped-reference').isVisible(),true);
      await page.locator('#plan-openings g[data-window="living"]').click();
      await page.waitForSelector('#canvas-host[data-window="living"]');
      assert.equal(await page.locator('#canvas-host').getAttribute('data-scale-source'),'printed-dimension-raster-estimate');
      const png=PNG.sync.read(await page.locator('#canvas-host canvas').screenshot());
      assert.ok(new Set(png.data).size>60,'nonblank interior');
      await page.screenshot({path:`verification/sh-203-${unit}-${width}.png`});
    }
    for(const [building,unit] of [['207','101'],['210','101']]){
      await page.goto(`${base}/?site=sinchon&building=${building}&unit=${unit}`);
      await page.waitForSelector('#canvas-host[data-scale-source="cross-source-dimension-estimate"]');
      assert.equal(await page.locator('#calibration-evidence').isVisible(),true);
      const r=await page.request.get(new URL(await page.locator('#calibration-evidence').getAttribute('href'),base).href);
      assert.equal(r.status(),200);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('SH rental source/model/window and scoped metric calibration: PC/mobile passed');
}finally{await browser.close();}
