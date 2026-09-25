import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {atomicJson} from './atomic-json.mjs';
import {continueCasDownloads} from './cas-download-loop.mjs';
import {normalizeTargets,targetCells,sceneFromRow,planScenes,contains} from './cas-imagery-plan.mjs';
import {measureRgbPreview} from './cas-rgb-preview.mjs';
import {openCasBrowser,searchCas,waitCasLogin,startCasKeepalive,pause,watchBrowserDownloads,CAS_URL} from './cas-browser.mjs';

const {values:a}=parseArgs({options:{help:{type:'boolean'},inventory:{type:'boolean'},plan:{type:'boolean'},download:{type:'boolean'},status:{type:'boolean'},'rgb-preview':{type:'boolean'},
  targets:{type:'string',default:'research/seoul/raw/apartments.json'},state:{type:'string',default:'.tools/cas-imagery'},
  inbox:{type:'string',default:'satellite'},channel:{type:'string',default:'chrome'},python:{type:'string',default:'python'},
  start:{type:'string',default:'2021-01-01'},end:{type:'string',default:new Date().toISOString().slice(0,10)},
  'max-queries':{type:'string',default:'150'},'max-gb':{type:'string',default:'1000'},'max-scenes':{type:'string',default:'166'},
  'min-sun':{type:'string',default:'40'},'max-cloud':{type:'string',default:'0'},'max-tilt':{type:'string',default:'20'},
  radius:{type:'string',default:'300'},'wait-minutes':{type:'string',default:'60'},'retry-review':{type:'boolean'}}});
if(a.help){console.log(`국토위성 아파트 영역 수집 (모델 호출 없음)
node scripts/collect-cas-imagery.mjs --inventory --plan --targets apartments.json
node scripts/collect-cas-imagery.mjs --download --inbox C:\\Users\\User\\Downloads\\satellite
node scripts/collect-cas-imagery.mjs --status --inbox C:\\Users\\User\\Downloads\\satellite
기본 좌표 목록은 서울만 포함합니다. 전국은 {id,name,point:[lon,lat]} 배열 또는 GeoJSON Point 목록을 지정하세요.
--max-gb 1000 --max-scenes 166 --min-sun 40 --max-cloud 0 --max-tilt 20 --radius 300
--plan --rgb-preview   컬러 미리보기의 동일 아파트 격자 밝기 비교 (고해상도 TIFF 다운로드 없음)
목록만 수집/선정하며 --download 전에는 TIFF를 요청하지 않습니다. 최초 인증·신청서 입력은 브라우저에서 진행합니다.
중단 후 같은 명령으로 재개. requested 상태는 재신청하지 않으며 전송을 먼저 확인합니다.
--retry-review 는 검토 보류된 전송의 재신청을 명시적으로 허용합니다.`);process.exit(0);}
if(![a.inventory,a.plan,a.download,a.status].some(Boolean))throw new Error('Choose --inventory, --plan, --download or --status');
const dir=path.resolve(a.state),inbox=path.resolve(a.inbox);await fs.mkdir(dir,{recursive:true});
const save=(name,data)=>atomicJson(path.join(dir,name+'.json'),data);
const read=async(name,fallback)=>{try{return JSON.parse(await fs.readFile(path.join(dir,name+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
let stopped=false,browser,stopKeepalive;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
const stopPath=path.join(dir,'STOP');const shouldStop=async()=>stopped||await fs.stat(stopPath).then(()=>true,()=>false);
const lockPath=path.join(dir,'run.lock');let lock;
try{lock=await fs.open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(await fs.readFile(lockPath,'utf8'));if(!Number.isInteger(pid)||pid<1)throw new Error('Invalid lock');try{process.kill(pid,0);throw new Error('CAS collector already running: '+pid);}catch(err){if(err.code!=='ESRCH')throw err;}await fs.unlink(lockPath);lock=await fs.open(lockPath,'wx');}
await lock.writeFile(String(process.pid));
function verify(id){const r=spawnSync(a.python,['scripts/verify-cas-files.py',inbox,id],{encoding:'utf8',windowsHide:true,maxBuffer:1024*1024});if(r.error)throw r.error;try{return JSON.parse(r.stdout);}catch{throw new Error('CAS file verifier failed');}}
try{
  let transfer=await read('transfers',{scenes:{}});
  if(a.inventory||a.plan){
    const bytes=await fs.readFile(a.targets),targetHash=createHash('sha256').update(bytes).digest('hex');
    const input=normalizeTargets(JSON.parse(bytes)),cells=targetCells(input.targets,{radiusMeters:Number(a.radius)});
    if(!cells.length)throw new Error('No apartment coordinates');
    let catalog=await read('catalog',{queryVersion:2,queries:{},rows:[]});
    if(catalog.queryVersion!==2)catalog={queryVersion:2,queries:{},rows:[]};
    if(a.inventory){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(a.start)||!/^\d{4}-\d{2}-\d{2}$/.test(a.end)||!(Date.parse(a.start)<=Date.parse(a.end)))throw new Error('Invalid date interval');
      const budget=Number(a['max-queries']);if(!Number.isInteger(budget)||budget<1)throw new Error('Invalid query budget');
      browser=await openCasBrowser({channel:a.channel});let calls=0;
      // Query only occupied geographic cells; split saturated date intervals instead of trusting truncated lists.
      const regions=new Map();for(const c of cells){const x=Math.floor(c.center[0]*4),y=Math.floor(c.center[1]*4);regions.set(`${x}:${y}`,[x/4-.005,y/4-.005,(x+1)/4+.005,(y+1)/4+.005]);}
      async function query(bounds,start,end){
        const key=JSON.stringify({bounds,start,end}),cached=catalog.queries[key];
        if(cached?.complete)return true;
        if(calls>=budget||await shouldStop())return false;
        await pause(1000);const rows=await searchCas(browser.page,{bounds,start,end});calls++;
        catalog.rows=[...new Map([...catalog.rows,...rows].map(r=>[r.CATALOGTYPE+':'+r.CATALOGID,r])).values()];
        const saturated=rows.length>=499;catalog.queries[key]={count:rows.length,complete:!saturated,checkedAt:new Date().toISOString()};await save('catalog',catalog);
        console.log(JSON.stringify({stage:'catalog',calls,rows:rows.length,unique:catalog.rows.length,start,end}));
        if(!saturated)return true;
        const days=Math.round((Date.parse(end)-Date.parse(start))/86400000);if(days<1)return false;
        const mid=new Date(Date.parse(start)+Math.floor(days/2)*86400000).toISOString().slice(0,10);
        const next=new Date(Date.parse(mid)+86400000).toISOString().slice(0,10);
        const left=await query(bounds,start,mid),right=await query(bounds,next,end);
        if(left&&right){catalog.queries[key].complete=true;catalog.queries[key].split=true;await save('catalog',catalog);}return left&&right;
      }
      let complete=true;for(const bounds of regions.values()){if(!await query(bounds,a.start,a.end))complete=false;if(await shouldStop())break;}
      catalog.inventory={targetHash,scope:input.scope,start:a.start,end:a.end,complete:complete&&!await shouldStop(),regions:regions.size,calls};await save('catalog',catalog);
      await browser.close();browser=null;
    }
    if(a.plan){
      const scenes=catalog.rows.map(sceneFromRow).filter(Boolean);
      let previewScores=null;
      if(a['rgb-preview']){
        let previews=await read('rgb-previews',{version:1,targetHash,radius:Number(a.radius),scenes:{}});
        if(previews.version!==1||previews.targetHash!==targetHash||previews.radius!==Number(a.radius))previews={version:1,targetHash,radius:Number(a.radius),scenes:{}};
        const eligible=scenes.filter(s=>s.cloud!==null&&s.cloud<=Number(a['max-cloud'])&&s.roll!==null&&s.pitch!==null&&Math.max(Math.abs(s.roll),Math.abs(s.pitch))<=Number(a['max-tilt'])&&s.sunElevation>=Number(a['min-sun'])&&cells.some(c=>c.corners.every(p=>contains(p,s.ring))));
        let previewBytes=0;
        for(const s of eligible){
          if(await shouldStop())break;
          if(previews.scenes[s.id]?.scores)continue;
          if(previewBytes>=512_000_000)throw new Error('Preview session reached 512 MB; rerun to resume');
          if(!browser)browser=await openCasBrowser({channel:a.channel});
          await pause(1000);
          try{const result=await measureRgbPreview(browser.page,s,cells,path.join(dir,'previews'));previewBytes+=result.downloadedBytes;previews.scenes[s.id]=result;}
          catch(e){if(/HTTP (403|429)/.test(e.message))throw e;previews.scenes[s.id]={error:e.message};}
          await save('rgb-previews',previews);
          console.log(JSON.stringify({stage:'RGB-preview',id:s.id,measured:Object.values(previews.scenes).filter(x=>x.scores).length,total:eligible.length,downloadMB:Math.round(previewBytes/1e6)}));
        }
        previewScores=previews.scenes;
        if(browser){await browser.close();browser=null;}
      }
      const localNames=new Set((await fs.readdir(inbox,{recursive:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).map(p=>path.basename(p)));
      const existing=[];for(const s of scenes){if(!localNames.has(s.id+'_L2G_Aux.xml'))continue;const v=verify(s.id);if(v.status==='downloaded-header-checked'){existing.push(s.id);transfer.scenes[s.id]={...transfer.scenes[s.id],...v};}}
      const plan=planScenes(cells,scenes,{maxGB:Number(a['max-gb']),maxScenes:Number(a['max-scenes']),minSun:Number(a['min-sun']),maxCloud:Number(a['max-cloud']),maxTilt:Number(a['max-tilt']),existingIds:existing,previewScores,qualityTolerance:previewScores?0:.2});
      Object.assign(plan,{source:CAS_URL,targetHash,targetScope:input.scope,targetCount:input.targets.length,rejectedTargets:input.rejected,
        inventoryComplete:catalog.inventory?.targetHash===targetHash&&catalog.inventory?.complete===true,radiusMeters:Number(a.radius)});
      await save('plan',plan);await save('transfers',transfer);
      const summary={targetScope:plan.targetScope,targets:plan.targetCount,rejectedTargets:input.rejected.length,inventoryComplete:plan.inventoryComplete,candidates:scenes.length,selected:plan.selected.length,estimatedDownloadGB:plan.estimatedDownloadGB,plannedCoveredCells:plan.plannedCoveredCells,totalCells:plan.totalCells,incompleteTargets:plan.incompleteTargetIds.length,qualityBasis:plan.policy.qualityBasis};
      await save('summary',summary);console.log(JSON.stringify(summary,null,2));
      const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      const html=`<!doctype html><meta charset="utf-8"><title>위성영상 수집 계획</title><style>body{font:16px sans-serif;max-width:1200px;margin:32px auto}td,th{padding:12px;border-bottom:1px solid #ddd}table{border-collapse:collapse}p{line-height:1.6}</style><h1>아파트 주변 위성정사영상 수집 계획</h1><p>좌표 목록: ${escape(plan.targetScope)} · ${plan.targetCount}개 · 예상 다운로드 ${plan.estimatedDownloadGB.toFixed(1)}GB<br>계획 범위 ${plan.plannedCoveredCells}/${plan.totalCells} 격자. 미완료 아파트 ${plan.incompleteTargetIds.length}개.<br>영상의 검은 여백·건물 그림자는 아직 검증하지 않았습니다. 태양 고도는 촬영 ID 시각으로 계산한 추정치입니다.</p><table><tr><th>영상 ID</th><th>촬영일</th><th>예상 태양 고도</th><th>운량</th><th>신규 격자</th><th>수신 여부</th></tr>${plan.selected.map(s=>`<tr><td>${escape(s.id)}</td><td>${s.capturedAt.slice(0,10)}</td><td>${s.sunElevation.toFixed(1)}°</td><td>${s.cloud}</td><td>${s.newCells.length}</td><td>${s.alreadyPresent?'로컬 파일 있음':'RGB PS + XML 예정'}</td></tr>`).join('')}</table>`;
      const qualityNote=previewScores?'RGB 컬러 미리보기의 동일 구역 밝기 비교 · 원본 PS 합성 검증 전':'태양 고도·촬영 기울기 기반 추정';
      await fs.writeFile(path.join(dir,'review.html'),html.replace('</h1>',`</h1><p>선정 기준: ${qualityNote} · 예산 ${plan.policy.maxGB}GB</p>`));
    }
  }
  if(a.status||a.download){
    const plan=await read('plan',null);if(!plan)throw new Error('Create a plan first');
    await fs.mkdir(inbox,{recursive:true});
    for(const s of plan.selected){const v=verify(s.id);if(v.status==='downloaded-header-checked')transfer.scenes[s.id]={...transfer.scenes[s.id],...v};}
    await save('transfers',transfer);
    if(a.download){
      const waitMs=Number(a['wait-minutes'])*60000;if(!(waitMs>0))throw new Error('Invalid wait limit');
      browser=await openCasBrowser({interactive:true,channel:a.channel});
      stopKeepalive=startCasKeepalive(browser.page,{shouldStop,onStatus:status=>save('session-activity',status)});
      watchBrowserDownloads(browser.context,inbox,message=>console.error(message));
      await waitCasLogin(browser.page,shouldStop);
      transfer=await continueCasDownloads({browser,stateDir:dir,inbox,python:a.python,waitMs,retryReview:a['retry-review'],shouldStop});
    }
    console.log(JSON.stringify({selected:plan.selected.length,states:Object.fromEntries(plan.selected.map(s=>[s.id,transfer.scenes[s.id]?.status??'pending']))},null,2));
    if(a.download&&!await shouldStop()&&plan.selected.some(s=>transfer.scenes[s.id]?.status!=='downloaded-header-checked')){
      console.log('미완료 전송이 있어 브라우저를 유지합니다. 확인 후 창을 닫거나 Ctrl+C로 종료하세요.');
      while(!await shouldStop()&&!browser.page.isClosed())await pause(1000);
    }
  }
}catch(error){
  console.error(error.message);process.exitCode=1;
  // Preserve an interactive certificate/transfer session after errors until explicitly closed.
  if(browser&&a.download){console.log('오류로 멈췄습니다. 인증·전송 창은 유지합니다. 창을 닫거나 Ctrl+C로 종료하세요.');while(!stopped&&!browser.page.isClosed())await pause(1000);}
}finally{stopKeepalive?.();if(browser)await browser.close();await lock.close();await fs.unlink(lockPath);}
