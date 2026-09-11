import {readFile,writeFile} from 'node:fs/promises';
import {createUnitIndex} from '../src/unit-linkage.js';
import {homeSelection} from '../src/home-selection.js';
import {modelForPlan,windowPose} from '../src/plan-models.js';
import {sourceBacked} from '../src/unit-coverage.js';

const catalog=JSON.parse(await readFile('research/linkage/generated/catalog.json','utf8')),index=createUnitIndex(catalog);
const targets=[];
for(const site of catalog.targetSites??[]){
  const buildings=[],failures=[];
  for(const fact of site.facts){
    const units=catalog.units.filter(u=>u.complexId===site.id&&u.building===fact.building&&sourceBacked(u));
    const rows=units.map(u=>{
      const r=index.resolve(site.address,u.building,u.unit),home=homeSelection(r);
      const image=!!r.plan?.available&&!home.error;
      const model=image?modelForPlan(r.plan):null;
      const localOpenings=model?model.windows.map(w=>windowPose(model,w.id)):[];
      if(r.key!==u.key)failures.push({building:u.building,unit:u.unit,reason:'unreachable-unit'});
      return {unit:u.unit,type:home.type??null,planImage:image,structureRoute:!!(r.planPreview||r.preview),
        interiorModel:site.id==='sinchon-prugio'?!!model:image&&!!r.preview,localOpeningCount:localOpenings.length,
        windowsReady:r.viewReady===true,verified:r.verified===true,gaps:r.gaps??[]};
    });
    buildings.push({building:fact.building,expected:fact.households,known:units.length,inventoryCountMatches:units.length===fact.households,
      planImages:rows.filter(r=>r.planImage).length,structureRoutes:rows.filter(r=>r.structureRoute).length,
      interiorModels:rows.filter(r=>r.interiorModel).length,windowsReady:rows.filter(r=>r.windowsReady).length,units:rows});
  }
  targets.push({id:site.id,name:site.name,expected:site.expectedUnits,officialBuildingInventory:site.inventoryComplete,
    known:buildings.reduce((n,b)=>n+b.known,0),planImages:buildings.reduce((n,b)=>n+b.planImages,0),
    structureRoutes:buildings.reduce((n,b)=>n+b.structureRoutes,0),interiorModels:buildings.reduce((n,b)=>n+b.interiorModels,0),
    windowsReady:buildings.reduce((n,b)=>n+b.windowsReady,0),
    complete:site.inventoryComplete&&buildings.every(b=>b.inventoryCountMatches&&b.windowsReady===b.expected)&&!failures.length,failures,buildings});
}
const report={checkedAt:new Date().toISOString(),complete:targets.length===2&&targets.every(t=>t.complete),targets};
await writeFile('research/linkage/generated/target-flow-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,targets:targets.map(({buildings,...t})=>t)},null,2));
if(targets.some(t=>t.failures.length))process.exitCode=1;
else if(process.argv.includes('--require-complete')&&!report.complete)process.exitCode=2;
