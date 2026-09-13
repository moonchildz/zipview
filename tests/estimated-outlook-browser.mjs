import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {mockGroundImagery} from './imagery-fixture.mjs';
const base=process.env.TEST_BASE_URL??'http://127.0.0.1:5173';
const catalog=JSON.parse(readFileSync('research/linkage/generated/catalog.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});mkdirSync('verification',{recursive:true});
try{
  for(const width of [1440,390]){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const requests=await mockGroundImagery(page);
    for(const [address,building,unit] of [['gyeonghuigung-xi','209','101'],['sinchon-prugio','209','101'],['서울특별시 성북구 성북로4길 52','205','1201']]){
      await page.goto(`${base}/?${new URLSearchParams({site:'catalog',address,building,unit})}`);
      await page.locator('#estimated-view-link').click();
      await page.waitForSelector('#outlook-host[data-estimated="true"]');
      const dataset=await page.locator('#outlook-host').evaluate(e=>({...e.dataset}));
      const row=catalog.units.find(u=>u.complexId===dataset.complex&&u.building===building&&u.unit===unit);
      assert.equal(dataset.selectedBuilding,building);assert.equal(dataset.selectedUnit,unit);
      assert.ok(Math.abs(Number(dataset.cameraHeights.split(',')[0])-row.elevation.eyeElevation)<.011);
      assert.equal(dataset.horizontalFov,'50.00');
      await page.locator('.calibration > summary').click();
      await page.locator('#floor-height').fill('3');await page.locator('#floor-height').dispatchEvent('input');
      const expected=row.geometry.base+(row.elevation.floor-1)*3+1.5;
      assert.ok(Math.abs(Number((await page.locator('#outlook-host').getAttribute('data-camera-heights')).split(',')[0])-expected)<.011);
      await page.locator('#outlook-reset').click();
      await page.locator('.calibration > summary').click();
      assert.equal(await page.locator('#floor-height').inputValue(),'2.9');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile horizontal overflow');
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:`verification/elevation-${dataset.complex.replace(':','-')}-${building}-${width}.png`});
    }
    assert.ok(requests.every(r=>r.pathname.startsWith('/api/imagery/static/')));
    assert.ok(new Set(requests.map(r=>`${r.searchParams.get('lon')},${r.searchParams.get('lat')}`)).size>=3,'each selected complex uses its own location');
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Estimated exterior views: catalog routing, exact selected-building elevation, edits/reset, imagery site and 50° FOV passed on desktop/mobile');
}finally{await browser.close();}
