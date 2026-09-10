import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import osmtogeojson from 'osmtogeojson';
import {normalizeComplexes,normalizeEnvironment,expandUnitRanges,SEOUL_DISTRICTS} from '../src/seoul-data.js';
import {units as sinchonUnits,plans as sinchonPlans} from '../src/data.js';
import {inferPlanRegistration} from '../src/plan-registration.js';

const root='research/seoul',dir=`${root}/generated`;await mkdir(dir,{recursive:true});
const readJSON=async path=>JSON.parse(await readFile(path,'utf8'));
const complexRows=normalizeComplexes(await readJSON(`${root}/raw/apartments.json`));
const daebang=await readJSON(`${root}/daebang-unit-ranges.json`);
const chartUnits=expandUnitRanges(daebang.ranges);
for(const [building,count] of Object.entries(daebang.expectedBuildingCounts))if(chartUnits.filter(u=>u.building===building).length!==count)throw new Error('Unit chart total mismatch');
const gate=inferPlanRegistration();
const missing=['floor-level-plan','section-and-floor-elevations','window-schedule','four-paired-landmarks','as-built-review','reuse-permission'];
const bundles=[
  {id:'sinchon-prugio',complexId:'seoul:A10027851',name:'신촌푸르지오 2단지',lifecycle:'existing-pilot',
    complexMatch:'address-matched; official record combines phases 1 and 2',
    source:'research/sinchon-prugio/README.md',documents:[
      {role:'site-and-unit-chart',source:'https://apt79.tistory.com/13532536',status:'historical-reference'},
      {role:'unit-plans',source:'https://apt79.tistory.com/13532557',types:sinchonPlans.map(p=>p.id),status:'historical-reference; 59D separately sourced in local notes'}],
    missing,orientation:gate,releaseReady:false},
  {id:'gyeonghuigung-xi',complexId:'seoul:A10027118',name:'경희궁자이 2단지',lifecycle:'existing-pilot',
    complexMatch:'name-and-address-matched; dong geometry requires separate validation',
    source:'research/gyeonghuigung-xi/unit-layout-research.md',documents:[
      {role:'unit-number-site-map',source:'https://www.r1472.co.kr/_file/Group/21506081506430596_042.jpg',status:'reference-only'},
      {role:'unit-plan',source:(await readJSON('research/gyeonghuigung-xi/plan-sources.json')).page,types:['59A'],status:'reference-only'}],
    provisionalPlacement:{buildings:['204','205'],lines:[1,2],method:'entrance-core-topology',verified:false},
    missing,orientation:gate,releaseReady:false},
  {id:daebang.id,complexId:null,name:daebang.name,address:daebang.address,lifecycle:daebang.lifecycle,
    source:daebang.source,documents:[
      {role:'site-plan',source:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457653',local:`${root}/raw/daebang-site.png`,status:'inspected-reference-only'},
      {role:'unit-chart',source:daebang.chartSource,local:`${root}/raw/daebang-units.png`,status:'inspected-transcribed'},
      {role:'unit-plan',source:'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=67457871',local:`${root}/raw/daebang-55ah.png`,types:['55AH','55AL'],status:'inspected; diagram labels both dimensions; 55AS per-unit mapping missing'}],
    missing:[...missing,'74A-plan','74B-plan','55AS-unit-variant-mapping','building-georeferencing'],orientation:gate,releaseReady:false,
    notes:daebang.notes}
];
const linkedUnits=[...sinchonUnits.map(u=>({...u,bundleId:'sinchon-prugio',chartType:u.type,exactVariant:null,
  source:'research/sinchon-prugio/README.md',status:u.scenario?'scenario-only':'historical-chart-transcription',mirrored:null,verified:false})),
  ...chartUnits.map(u=>({...u,bundleId:daebang.id,source:daebang.chartSource}))];
const known=new Set(complexRows.map(c=>c.id));
for(const b of bundles)if(b.complexId&&!known.has(b.complexId))throw new Error('Existing pilot complex missing from current source; manual review required');

const dbPath=`${dir}/seoul.sqlite`,db=new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=DELETE;
CREATE TABLE IF NOT EXISTS complexes(id TEXT PRIMARY KEY,name TEXT,address TEXT,district TEXT,lon REAL,lat REAL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS environment(seq INTEGER PRIMARY KEY,id TEXT UNIQUE,category TEXT,name TEXT,data TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS environment_bounds USING rtree(seq,west,east,south,north);
CREATE TABLE IF NOT EXISTS bundles(id TEXT PRIMARY KEY,complex_id TEXT,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS units(bundle_id TEXT,building TEXT,unit TEXT,floor INTEGER,data TEXT NOT NULL,PRIMARY KEY(bundle_id,building,unit));
CREATE TABLE IF NOT EXISTS metadata(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS complex_district ON complexes(district);
CREATE INDEX IF NOT EXISTS environment_category ON environment(category);
BEGIN IMMEDIATE;`);
const counts={},heightCounts={tagged:0,missing:0},widthCounts={tagged:0,missing:0};let skipped=0,boundary=null,committed=false;
try{
  db.exec('DELETE FROM complexes; DELETE FROM environment_bounds; DELETE FROM environment; DELETE FROM bundles; DELETE FROM units; DELETE FROM metadata;');
  const insertComplex=db.prepare('INSERT INTO complexes VALUES(?,?,?,?,?,?,?)');
  for(const c of complexRows)insertComplex.run(c.id,c.name,c.address,c.district,c.point?.[0]??null,c.point?.[1]??null,JSON.stringify(c));
  const insertBundle=db.prepare('INSERT INTO bundles VALUES(?,?,?)');for(const b of bundles)insertBundle.run(b.id,b.complexId??null,JSON.stringify(b));
  const insertUnit=db.prepare('INSERT INTO units VALUES(?,?,?,?,?)');for(const u of linkedUnits)insertUnit.run(u.bundleId,u.building,u.unit,u.floor,JSON.stringify(u));
  const raw=await readJSON(`${root}/raw/osm.json`);
  const osmImport=await readJSON(`${root}/raw/osm.json.meta.json`);
  if((raw.remark&&!osmImport.allowPartial)||!raw.osm3s?.timestamp_osm_base||!raw.elements?.some(e=>e.tags?.['ISO3166-2']==='KR-11'))throw new Error('Invalid or unacknowledged partial Seoul OSM input');
  const insertFeature=db.prepare('INSERT INTO environment(id,category,name,data) VALUES(?,?,?,?)');
  const insertBounds=db.prepare('INSERT INTO environment_bounds VALUES(?,?,?,?,?)');
  osmtogeojson(raw,{flatProperties:true},feature=>{
    const f=normalizeEnvironment(feature);if(!f){skipped++;return;}
    if(f.category==='boundary')boundary=f;
    const result=insertFeature.run(f.id,f.category,f.name,JSON.stringify(f));
    const [w,s,e,n]=f.bounds;insertBounds.run(result.lastInsertRowid,w,e,s,n);
    counts[f.category]=(counts[f.category]??0)+1;
    if(f.category==='building')heightCounts[f.height===null?'missing':'tagged']++;
    if(f.category==='road')widthCounts[f.width===null?'missing':'tagged']++;
  });
  if(!boundary&&!raw.remark)throw new Error('Seoul boundary did not survive geometry validation');
  if(!counts.building||!counts.road)throw new Error('Empty building/road conversion: refusing an unusable environment catalog');
  const terrain=await readJSON(`${root}/raw/terrain/manifest.json`);
  const imports=[];
  for(const file of ['apartments.json','osm.json','daebang-site.png','daebang-units.png','daebang-55ah.png'])imports.push(await readJSON(`${root}/raw/${file}.meta.json`));
  const report={builtAt:new Date().toISOString(),scope:'Seoul; OSM area KR-11, not a complete official building registry',
    complexes:complexRows.length,districts:SEOUL_DISTRICTS.map(d=>({name:d,count:complexRows.filter(c=>c.district===d).length})),
    coordinates:{missing:complexRows.filter(c=>c.coordinateStatus==='missing').length,outOfRange:complexRows.filter(c=>c.coordinateStatus==='out-of-range').length,plausibleUnverified:complexRows.filter(c=>c.point).length},
    environment:{counts,skipped,heightCounts,widthCounts,osmBaseTimestamp:raw.osm3s.timestamp_osm_base,bounds:boundary?.bounds??null,boundaryValidated:!!boundary,
      queryComplete:!raw.remark,providerRemark:raw.remark??null,completeRealWorldCoverage:false},
    terrain:{tiles:terrain.tiles.length,bounds:terrain.bounds,quality:terrain.quality,groundSampleMetersApprox:terrain.groundSampleMetersApprox},
    packages:bundles.length,units:{total:linkedUnits.length,daebang:chartUnits.length,historicalSinchon:sinchonUnits.filter(u=>!u.scenario).length,scenarios:sinchonUnits.filter(u=>u.scenario).length},
    releaseReadyPackages:0,automaticReflectionConfirmed:0,
    gaps:['official address-to-dong crosswalk','surveyed ground/floor heights','floor plans and window schedules','independent reflection correspondences','source reuse permissions','adjacent-city occluders beyond Seoul boundary'],imports};
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('coverage',JSON.stringify(report));
  db.prepare('INSERT INTO metadata VALUES(?,?)').run('terrain',JSON.stringify(terrain));
  db.exec('COMMIT');committed=true;
  for(const [file,value] of [['coverage.json',report],['complexes.json',complexRows],['packages.json',bundles]]){
    await writeFile(`${dir}/${file}.tmp`,JSON.stringify(value,null,2));await rename(`${dir}/${file}.tmp`,`${dir}/${file}`);
  }
  await writeFile(`${root}/coverage-summary.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,imports:undefined,districts:report.districts.length},null,2));
}catch(e){if(!committed)db.exec('ROLLBACK');throw e;}finally{db.close();}
