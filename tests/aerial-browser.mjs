import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const browser = await chromium.launch({channel: 'chrome', headless: true});
const errors = [];
const regionMode = process.env.AERIAL_REGIONS === '1';
const yoloMode = process.env.AERIAL_YOLO === '1';
function difference(a, b) {
  const x = PNG.sync.read(a), y = PNG.sync.read(b);
  let count = 0;
  for (let i = 0; i < x.data.length; i += 4) if (Math.abs(x.data[i] - y.data[i])
    + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2]) > 20) count++;
  return count;
}
try {
  for (const viewport of [{width: 1440, height: 1000}, {width: 390, height: 844}]) {
    const page = await browser.newPage({viewport});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5174/aerial-review.html?data=/verification/' + (yoloMode ? 'aerial-yolo' : regionMode ? 'aerial-regions' : 'aerial-refined') + '/detections.json');
    await page.waitForSelector('#scene canvas[data-tree-count]');
    const canvas = page.locator('#scene canvas');
    const count = Number(await canvas.getAttribute('data-tree-count'));
    assert.ok(count > 0);
    if (yoloMode) {
      assert.equal(await page.locator('#detector').inputValue(),'aerial-yolo');
      assert.ok((await page.locator('#status').textContent()).includes('미지원'));
      await page.locator('#detector').selectOption('aerial-regions');
      await page.waitForURL('**/aerial-review.html?data=*aerial-regions*');
      await page.waitForSelector('#scene canvas[data-tree-count]');
      assert.equal(await page.locator('#detector').inputValue(),'aerial-regions');
      await page.locator('#detector').selectOption('aerial-yolo');
      await page.waitForURL('**/aerial-review.html?data=*aerial-yolo*');
      await page.waitForSelector('#scene canvas[data-tree-count]');
    }
    if (regionMode) {
      const groveCount = Number(await canvas.getAttribute('data-grove-tree-count'));
      assert.ok(groveCount > count);
      await page.locator('#grove-focus').click(); await page.waitForTimeout(400);
      const grove = await canvas.screenshot();
      await page.screenshot({path:`verification/aerial-grove-close-${viewport.width}.png`,fullPage:true});
      await page.locator('#canopy-mode').selectOption('volume'); await page.waitForTimeout(150);
      assert.ok(difference(grove,await canvas.screenshot())>500,'grove differs visibly from solid volume');
      await page.locator('#canopy-mode').selectOption('grove');
      await page.locator('#density').fill('1.6'); await page.locator('#density').dispatchEvent('change');
      assert.ok(Number(await canvas.getAttribute('data-grove-tree-count'))>groveCount);
      await page.locator('#density').fill('1'); await page.locator('#density').dispatchEvent('change');
      assert.equal(Number(await canvas.getAttribute('data-grove-tree-count')),groveCount);
      await page.locator('#height-scale').fill('1.8'); await page.locator('#height-scale').dispatchEvent('change');
      await page.waitForTimeout(150);
      assert.ok(difference(grove,await canvas.screenshot())>300,'height changes foliage silhouette');
      await page.locator('#height-scale').fill('1'); await page.locator('#height-scale').dispatchEvent('change');
      await page.locator('#reset').click();
    }
    await page.screenshot({path: `verification/aerial-${regionMode ? 'regions-' : ''}${viewport.width}.png`, fullPage: true});
    if(yoloMode) await page.screenshot({path:`verification/aerial-yolo-${viewport.width}.png`,fullPage:true});
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const initial = await canvas.screenshot();
    await page.locator('#trees').uncheck();
    await page.waitForTimeout(100);
    const noTrees = await canvas.screenshot();
    assert.ok(difference(initial, noTrees) > 50, 'visible 3D tree geometry');
    if (regionMode) {
      await page.locator('#facilities').uncheck(); await page.waitForTimeout(100);
      assert.ok(difference(noTrees, await canvas.screenshot()) > 10, 'visible facility candidates');
      await page.locator('#facilities').check();
    }
    await page.locator('#photo').uncheck();
    await page.waitForTimeout(100);
    assert.ok(difference(noTrees, await canvas.screenshot()) > 1000, 'source texture rendered');
    await page.locator('#photo').check(); await page.locator('#trees').check();
    await page.locator('#top').click(); await page.waitForTimeout(400);
    assert.ok(difference(initial, await canvas.screenshot()) > 1000, 'camera changes pixels');
    await page.locator('#threshold').fill('0.95');
    await page.locator('#threshold').dispatchEvent('input');
    if (regionMode) assert.equal(Number(await canvas.getAttribute('data-facility-count')), 0);
    else assert.ok(Number(await canvas.getAttribute('data-tree-count')) < count);
    await page.locator('#threshold').fill('0.35'); await page.locator('#threshold').dispatchEvent('input');
    await page.locator('#scale').fill('0.5'); await page.locator('#scale').dispatchEvent('change');
    const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadPromise;
    const glb = await readFile(await download.path());
    assert.equal(glb.toString('ascii', 0, 4), 'glTF');
    const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
    assert.ok(json.extensionsUsed.includes('EXT_mesh_gpu_instancing'));
    if (regionMode) assert.ok(json.nodes.some(n=>n.extras?.representation==='procedural-grove'));
    if(yoloMode) assert.ok(json.nodes.some(n=>n.extras?.orientationStatus==='detected-axis-heading-unknown'));
    assert.ok(json.nodes.some(n => n.extras?.heightStatus === 'assumed'));
    await download.saveAs(`verification/aerial-${regionMode ? 'regions' : 'trees'}-${viewport.width}.glb`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(JSON.stringify({viewport, count, glbBytes: glb.length, errors}));
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {await browser.close();}
