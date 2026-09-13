import {readFile,writeFile,mkdir,readdir,stat,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {extractImageCharts} from './extract-image-charts.mjs';
import {compileLinkage,providerComplexTarget} from '../src/unit-linkage.js';
import {unitCoverage} from '../src/unit-coverage.js';
import {compileOfficialSites,buildingNumber} from '../src/official-buildings.js';
import {applyTerrainCorrection} from '../src/neighborhood.js';
import {applyBuildingFootprints} from '../src/building-footprints.js';
import {connectHousingInventory} from '../src/housing-inventory.js';
import {attachPlanTraces} from './compile-plan-traces.mjs';
import {connectShRentalPlans} from './connect-sh-rental-plans.mjs';
import {attachEstimatedViews} from '../src/estimated-view.js';
import {connectHanshin} from './connect-hanshin.mjs';
import {complex as sinchon,plans as sinchonPlans,units as sinchonUnits} from '../src/data.js';
import {normalizeComplexes,expandUnitRanges} from '../src/seoul-data.js';
import {XI_UNIT_RULES,XI_UNIT_SOURCES} from '../src/xi-unit-registry.js';
import {XI_PLANS} from '../src/xi-plans.js';
import {applyXiLayoutHypothesis,xiFrontBearing} from '../src/xi-unit-layout.js';
import {xiOrientationDecision} from '../src/xi-orientation-evidence.js';

const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const inputs=[];
async function optional(path){if(!existsSync(path)){inputs.push({path,status:'missing'});return null;}const bytes=await readFile(path);inputs.push({path,status:'loaded',sha256:createHash('sha256').update(bytes).digest('hex')});return JSON.parse(bytes);}
const daebang=await readJSON('research/seoul/daebang-unit-ranges.json');
const complexes=[{...sinchon,providerId:'seoul:A10027851',lifecycle:'existing-pilot'},
  {id:'gyeonghuigung-xi',providerId:'seoul:A10027118',name:'경희궁자이 2단지',address:'서울특별시 종로구 송월길 99',aliases:['경희궁자이2단지아파트','송월길99','종로구 송월길99'],lifecycle:'existing-pilot'},
  {id:daebang.id,name:daebang.name,address:daebang.address,aliases:['서울대방','신길동1280'],lifecycle:daebang.lifecycle,
    unitInventory:{count:Object.values(daebang.expectedBuildingCounts).reduce((a,b)=>a+b,0),source:daebang.chartSource}}];
const buildings=[],plans=[],units=[];
const external=await optional('research/seoul/generated/complexes.json');
const raw=await optional('research/seoul/raw/apartments.json');
const official=raw?normalizeComplexes(raw):external??[];
for(const row of official){
  const local=complexes.find(c=>c.providerId===row.id);
  if(local){local.aliases.push(row.id);local.providerRecord=row;/* Combined phase records must not become exact phase aliases. */}
  else complexes.push({...row,aliases:[row.landAddress].filter(Boolean),lifecycle:'provider-unverified'});
}
for(const p of sinchonPlans)plans.push({...p,complexId:sinchon.id,source:'research/sinchon-prugio/README.md',file:`research/sinchon-prugio/images/${p.id}.jpg`});
for(const p of Object.values(XI_PLANS))plans.push({id:p.id,complexId:'gyeonghuigung-xi',file:p.source,source:p.id==='84A'?XI_UNIT_SOURCES.plan84:'research/gyeonghuigung-xi/plan-sources.json'});
for(const id of ['55AH','55AL'])plans.push({id,complexId:daebang.id,file:'research/seoul/raw/daebang-55ah.png',source:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457871'});
for(const id of ['74A','74B'])plans.push({id,complexId:daebang.id,file:null,source:daebang.chartSource,model:false});
for(const p of plans)p.available=!!p.file&&existsSync(p.file);
for(const [complexId,path,site] of [[sinchon.id,'research/sinchon-prugio/outlook/scene.json','https://www.openstreetmap.org/way/463988053'],['gyeonghuigung-xi','research/gyeonghuigung-xi/scene.json','https://www.openstreetmap.org/way/359124892']]){
  const scene=await optional(path);if(!scene)continue;
  if(complexId===sinchon.id)applyTerrainCorrection(scene,await optional('research/sinchon-prugio/outlook/mapinfo-correction.json'));
  applyBuildingFootprints(scene,await optional('research/sinchon-prugio/outlook/building-footprints.json'));
  for(const b of scene.buildings.filter(b=>b.siteSource===site&&buildingNumber(b.name)&&(complexId!==sinchon.id||sinchon.buildings.includes(buildingNumber(b.name))))){
    buildings.push({complexId,building:buildingNumber(b.name),geometry:{scene:path,id:b.id,source:b.source,siteSource:b.siteSource,
      center:scene.center,points:b.points,parts:b.parts,geometrySource:b.geometrySource,geometryStatus:b.geometryStatus,base:b.base,baseSource:b.baseSource,height:b.height,heightSource:b.heightSource,levels:b.levels,verified:false}});
  }
  if(complexId==='gyeonghuigung-xi')for(const [building,r] of Object.entries(XI_UNIT_RULES)){
    const b=scene.buildings.find(b=>b.id===r.buildingId&&b.siteSource===site);if(!b)throw new Error('Xi geometry crosswalk missing');
    applyXiLayoutHypothesis({...scene,targetBuildingId:b.id});
    for(let floor=r.firstFloor;floor<=r.lastFloor;floor++)for(const line of r.planLines){
      const unit=String(floor*100+line),d=xiOrientationDecision(b,line);
      units.push({complexId,building,unit,floor,line,planId:r.planId,source:XI_UNIT_SOURCES.types,sources:Object.values(XI_UNIT_SOURCES),status:'source-linked-candidate',
        placement:{bearing:xiFrontBearing(b),mirrored:d.mirrored,automaticPlacement:false,status:'topology-candidate',source:XI_UNIT_SOURCES.types},
        preview:`/?site=xi&building=${building}&unit=${unit}`});
    }
  }
}
for(const building of sinchon.buildings)if(!buildings.some(b=>b.complexId===sinchon.id&&b.building===building))buildings.push({complexId:sinchon.id,building,geometry:null});
for(const u of sinchonUnits)units.push({...u,complexId:sinchon.id,planId:u.type,source:'research/sinchon-prugio/README.md',preview:`/?site=sinchon&building=${u.building}&unit=${u.unit}`});
const chartUnits=expandUnitRanges(daebang.ranges);
for(const [building,count] of Object.entries(daebang.expectedBuildingCounts)){
  if(chartUnits.filter(u=>u.building===building).length!==count)throw new Error('Daebang chart count mismatch');
  buildings.push({complexId:daebang.id,building,geometry:null});
}
for(const u of chartUnits)units.push({...u,complexId:daebang.id,planId:u.chartType,source:daebang.chartSource});
// Existing package DBs can add new packages/units without per-unit code changes.
const dbPath='research/seoul/generated/seoul.sqlite';
if(existsSync(dbPath)){
  inputs.push({path:dbPath,status:'loaded'});const db=new DatabaseSync(dbPath,{readOnly:true});
  try{
    for(const {data} of db.prepare('SELECT data FROM complexes').all()){
      const c=JSON.parse(data);
      if(!complexes.some(r=>r.id===c.id||r.providerId===c.id))complexes.push({...c,aliases:[],lifecycle:'provider-unverified'});
    }
    for(const {data} of db.prepare('SELECT data FROM bundles').all()){
      const b=JSON.parse(data);if(complexes.some(c=>c.id===b.id))continue;
      const provider=complexes.find(c=>c.id===b.complexId);
      // A bundle is a data package, not a second apartment at the same address.
      complexes.push({id:b.id,name:b.name,address:b.address??provider?.address,aliases:[],lifecycle:b.lifecycle,providerId:b.complexId});
      if(provider){complexes.splice(complexes.indexOf(provider),1);}
    }
    for(const {data} of db.prepare('SELECT data FROM units').all()){
      const u=JSON.parse(data),complexId=u.bundleId;
      // These three authoritative local adapters already include the DB's historical rows.
      if([sinchon.id,'gyeonghuigung-xi',daebang.id].includes(complexId))continue;
      units.push({...u,complexId,planId:u.chartType??u.type,source:u.source});
      if(!buildings.some(b=>b.complexId===complexId&&b.building===u.building))buildings.push({complexId,building:u.building,geometry:null});
    }
  }finally{db.close();}
}else inputs.push({path:dbPath,status:'missing'});
// Declarative extension packages are discovered automatically, not hard-coded into the UI.
if(existsSync('research/linkage/packages'))for(const name of (await readdir('research/linkage/packages')).filter(n=>n.endsWith('.json')).sort()){
  const p=await optional(`research/linkage/packages/${name}`);
  complexes.push(...(p.complexes??[]));buildings.push(...(p.buildings??[]));
  plans.push(...(p.plans??[]).map(r=>({...r,available:!!r.file&&existsSync(r.file)})));
  units.push(...(p.units??[]));
  for(const r of p.ranges??[])for(const u of expandUnitRanges([r]))units.push({...u,complexId:r.complexId,planId:r.chartType,source:r.source,placement:r.placement??null});
}
// Public provider snapshots are produced by code, including newly searched addresses.
// The full Hanshin/Hanjin provider combines the rental address record. Bind its
// known identity before address-only matching could create a third duplicate.
const hanshinComplex=complexes.find(c=>c.id==='seoul:A13606004');
if(hanshinComplex)hanshinComplex.kbId='36331';
if(existsSync('research/linkage/providers/kb'))for(const name of (await readdir('research/linkage/providers/kb')).filter(n=>/^\d+\.json$/.test(n)).sort()){
  const provider=await optional(`research/linkage/providers/kb/${name}`);
  let c=providerComplexTarget(complexes,provider);
  if(!c){c={id:`kb:${provider.providerId}`,name:provider.name,address:provider.address,aliases:[],lifecycle:'provider-unverified'};complexes.push(c);}
  c.kbId=provider.providerId;c.landAddress=provider.landAddress;c.planSource=provider.source;c.providerLinkStatus=provider.linkStatus;c.providerErrors=provider.errors;
  c.providerHouseholds=provider.households;c.providerBuildingCount=provider.buildingCount;
  if(c.id==='sinchon-prugio'){
    c.aliases=[...(c.aliases??[]),c.name];c.name='신촌푸르지오 (1·2단지)';
    c.phaseBuildings={'1':['101','102','103','104','105','106'],'2':sinchon.buildings};
  }
  c.aliases=[...new Set([...(c.aliases??[]),provider.name,provider.landAddress,`kb:${provider.providerId}`].filter(Boolean))];
  for(const p of provider.plans){
    for(const v of p.variants.length?p.variants:[{variant:'unavailable'}]){
      const id=`kb-${p.areaId}-${v.variant}`;
      plans.push({id,complexId:c.id,displayType:p.displayType,providerLabel:p.providerLabel,providerAreaId:p.areaId,
        area:p.area,supply:p.supply,providerHouseholds:p.households,rooms:p.rooms,bathrooms:p.bathrooms,variant:v.variant,source:provider.source,
        file:v.file??null,imageUrl:v.url??null,available:!!v.file&&existsSync(v.file),model:false});
    }
  }
  for(const b of provider.buildings)if(!buildings.some(r=>r.complexId===c.id&&r.building===b.building))buildings.push({...b,complexId:c.id,geometry:null});
  for(const u of provider.units){
    const matchingPlans=plans.filter(p=>p.complexId===c.id&&p.providerAreaId===u.areaId);
    const plan=matchingPlans.find(p=>p.variant==='basic')??matchingPlans[0];
    if(!plan){units.push({...u,complexId:c.id,planId:null,source:provider.source});continue;}
    const previous=units.find(r=>r.complexId===c.id&&r.building===u.building&&r.unit===u.unit);
    if(previous){
      // A known provider identity may corroborate, but never silently replace, a chart/model link.
      if(previous.planId===plan.displayType){
        previous.providerEvidence={source:provider.source,areaId:u.areaId,planId:plan.id};
        if(previous.scenario){previous.comparisonPreset=true;previous.scenario=false;previous.status='provider-unit-corroborated';}
        continue;
      }
    }
    units.push({...u,complexId:c.id,planId:plan.id,source:provider.source});
  }
}
await connectHanshin({complexes,buildings,plans,units});
for(const supplement of await optional('research/linkage/plan-supplements.json')??[]){
  const base=plans.find(p=>p.complexId===supplement.complexId&&p.providerAreaId===supplement.providerAreaId);
  if(!base||base.displayType!==supplement.displayType)continue;
  const available=existsSync(supplement.file);
  if(available&&createHash('sha256').update(await readFile(supplement.file)).digest('hex')!==supplement.sha256)throw new Error(`Supplement image hash mismatch: ${supplement.file}`);
  plans.push({...base,...supplement,id:`supplement-${supplement.providerAreaId}-${supplement.variant}`,available,model:false});
}
for(const p of plans)if(p.file&&!/^research\/(?!.*(?:^|\/)\.\.\/).+\.(?:png|jpg|jpeg|webp|svg|pdf)$/i.test(p.file))throw new Error(`Invalid plan file: ${p.id}`);
const assets=[];
async function scan(dir){if(!existsSync(dir))return;for(const e of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=`${dir}/${e.name}`;if(path.startsWith('research/linkage/')||e.name==='generated'||e.name.endsWith('.key'))continue;
  if(e.isDirectory()){await scan(path);continue;}if(!e.isFile())continue;
  const complexId=path.startsWith('research/sinchon-prugio/')||path.startsWith('mapinfo/')?sinchon.id:path.startsWith('research/gyeonghuigung-xi/')?'gyeonghuigung-xi':path.includes('daebang')?daebang.id:null;
  const role=/mapinfo|outlook|terrain|scene\.json|osm\./.test(path)?'environment':/images|plan|units/.test(path)?'plan-or-chart':'reference';
  assets.push({path,bytes:(await stat(path)).size,complexId,role,scope:complexId?'complex':'regional-or-unassigned'});
}}
await scan('research');await scan('mapinfo');
for(const p of plans)if(p.available&&!assets.some(a=>a.path===p.file))assets.push({path:p.file,bytes:(await stat(p.file)).size,complexId:p.complexId,role:'plan',scope:'complex'});
const lineAssociations=[];
for(const chart of await extractImageCharts()){
  inputs.push({path:chart.image??chart.source,status:chart.status==='extracted'?'loaded':'missing',reason:chart.reason});
  for(const row of chart.lines){
    const candidates=plans.filter(p=>p.complexId===chart.complexId&&p.displayType===row.type);
    const ids=new Set(candidates.map(p=>p.providerAreaId??p.id));
    if(ids.size!==1)continue;
    const plan=candidates.find(p=>p.variant==='basic')??candidates[0];
    lineAssociations.push({...row,complexId:chart.complexId,planId:plan.id,source:chart.source,imageHash:chart.imageHash,profileId:chart.id});
  }
}
const officialPath='research/linkage/downloads/hub/target-buildings.json';
const targetSites=compileOfficialSites(existsSync(officialPath)?await optional(officialPath):null);
const inventoryPath='research/linkage/downloads/housing/target-units.json';
const housing=connectHousingInventory({snapshot:existsSync(inventoryPath)?await optional(inventoryPath):null,sites:targetSites,plans,units,lineAssociations});
for(const report of housing.reports){
  if(report.completeInventory)complexes.find(c=>c.id===report.complexId).officialInventory={count:report.officialUnits,complete:true,source:'https://www.data.go.kr/data/3073746/fileData.do'};
}
const rentalPlanReport=await connectShRentalPlans(plans,housing.units);
const planTraceReport=await attachPlanTraces(plans);
const catalog=compileLinkage({complexes,buildings,plans,units:housing.units,lineAssociations,assets,inputs});
catalog.planTraceReport=planTraceReport;
catalog.rentalPlanReport=rentalPlanReport;
catalog.housingInventory=housing.reports;
for(const site of targetSites)for(const fact of site.facts){
  const building=buildings.find(b=>b.complexId===site.id&&b.building===fact.building);
  if(building){
    building.officialBuilding=fact;
    if(building.geometry)Object.assign(building.geometry,{height:fact.height,levels:fact.levels,heightSource:'official-building-register',heightEvidence:fact.source});
  }
}
catalog.targetSites=targetSites;
for(const unit of catalog.units){
  const rule=unit.complexId==='gyeonghuigung-xi'?XI_UNIT_RULES[unit.building]:null;
  if(rule&&unit.officialUnit&&unit.status==='linked'&&unit.plan?.available&&rule.planLines.includes(Number(unit.unit)%100)&&rule.planId===(unit.plan.displayType??unit.planId))unit.preview=`/?site=xi&building=${unit.building}&unit=${unit.unit}`;
}
for(const unit of catalog.units)if(unit.complexId===sinchon.id&&sinchon.buildings.includes(unit.building)&&unit.plan?.available&&unit.status!=='conflict')unit.planPreview=`/?site=sinchon&building=${unit.building}&unit=${unit.unit}`;
catalog.coverage.previews=catalog.units.filter(u=>u.preview&&!u.scenario).length;
attachEstimatedViews(catalog);
catalog.unitCoverage=unitCoverage(catalog);
catalog.coverage.fullyLinkedComplexes=catalog.unitCoverage.filter(c=>c.completePlanLookup).length;
catalog.coverage.sourceUnitsWithPlanImages=catalog.unitCoverage.reduce((n,c)=>n+c.unitsWithPlanImages,0);
await mkdir('research/linkage/generated',{recursive:true});
// Rename only complete snapshots; a failed parse/validation leaves the previous index intact.
for(const [name,value] of [['catalog',catalog],['target-sites',targetSites],['report',{coverage:catalog.coverage,unitCoverage:catalog.unitCoverage,targetSites,housingInventory:housing.reports,inputs,issues:catalog.issues}]]){
  const path=`research/linkage/generated/${name}.json`;await writeFile(`${path}.tmp`,JSON.stringify(value,null,2)+'\n');await rename(`${path}.tmp`,path);
}
console.log(JSON.stringify(catalog.coverage,null,2));
