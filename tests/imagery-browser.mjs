import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {imageryGrid} from '../src/imagery-coordinates.js';

const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:5174';
const output='verification';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
  for(const site of ['sinchon','xi']) for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',msg=>{if(msg.type()==='error' && /THREE|Shader|WebGL/.test(msg.text()))errors.push(msg.text());});
    const path=site==='xi'?'research/gyeonghuigung-xi/scene.json':'research/sinchon-prugio/outlook/scene.json';
    const data=JSON.parse(readFileSync(path,'utf8')),grid=imageryGrid(data.center,15,2);
    let requests=0;
    // Synthetic colored checker tiles exercise UV/shaders only, never real-photo accuracy.
    await page.route('**/api/imagery/**',async route=>{
      requests++;
      assert.equal(new URL(route.request().url()).searchParams.get('zoom'),'15');
      if(new URL(route.request().url()).pathname.endsWith('/metadata'))return route.fulfill({json:{grid,tileSize:256,copyright:'TEST FIXTURE - NOT SATELLITE IMAGERY'}});
      const png=new PNG({width:256,height:256});
      for(let y=0;y<256;y++)for(let x=0;x<256;x++){
        const i=(y*256+x)*4;
        const road=x>90&&x<130, cell=(Math.floor(x/32)+Math.floor(y/32))%2;
        png.data[i]=road?65:cell?185:130;png.data[i+1]=road?65:cell?120:170;
        png.data[i+2]=road?70:cell?110:195;png.data[i+3]=255;
      }
      await route.fulfill({contentType:'image/png',body:PNG.sync.write(png)});
    });
    await page.goto(`${base}/${site==='xi'?'?site=xi':''}`);
    await page.waitForSelector('#outlook-host[data-ready="true"]');
    await page.waitForSelector('#outlook-host[data-imagery="visible"]');
    assert.equal(requests,5,'metadata and four low-resolution tiles load automatically');
    assert.equal(await page.locator('#imagery-visible').isChecked(),true);
    assert.equal(await page.locator('#roads-visible').isChecked(),true,'estimated roads remain enabled when imagery loads');
    await page.locator('#imagery-visible').uncheck();
    const host=page.locator('#outlook-host');await host.scrollIntoViewIfNeeded();
    const heights=await host.getAttribute('data-camera-heights');
    const box=await host.boundingBox();
    await page.mouse.move(box.x+box.width*.8,box.y+box.height*.6);
    await page.mouse.down();await page.mouse.move(box.x+box.width*.8,box.y+box.height*.6-130);await page.mouse.up();
    await page.locator('#roads-visible').uncheck();
    const before=PNG.sync.read(await page.locator('#outlook-host canvas').screenshot());
    await page.locator('#imagery-visible').check();
    await page.waitForSelector('#outlook-host[data-imagery="visible"]');
    assert.equal(requests,5);
    assert.equal(await page.locator('#roads-visible').isChecked(),false);
    assert.equal(await host.getAttribute('data-camera-heights'),heights,'imagery never changes camera or terrain elevation');
    await host.scrollIntoViewIfNeeded();
    const after=PNG.sync.read(await page.locator('#outlook-host canvas').screenshot());
    let changed=0;
    for(let i=0;i<after.data.length;i+=4)if(Math.abs(after.data[i]-before.data[i])+Math.abs(after.data[i+1]-before.data[i+1])+Math.abs(after.data[i+2]-before.data[i+2])>30)changed++;
    assert.ok(changed>1000,`ground photograph shader changes canvas pixels: ${changed}`);
    await page.locator('#imagery-visible').uncheck();
    assert.equal(await page.locator('#roads-visible').isChecked(),false,'imagery preserves the disabled road choice');
    await page.locator('#roads-visible').check();
    await page.locator('#imagery-visible').check();
    assert.equal(await page.locator('#roads-visible').isChecked(),true,'both overlays can remain enabled');
    await page.locator('#imagery-visible').uncheck();
    assert.equal(await page.locator('#roads-visible').isChecked(),true,'imagery preserves the enabled road choice');
    await page.locator('#imagery-visible').check();
    await host.scrollIntoViewIfNeeded();
    const withRoads=PNG.sync.read(await page.locator('#outlook-host canvas').screenshot());
    let roadPixels=0;
    for(let i=0;i<withRoads.data.length;i+=4)if(Math.abs(withRoads.data[i]-after.data[i])+Math.abs(withRoads.data[i+1]-after.data[i+1])+Math.abs(withRoads.data[i+2]-after.data[i+2])>30)roadPixels++;
    assert.ok(roadPixels>20,`estimated road overlay changes canvas pixels: ${roadPixels}`);
    await page.screenshot({path:`${output}/imagery-fixture-${site}-${width}.png`,fullPage:true});
    assert.equal(requests,5,'toggle reuses in-memory texture');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const overflow=await page.locator('.imagery-toolbar button, .imagery-toolbar label, #imagery-status').evaluateAll(nodes=>nodes.filter(n=>n.clientWidth>0&&n.scrollWidth>n.clientWidth+2).map(n=>n.textContent));
    assert.deepEqual(overflow,[]);
    assert.deepEqual(errors,[]);
    results.push({site,width,changed,roadPixels,requests,synthetic:true});await page.close();
  }
  for(const failure of ['metadata','tile']) {
    const page=await browser.newPage();
    let requests=0;
    const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json','utf8'));
    await page.route('**/api/imagery/**',route=>{
      requests++;
      if(failure==='tile'&&new URL(route.request().url()).pathname.endsWith('/metadata'))return route.fulfill({json:{grid:imageryGrid(data.center,15,2),tileSize:256,copyright:'TEST'}});
      return route.fulfill({status:failure==='metadata'?503:404,json:{error:'TEST: unavailable'}});
    });
    await page.goto(base+'/?site=xi');await page.waitForSelector('#outlook-host[data-imagery="error"]');
    assert.equal(await page.locator('#imagery-visible').isDisabled(),true);
    assert.equal(await page.locator('#roads-visible').isChecked(),true);
    assert.equal(await page.locator('#imagery-load').isEnabled(),true);
    const count=failure==='metadata'?1:2;
    assert.equal(requests,count);
    await page.locator('#xi-opening-list [data-opening="kitchen"]').click();
    await page.locator('#floor-a').selectOption('5');
    assert.equal(requests,count,'window/floor changes do not retry failures');
    await page.locator('#imagery-load').click();
    await page.waitForSelector('#outlook-host[data-imagery="error"]');
    assert.equal(requests,count*2,'one retry only on explicit click');
    await page.close();
  }
  await writeFile(`${output}/imagery-results.json`,JSON.stringify({results,liveImageryVerified:false},null,2));
  console.log(JSON.stringify({results,liveImageryVerified:false},null,2));
} finally {await browser.close();}
