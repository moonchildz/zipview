import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';

// This adapter adds the acquired 205 geometry and actual inventory in bulk.
// No generated floor/line ranges stand in for actual household records.
export async function connectHanshin({complexes,buildings,plans,units}){
  const id='seoul:A13606004',complex=complexes.find(c=>c.id===id);
  if(!complex)return;
  complex.kbId='36331';complex.aliases=[...new Set([...(complex.aliases??[]),'한신한진','한신한진아파트','돈암한신한진','성북구 한신한진아파트'])];
  const scenePath='research/hanshin-hanjin/scene.json',inventoryPath='research/linkage/downloads/housing/target-units.json';
  if(!existsSync(scenePath)||!existsSync(inventoryPath))return;
  const scene=JSON.parse(await readFile(scenePath,'utf8')),inventory=JSON.parse(await readFile(inventoryPath,'utf8'));
  if(!inventory.targets.some(t=>t.id==='hanshin-hanjin'))return;
  const target=scene.buildings.find(b=>b.id===559970274&&b.siteSource==='https://kbland.kr/se/c/36331');
  const rows=(inventory.targets.find(t=>t.id==='hanshin-hanjin')?.units??[]).map(u=>({...u,building:u.building.replace(/동$/,''),unit:u.unit.replace(/호$/,'')})).filter(u=>u.building==='205');
  if(!target||rows.length!==84||new Set(rows.map(r=>r.unit)).size!==84||rows.some(r=>Number(r.unit)>2104||Number(r.unit)<101))throw new Error('Hanshin 205 inventory/crosswalk mismatch');
  buildings.push({complexId:id,building:'205',officialBuilding:target.officialBuilding,inventoryComplete:true,
    geometry:{...target,center:scene.center,scene:scenePath,verified:false}});
  complex.addressBuildingScope=['205'];
  for(const row of rows){
    const matches=plans.filter(p=>p.complexId===id&&p.providerAreaId&&Math.round(p.area*100)===Math.floor(row.exclusiveArea*100+1e-7));
    const plan=new Set(matches.map(p=>p.providerAreaId)).size===1?(matches.find(p=>p.available)??matches[0]):null;
    units.push({complexId:id,building:row.building,unit:row.unit,floor:Math.floor(Number(row.unit)/100),line:Number(row.unit)%100,
      planId:plan?.id??null,source:inventory.source,status:'official-inventory-unit-linked',
      officialUnit:{...row,source:inventory.source,sourceFile:inventory.sourceFile,sha256:inventory.sha256},
      typeEvidence:plan?{method:'official-exact-area-unique-provider-type',source:plan.source,providerAreaId:plan.providerAreaId}:null});
  }
}
