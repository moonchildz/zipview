import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {atomicJson} from './atomic-json.mjs';
import {checkInventory,normalizeSheet,mergeSheets} from './ngii-files.mjs';
import {completeMapInventory} from './national-inventory.mjs';

export const REGIONS=[['seoul','서울',['11']],['busan','부산',['26']],['daegu','대구',['27']],['incheon','인천',['28']],['gwangju','광주',['29']],['daejeon','대전',['30']],['ulsan','울산',['31']],['sejong','세종',['36']],['gyeonggi','경기',['41']],['gangwon','강원',['42','51']],['chungbuk','충북',['43']],['chungnam','충남',['44']],['jeonbuk','전북',['45','52']],['jeonnam','전남',['46']],['gyeongbuk','경북',['47']],['gyeongnam','경남',['48']],['jeju','제주',['50']]];
export function regionFor(code){
 // Provider's current combined prefix: retain our geographic work queues.
 if(String(code).startsWith('12'))return ['12210','12240','12270','12300','12330'].includes(String(code))?'gwangju':'jeonnam';
 return REGIONS.find(r=>r[2].includes(String(code).slice(0,2)))?.[0];
}
export function partitionTargets(targets,size=64){if(!Number.isInteger(size)||size<1||size>256)throw Error('Invalid job size');return Array.from({length:Math.ceil(targets.length/size)},(_,i)=>targets.slice(i*size,(i+1)*size));}
export function mapStageReady(catalog,jobs,statuses){
 return catalog.length>0&&catalog.every(d=>d.status==='catalogued'&&jobs.some(j=>j.dataset==='maps'&&j.district===d.code&&j.scale===1000&&!j.rejectedCount&&(j.availability==='not-provided'||statuses[j.id]==='files-verified')));
}
export async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export function taskState(job,artifact){
 if(!artifact)return 'not-started';
 if(job.dataset==='maps')return artifact.sheets?.length&&artifact.sheets.every(x=>x.status==='verified')?'files-verified':artifact.sheets?.some(x=>x.status==='review')?'needs-review':'incomplete';
 if(!artifact.plan?.selected?.length)return 'unplanned';
 const all=artifact.plan.selected.every(x=>artifact.transfers?.scenes?.[x.id]?.status==='downloaded-header-checked');
 if(!all)return 'incomplete';
 return artifact.plan.inventoryComplete===true&&artifact.plan.uncoveredCellIds?.length===0?'files-verified':'coverage-gap';
}
async function child(exe,args){await new Promise((resolve,reject)=>{const p=spawn(exe,args,{stdio:'inherit',windowsHide:true});p.on('error',reject);p.on('exit',(code,signal)=>code===0?resolve():reject(Error(`Child failed: ${code??signal}`)));});}

export async function main(argv=process.argv.slice(2)){
 const {values:a,positionals}=parseArgs({args:argv,allowPositionals:true,options:{root:{type:'string',default:'.tools/national'},region:{type:'string'},limit:{type:'string',default:'1'},dataset:{type:'string'},phase:{type:'string',default:'inventory'},python:{type:'string',default:'.tools/aerial-python/Scripts/python.exe'},channel:{type:'string',default:'chrome'},retry:{type:'boolean'},help:{type:'boolean'}}});
 const command=positionals[0];if(a.help||!command){console.log('national-collection init | inventory --region busan --limit 1 | prepare --region busan | run --region busan --dataset maps|satellite --phase inventory|download|verify --limit 1 | status');return;}
 if(!['init','inventory','prepare','run','status'].includes(command))throw Error('Unknown command');
 if(a.region&&!REGIONS.some(r=>r[0]===a.region))throw Error('Unknown region slug');
 const limit=Number(a.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('limit must be 1..100');
 const root=path.resolve(a.root),configPath=path.join(root,'config.json'),catalogPath=path.join(root,'districts.json'),jobsPath=path.join(root,'jobs.json');
 await fs.mkdir(root,{recursive:true});
 // One orchestrator writer. Never acquire or remove the active Seoul collector lock.
 let lock;if(command!=='status'){lock=await fs.open(path.join(root,'run.lock'),'wx');await lock.writeFile(String(process.pid));}
 try{
 if(command==='init'){
  if(await readJson(configPath,null))throw Error('Configuration exists; refusing to overwrite');
  await atomicJson(configPath,{version:1,priority:['seoul','gyeonggi',...REGIONS.map(r=>r[0]).filter(x=>!['seoul','gyeonggi'].includes(x))],scales:[1000],acquisitionOrder:"maps-before-satellite",satelliteInbox:'C:/Users/User/Downloads/satellite_01',mapOutput:'mapinfo',mapInbox:'C:/Users/User/Downloads',satelliteBudgetGB:1000,minimumFreeGB:50,jobMaxGB:60,jobMaxScenes:10,gridStepMeters:500,radiusMeters:400,existingSeoulState:'.tools/cas-imagery',existingSeoulMaps:'.tools/ngii-downloads',osmDatabase:'research/osm/generated/south-korea-roads.sqlite'});
  await atomicJson(jobsPath,[]);console.log('Created configuration; no downloads started.');return;
 }
 const cfg=await readJson(configPath,null);if(!cfg)throw Error('Run init first');
 if(JSON.stringify(cfg.scales)!=='[1000]')throw Error('Policy requires scales: [1000]; migrate old configuration before running');
 if(command==='inventory'){
  const {launchBrowser,districts,queryDistrict,queryMapBounds,pause}=await import('./ngii-browser.mjs');
  const browser=await launchBrowser({inventory:true,channel:a.channel});
  try{
   let catalog=await readJson(catalogPath,null);
   if(!catalog){const areas=await districts(browser.page,'');if(!areas.length||areas.some(x=>!regionFor(x.code))||new Set(areas.map(x=>x.code)).size!==areas.length)throw Error('Unexpected administrative inventory');catalog=areas.map(x=>({...x,code:String(x.code),region:regionFor(x.code),status:'pending'}));await atomicJson(catalogPath,catalog);}
   const selected=catalog.filter(d=>(!a.region||d.region===a.region)&&d.status!=='catalogued'&&(a.retry||d.status!=='review')).sort((x,y)=>cfg.priority.indexOf(x.region)-cfg.priority.indexOf(y.region)).slice(0,limit);
   for(const d of selected){try{
    const cachePath=path.join(root,'inventory-cache',d.code+'.json'),cache=await readJson(cachePath,{});let calls=0;
    const data=await completeMapInventory(await queryDistrict(browser.page,d.code),async bounds=>{const key=JSON.stringify(bounds);if(cache[key])return cache[key];if(++calls>64)throw Error('Spatial request budget reached; --retry resumes cached subdivisions');await pause(1000);const result=await queryMapBounds(browser.page,bounds);cache[key]=result;await atomicJson(cachePath,cache);return result;});
    if(!data.area?.wkt)throw Error('No administrative boundary');await atomicJson(path.join(root,'inventory',d.code+'.json'),data);d.status='catalogued';d.count=data.items.length;delete d.error;
   }catch(e){d.status='review';d.error=e.message;}d.checkedAt=new Date().toISOString();await atomicJson(catalogPath,catalog);console.log(JSON.stringify(d));await pause(1000);}
  }finally{await browser.close();}return;
 }
 let jobs=await readJson(jobsPath,[]);const catalog=await readJson(catalogPath,[]);
 if(jobs.some(j=>j.dataset==='maps'&&j.scale!==1000))throw Error('Non-1:1000 jobs must be removed from the active queue');
 if(command==='prepare'){
  for(const d of catalog.filter(d=>d.status==='catalogued'&&(!a.region||d.region===a.region))){
   const source=path.join(root,'inventory',d.code+'.json'),data=await readJson(source);
   for(const scale of cfg.scales){const id=`maps-${d.code}-${scale}`;if(jobs.some(j=>j.id===id))continue;
    const valid=[],rejected=[];
    for(const item of data.items.filter(x=>String(x.scale)===String(scale))){try{if(item.fileExt&&item.fileExt!=='zip')throw Error('Source format requires separate conversion: '+item.fileExt);valid.push(normalizeSheet(item,d.name,scale));}catch(e){rejected.push({item,reason:e.message});}}
    const sheets=mergeSheets([valid]);
    const state=path.join(root,'maps',d.code,String(scale));
    const job={id,region:d.region,district:d.code,dataset:'maps',scale,state,availability:sheets.length?'available':rejected.length?'needs-review':'not-provided',count:sheets.length,rejectedCount:rejected.length};
    if(rejected.length)await atomicJson(path.join(state,'source-review.json'),rejected);
    if(sheets.length)await atomicJson(path.join(state,'manifest.json'),{schemaVersion:1,source:'https://map.ngii.go.kr',product:'수치지도2.0',scale,districts:[d],sheets,inventoryCheckedAt:d.checkedAt});
    jobs.push(job);await atomicJson(jobsPath,jobs);
   }
   if(a.dataset!=='satellite')continue; // Maps-first preparation must not depend on imagery geometry.
   const gridPath=path.join(root,'grids',d.code+'.json');await child(a.python,['scripts/national-grid.py',source,gridPath]);const groups=partitionTargets(await readJson(gridPath));
   for(let i=0;i<groups.length;i++){const id=`satellite-${d.code}-${String(i).padStart(4,'0')}`;if(jobs.some(j=>j.id===id))continue;const state=path.join(root,'satellite',d.code,String(i)),targets=path.join(state,'targets.json');await atomicJson(targets,groups[i]);jobs.push({id,region:d.region,district:d.code,dataset:'satellite',state,targets,count:groups[i].length,availability:'available'});}
   await atomicJson(jobsPath,jobs);
  }console.log(JSON.stringify({jobs:jobs.length}));return;
 }
 async function inspect(j){if(j.availability!=='available')return j.availability;const state=taskState(j,j.dataset==='maps'?await readJson(path.join(j.state,'manifest.json'),null):{plan:await readJson(path.join(j.state,'plan.json'),null),transfers:await readJson(path.join(j.state,'transfers.json'),null)});return j.rejectedCount&&state==='files-verified'?'needs-review':state;}
 if(command==='status'){
  const rows=[];for(const j of jobs)rows.push({id:j.id,region:j.region,dataset:j.dataset,status:await inspect(j)});
  const report={checkedAt:new Date().toISOString(),scope:'administrative polygons including islands/water in provider boundaries; data availability and independent alignment still require validation',districts:catalog.length,catalogued:catalog.filter(x=>x.status==='catalogued').length,inventoryErrors:catalog.filter(x=>x.status==='review'),jobs:rows,seoul:await readJson(path.join(cfg.existingSeoulState,'transfers.json'),null),osm:await readJson('research/osm/generated/pipeline-status.json',null),nationalComplete:false};
  await atomicJson(path.join(root,'status.json'),report);const counts={};for(const r of rows)counts[r.status]=(counts[r.status]??0)+1;console.log(JSON.stringify({districts:report.districts,catalogued:report.catalogued,inventoryErrors:report.inventoryErrors.length,jobs:counts,nationalComplete:false},null,2));return;
 }
 if(!['maps','satellite'].includes(a.dataset)||!['inventory','download','verify'].includes(a.phase))throw Error('Choose dataset and phase');
 if(a.dataset==='maps'&&a.phase==='inventory')throw Error('Use inventory then prepare for map catalogues (supports spatial subdivision)');
 if(a.dataset==='satellite'&&a.phase!=='verify'){
  const states={};for(const j of jobs.filter(j=>j.dataset==='maps'))states[j.id]=await inspect(j);
  if(!mapStageReady(catalog,jobs,states))throw Error('Satellite acquisition is last: finish nationwide 1:1000 inventory, preparation and available-file verification first; record unavailable areas explicitly');
 }
 // Run only after the existing Seoul scene queue is verified, without changing its process/state.
 const seoulPlan=await readJson(path.join(cfg.existingSeoulState,'plan.json'),null),seoulTransfer=await readJson(path.join(cfg.existingSeoulState,'transfers.json'),null);
 if(a.phase==='download'&&(!seoulPlan?.selected?.length||!seoulPlan.selected.every(s=>seoulTransfer?.scenes?.[s.id]?.status==='downloaded-header-checked')))throw Error('Seoul downloads are not finished; inventory/prepare remain available');
 let executed=0;
 for(const j of jobs.filter(j=>j.dataset===a.dataset&&(!a.region||j.region===a.region)&&j.availability==='available').sort((x,y)=>cfg.priority.indexOf(x.region)-cfg.priority.indexOf(y.region))){
  if(executed>=limit)break;const current=await inspect(j);if(a.phase==='download'&&['files-verified','coverage-gap'].includes(current))continue;if(j.lastError&&!a.retry)continue;
  if(j.dataset==='satellite'&&a.phase==='inventory'){const p=await readJson(path.join(j.state,'plan.json'),null);if(p?.inventoryComplete&&!a.retry)continue;}
  const stat=await fs.statfs(a.dataset==='maps'?cfg.mapOutput:cfg.satelliteInbox);if(Number(stat.bavail)*Number(stat.bsize)<cfg.minimumFreeGB*1e9)throw Error('Insufficient free disk space');
  if(a.phase==='download'&&j.dataset==='satellite'){
   const p=await readJson(path.join(j.state,'plan.json'),null);if(!p?.inventoryComplete||!p.selected?.length)throw Error(`${j.id}: complete inventory and nonempty plan required`);
   const names=await fs.readdir(cfg.satelliteInbox,{withFileTypes:true});let bytes=0;for(const f of names)if(f.isFile())bytes+=(await fs.stat(path.join(cfg.satelliteInbox,f.name))).size;
   const estimate=p.selected.reduce((n,s)=>n+(s.estimatedBytes??6e9),0);if(bytes+estimate>cfg.satelliteBudgetGB*1e9||Number(stat.bavail)*Number(stat.bsize)<estimate+cfg.minimumFreeGB*1e9)throw Error('Estimated satellite storage budget exceeded; adjust config after capacity review');
  }
  const args=j.dataset==='maps'?['scripts/collect-ngii.mjs','--state',j.state,'--scale',String(j.scale),'--district-code',j.district,'--output',cfg.mapOutput,'--inbox',cfg.mapInbox,'--channel',a.channel,...(a.phase==='verify'?['--status']:a.phase==='inventory'?['--inventory']:[])]:['scripts/collect-cas-imagery.mjs','--state',j.state,'--targets',j.targets,'--inbox',cfg.satelliteInbox,'--python',a.python,'--channel',a.channel,'--radius',String(cfg.radiusMeters),'--max-gb',String(cfg.jobMaxGB),'--max-scenes',String(cfg.jobMaxScenes),...(a.phase==='inventory'?['--inventory','--plan','--rgb-preview']:a.phase==='verify'?['--status']:['--download'])];
  if(a.retry&&a.phase==='download')args.push('--retry-review');
  executed++;j.lastStartedAt=new Date().toISOString();await atomicJson(jobsPath,jobs);
  try{await child(process.execPath,args);delete j.lastError;j.lastResult=await inspect(j);}catch(e){j.lastError=e.message;await atomicJson(jobsPath,jobs);throw e;}await atomicJson(jobsPath,jobs);
 }
 console.log(JSON.stringify({executed}));
 }finally{if(lock){await lock.close();await fs.unlink(path.join(root,'run.lock'));}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
