import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import sharp from 'sharp';
import {readColorChart} from '../scripts/chart-image-reader.mjs';
import {compileLinkage,createUnitIndex} from '../src/unit-linkage.js';

const fixture={complexes:[{id:'test',address:'test'}],buildings:[{complexId:'test',building:'209',geometry:{levels:21}}],
  plans:[{complexId:'test',id:'84A',available:true},{complexId:'test',id:'84B',available:true}],
  lineAssociations:[{complexId:'test',building:'209',line:1,planId:'84A',source:'chart'}]};
test('image line is a candidate, not proof of unit existence or a 3D placement',()=>{
  const index=createUnitIndex(compileLinkage(fixture));
  const r=index.resolve('test','209','1201');
  assert.equal(r.status,'image-line-candidate');assert.equal(r.plan.id,'84A');
  assert.equal(r.preview,null);assert.equal(r.verified,false);assert.ok(r.gaps.includes('floor-exceptions-unverified'));
  assert.equal(index.resolve('test','209','1203').status,'unit-unlinked');
  assert.equal(index.resolve('test','209','2201').status,'unit-unlinked');
});
test('contradictory line evidence is withheld and exact unit exceptions take precedence',()=>{
  const conflicting={...fixture,lineAssociations:[...fixture.lineAssociations,{...fixture.lineAssociations[0],planId:'84B'}]};
  assert.equal(createUnitIndex(compileLinkage(conflicting)).resolve('test','209','1201').status,'conflict');
  const exact={...fixture,units:[{complexId:'test',building:'209',unit:'1201',planId:'84B',source:'unit-chart'}]};
  assert.equal(createUnitIndex(compileLinkage(exact)).resolve('test','209','1201').planId,'84B');
});
const profile=JSON.parse(await readFile('research/linkage/xi-chart-profile.json','utf8'));
test('real chart pixels extract types; removing another panel removes its result', {skip:!existsSync(profile.image)},async()=>{
  const bytes=await readFile(profile.image),r=await readColorChart(bytes,profile);
  for(const [line,type]of [[1,'84A'],[2,'84A'],[4,'84B'],[5,'84B'],[6,'84A'],[7,'84A']])assert.equal(r.lines.find(x=>x.building==='209'&&x.line===line)?.type,type);
  assert.equal(r.lines.some(x=>x.building==='209'&&x.line===3),false);
  assert.ok(r.lines.some(x=>x.building==='208'));
  assert.equal(new Set(r.lines.map(x=>x.building)).size,14);
  assert.equal(r.lines.find(x=>x.building==='206'&&x.line===3)?.type,'101A');
  assert.equal(r.lines.find(x=>x.building==='207'&&x.line===3)?.type,'116A');
  assert.equal(r.lines.find(x=>x.building==='204'&&x.line===4)?.type,'84B');
  for(const [building,line] of profile.unresolvedLineMarkers)assert.equal(r.lines.some(x=>x.building===building&&x.line===line),false);
  const [left,top,width,height]=profile.panels.find(x=>x.building==='208').box;
  const blank=await sharp({create:{width,height,channels:3,background:'white'}}).png().toBuffer();
  const changed=await sharp(bytes).composite([{input:blank,left,top}]).png().toBuffer();
  assert.equal((await readColorChart(changed,profile)).lines.some(x=>x.building==='208'),false);
  await assert.rejects(readColorChart(await sharp(bytes).resize(400).toBuffer(),profile),/dimensions/);
  const allBlank=await sharp({create:{width:800,height:527,channels:3,background:'white'}}).png().toBuffer();
  await assert.rejects(readColorChart(allBlank,profile),/references/);
  const duplicate={...profile,reviewedLineMarkers:[...profile.reviewedLineMarkers,profile.reviewedLineMarkers[0]]};
  await assert.rejects(readColorChart(bytes,duplicate),/Invalid reviewed/);
});
