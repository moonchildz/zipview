import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {mockGroundImagery} from './imagery-fixture.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1100}});
    await mockGroundImagery(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:5173')+'/?site=xi');
    const host=page.locator('#outlook-host');
    await page.waitForSelector('#outlook-host[data-interior="active"][data-imagery="visible"]');
    const data=()=>host.evaluate(e=>({...e.dataset}));
    const initial=await data();assert.equal(initial.horizontalFov,'50.00');
    assert.equal(await page.locator('#xi-interior-plan-transform').getAttribute('transform'),await page.locator('#xi-plan-image-transform').getAttribute('transform'));
    assert.equal(await page.locator('#xi-observer-plan').getAttribute('data-mirrored'),'true');
    const far=PNG.sync.read(await host.screenshot());
    await page.click('[data-spot="near"]');const near=await data();
    assert.notEqual(initial.cameraXZ,near.cameraXZ);assert.equal(initial.bearing,near.bearing);
    assert.equal(initial.cameraHeights,near.cameraHeights);
    const pixels=PNG.sync.read(await host.screenshot());let changed=0;
    for(let i=0;i<pixels.data.length;i+=4)if(Math.abs(pixels.data[i]-far.data[i])+Math.abs(pixels.data[i+1]-far.data[i+1])>30)changed++;
    assert.ok(changed>1000,'moving inside changes the projected window and outside scene');
    await page.click('[data-spot="living"]');
    const svg=page.locator('#xi-observer-plan');await svg.focus();await page.keyboard.press('ArrowUp');
    assert.notEqual((await data()).interiorPlanPoint,initial.interiorPlanPoint);
    const clickPoint=await page.locator('#xi-interior-plan-transform').evaluate(g=>{
      const p=g.ownerSVGElement.createSVGPoint();p.x=1142;p.y=450;
      const matrix=g.getScreenCTM(),inverse=matrix.inverse();
      const screen=p.matrixTransform(matrix);return {x:screen.x,y:screen.y,tolerance:Math.hypot(inverse.a,inverse.b)+Math.hypot(inverse.c,inverse.d)};
    });
    await page.mouse.click(clickPoint.x,clickPoint.y);
    const clicked=(await data()).interiorPlanPoint.split(',').map(Number);
    assert.ok(Math.hypot(clicked[0]-1142,clicked[1]-450)<=clickPoint.tolerance,`pointer pixel quantization: ${clicked}`);
    await page.selectOption('#floor-a','3');
    assert.ok(Math.abs(+(await data()).cameraHeights.split(',')[0]-+initial.cameraHeights.split(',')[0]-2.9)<.02);
    await page.click('.tabs [data-view="plan"]');assert.equal((await data()).interior,'off');
    await page.selectOption('#xi-line','2');await page.click('#xi-mirror');
    await page.click('.tabs [data-view="3d"]');assert.equal((await data()).interior,'active');
    assert.equal((await data()).unitLine,'2');
    assert.equal(await page.locator('#xi-interior-plan-transform').getAttribute('transform'),await page.locator('#xi-plan-image-transform').getAttribute('transform'));
    await page.click('[data-spot="living"]');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await host.screenshot({path:`verification/xi-interior-${width}.png`});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({width,changed,errors}));await page.close();
  }
} finally {await browser.close();}
