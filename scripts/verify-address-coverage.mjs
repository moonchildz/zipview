import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createUnitIndex,planImageCount} from '../src/unit-linkage.js';
import {addressKeys} from '../src/address-input.js';

const catalog=JSON.parse(await readFile('research/linkage/generated/catalog.json','utf8'));
const index=createUnitIndex(catalog),failures=[],rows=[],checkedFiles=new Set();
let queries=0,decodedImages=0;
for(const c of catalog.complexes){
  const plans=catalog.plans.filter(p=>p.complexId===c.id),images=plans.filter(p=>p.available);
  for(const query of new Set([c.id,...[c.address,c.landAddress,...(c.aliases??[])].flatMap(addressKeys)])){
    const result=index.resolve(query);queries++;
    const matched=result.complex?.id===c.id||result.candidates?.some(r=>r.id===c.id);
    if(!matched)failures.push({complexId:c.id,query,status:result.status});
    if(result.complex?.id===c.id){
      try{assert.deepEqual(result.availablePlans.map(p=>p.id),plans.map(p=>p.id));}
      catch{failures.push({complexId:c.id,query,status:'plan-list-mismatch'});}
    }
  }
  for(const p of images){
    if(checkedFiles.has(p.file))continue;checkedFiles.add(p.file);
    try{
      const bytes=await readFile(p.file);
      if(/\.(png|jpe?g|webp)$/i.test(p.file)){
        const {info}=await sharp(bytes).raw().toBuffer({resolveWithObject:true});
        assert.ok(info.width>0&&info.height>0);decodedImages++;
      }else assert.ok(bytes.length>0);
    }catch(e){failures.push({complexId:c.id,planId:p.id,status:'unreadable-image',reason:e.message});}
  }
  rows.push({complexId:c.id,name:c.name,address:c.address,planRecords:plans.length,images:planImageCount(images),
    linkedUnits:catalog.units.filter(u=>u.complexId===c.id&&!u.scenario&&u.status!=='conflict').length,
    status:images.length?'plan-images-available':plans.length?'types-without-images':'address-only'});
}
const sampleAddresses=JSON.parse(await readFile('research/linkage/addresses.seoul-sample.json','utf8'));
const sample=sampleAddresses.map(address=>{
  const r=index.resolve(address),row=rows.find(row=>row.complexId===r.complex?.id);
  return {address,...(row??{status:r.status,candidates:r.candidates?.map(c=>c.id)})};
});
const report={checkedAt:new Date().toISOString(),networkRequests:0,addressQueries:queries,decodedImages,
  coverage:catalog.coverage,sample,failures,complexes:rows};
await writeFile('research/linkage/generated/address-coverage.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({addressQueries:queries,decodedImages,failures:failures.length,coverage:catalog.coverage,sample},null,2));
if(failures.length)process.exitCode=1;
