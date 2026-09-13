import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';

const offline=process.argv.includes('--offline'),steps=[];
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}};
function run(id,script,args=[]){
  console.log(`Target pipeline: ${id}`);
  const result=spawnSync(process.execPath,[script,...args],{stdio:'inherit'});
  steps.push({id,status:result.status===0?'passed':'failed',exitCode:result.status,error:result.error?.message});
  if(result.status!==0)throw new Error(`Target stage failed: ${id}`);
}
let failure;
try{
  if(!offline){
    for(const address of ['서울특별시 종로구 송월길 99','서울특별시 서대문구 북아현로1길 50'])run('provider-plans','scripts/address-pipeline.mjs',[address]);
    run('supplement-images','scripts/download-plan-supplements.mjs');
    run('additional-source-images','scripts/collect-additional-sources.mjs');
    run('sh-official-drawings','scripts/collect-sh-plans.mjs');
    run('evidence-review','scripts/build-evidence-review.mjs');
    const buildings=await read('research/linkage/downloads/hub/target-buildings.json');
    if(!['gyeonghuigung-xi','sinchon-prugio'].every(id=>buildings?.targets?.some(t=>t.id===id&&t.status==='complete-search')))run('official-buildings','scripts/collect-target-buildings.mjs');
    const blueprints=await read('research/linkage/generated/target-blueprint-probe.json');
    if(!['gyeonghuigung-xi','sinchon-prugio'].every(id=>blueprints?.targets?.some(t=>t.id===id&&t.files?.some(f=>f.file&&existsSync(f.file)))))run('site-blueprints','scripts/probe-target-blueprints.mjs');
    run('sinchon-footprint-crosswalk','scripts/rebuild-sinchon-footprints.mjs');
    const inventory=await read('research/linkage/downloads/housing/target-units.json');
    if(inventory?.sha256!=='bbadcb0e85787f3db157b199a6b9df1601e995228a3976106ec5440c2cd8935c'){
      run('housing-download','scripts/download-housing-inventory.mjs');
      run('housing-extraction','scripts/extract-housing-inventory.mjs');
    }
    run('line-charts','scripts/extract-image-charts.mjs');
  }
  run('terrain-floor-views','scripts/elevation-pipeline.mjs',offline?['--offline']:[]);
  run('audit','scripts/audit-target-flow.mjs');
}catch(e){failure=e.message;}
const audit=await read('research/linkage/generated/target-flow-audit.json');
// A previous successful audit cannot mask a failure in this execution.
const complete=!failure&&audit?.complete===true;
const elevations=await read('research/linkage/generated/elevation-pipeline.json');
const estimatedComplete=!failure&&elevations?.complete===true;
await mkdir('research/linkage/generated',{recursive:true});
const report={checkedAt:new Date().toISOString(),offline,complete,estimatedComplete,steps,failure:failure??null,
  targets:failure?[]:(audit?.targets??[]).map(({buildings,...t})=>t)};
await writeFile('research/linkage/generated/target-pipeline.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
process.exitCode=failure?1:complete||estimatedComplete?0:2;
