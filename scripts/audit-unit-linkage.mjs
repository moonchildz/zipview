import {readFile,readdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createUnitIndex} from '../src/unit-linkage.js';
import {unitCoverage} from '../src/unit-coverage.js';

const catalog=JSON.parse(await readFile('research/linkage/generated/catalog.json','utf8'));
const index=createUnitIndex(catalog),coverage=unitCoverage(catalog),failures=[];
let sourceRecords=0,uniqueSourceUnits=0,lineQueries=0;
const root='research/linkage/providers/kb';
if(existsSync(root))for(const file of (await readdir(root)).filter(n=>/^\d+\.json$/.test(n))){
  const provider=JSON.parse(await readFile(`${root}/${file}`,'utf8'));
  const c=catalog.complexes.find(c=>c.kbId===provider.providerId),seen=new Set();
  if(!c){failures.push({providerId:provider.providerId,reason:'provider-complex-not-indexed'});continue;}
  for(const source of provider.units){
    sourceRecords++;const key=`${source.building}:${source.unit}:${source.areaId}`;
    if(seen.has(key))continue;seen.add(key);uniqueSourceUnits++;
    const result=index.resolve(c.id,source.building,source.unit);
    const matching=result.evidence?.some(e=>e.areaId===source.areaId||e.providerEvidence?.areaId===source.areaId);
    if(!matching||['unit-unlinked','building-unlinked'].includes(result.status))failures.push({complexId:c.id,building:source.building,unit:source.unit,areaId:source.areaId,reason:'source-unit-link-lost'});
    if(source.areaId&&result.status!=='conflict'&&result.plan?.providerAreaId!==source.areaId&&result.providerEvidence?.areaId!==source.areaId)failures.push({complexId:c.id,building:source.building,unit:source.unit,reason:'provider-area-mismatch'});
  }
}
// Exercise every known row, not only the example addresses or successful galleries.
for(const unit of catalog.units){
  const result=index.resolve(unit.complexId,unit.building,unit.unit);
  if(result.key!==unit.key)failures.push({key:unit.key,reason:'registered-unit-not-reachable'});
}
for(const line of catalog.lineAssociations??[])for(const floor of [5,10]){
  const unit=String(floor*100+line.line),result=index.resolve(line.complexId,line.building,unit);lineQueries++;
  const direct=catalog.units.some(u=>u.complexId===line.complexId&&u.building===line.building&&u.unit===unit);
  if(!direct&&result.planId!==line.planId&&!result.gaps?.includes('floor-above-building-levels')&&result.status!=='unit-not-found')failures.push({complexId:line.complexId,building:line.building,unit,reason:'line-plan-unreachable'});
}
const active=coverage.filter(c=>c.knownUnits||c.unitCandidates||c.lineCandidates||catalog.plans.some(p=>p.complexId===c.complexId));
const report={checkedAt:new Date().toISOString(),sourceRecords,uniqueSourceUnits,lineQueries,failures,
  complete:active.length>0&&active.every(c=>c.completePlanLookup),complexes:active};
await writeFile('research/linkage/generated/unit-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,complexes:active.map(({missingUnits,buildings,...c})=>({...c,missingImageOrTypeUnits:missingUnits.length}))},null,2));
if(failures.length)process.exitCode=1;
else if(process.argv.includes('--require-complete')&&!report.complete)process.exitCode=2;
