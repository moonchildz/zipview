import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { checkInventory, normalizeSheet, mergeSheets, nextBatch, reconcileFiles, writeJson } from './ngii-files.mjs';
import { MAP_URL, launchBrowser, districts, queryDistrict, ensureLogin, openApplication, openRequestedFromHistory, watchBrowserDownloads, startTransferPopup, pause } from './ngii-browser.mjs';
import { importNgiiInbox } from './ngii-inbox.mjs';
import {reconcileRawNgi,verifyRawNgi} from './ngii-raw.mjs';

const {values:args}=parseArgs({options:{
  inventory:{type:'boolean'}, status:{type:'boolean'}, refresh:{type:'boolean'}, help:{type:'boolean'},
  'interactive-login':{type:'boolean'},
  output:{type:'string',default:'mapinfo'}, state:{type:'string',default:'.tools/ngii-downloads'},
  inbox:{type:'string',default:path.join(os.homedir(),'Downloads')},
  channel:{type:'string',default:process.platform==='win32'?'msedge':'chromium'},
  'batch-size':{type:'string',default:'100'}, 'retry-pending':{type:'boolean'},
  'retry-review':{type:'boolean'}, 'retry-review-once':{type:'boolean'},
  'wait-minutes':{type:'string',default:'60'}
  ,scale:{type:'string',default:'1000'}, 'district-code':{type:'string'}, 'raw-format':{type:'string'}
}});
if(args.help) {
  console.log(`수치지도 2.0 수집 (기본: 서울 / 1:1,000)
npm run collect:mapinfo -- --inventory     공개 도엽 목록만 작성 (로그인 불필요)
npm run collect:mapinfo                    간편인증 후 다운로드 / 재개
npm run collect:mapinfo -- --status        로컬 ZIP/XML 검증 및 진행 현황
--output mapinfo --batch-size 100 --channel msedge|chrome|chromium
--interactive-login                         새 로그인 창을 한 번 열어 직접 인증할 때만 사용
--scale 1000 --district-code 26110          1:1,000 전용·시군구 선택 (별도 --state 사용)
--inbox C:\\Users\\User\\Downloads          외부 프로그램의 down_* 폴더 자동 가져오기
--refresh                                 공개 목록 갱신
--retry-pending                           미완료 신청의 재신청을 명시적으로 허용
--retry-review                            보류 자료를 다시 검증하고 필요하면 재신청
--wait-minutes 60                         묶음당 대기 시간. 시간 초과 자료는 보류 후 다음 묶음 진행
인증은 전용 브라우저에서 직접 진행합니다. 외부 전송 프로그램의 저장 폴더도 output으로 지정하세요.`);
  process.exit(0);
}
const output=path.resolve(args.output), stateDir=path.resolve(args.state), manifestPath=path.join(stateDir,'manifest.json');
globalThis.__zipviewNgiiTransferInbox=path.resolve(args.inbox);
globalThis.__zipviewNgiiTransferRawFormat=args['raw-format']??null;
const scale=Number(args.scale);if(scale!==1000)throw new Error('Policy: only 1:1000 maps are allowed; no fallback scale');
if(args['raw-format']&&args['raw-format']!=='ngi')throw new Error('Only raw NGI probe mode is supported');
const batchSize=Number(args['batch-size']), waitMs=Number(args['wait-minutes'])*60000;
nextBatch([],batchSize);
if(!Number.isFinite(waitMs)||waitMs<=0)throw new Error('wait-minutes는 양수여야 합니다.');
await fs.mkdir(output,{recursive:true});await fs.mkdir(stateDir,{recursive:true});
const lockPath=path.join(stateDir,'run.lock');
let lock;
try {lock=await fs.open(lockPath,'wx');}
catch(error) {
  if(error.code!=='EEXIST')throw error;
  const oldPid=Number((await fs.readFile(lockPath,'utf8').catch(()=>'' )).trim());
  const age=Date.now()-(await fs.stat(lockPath)).mtimeMs;
  let alive=false;
  if(Number.isSafeInteger(oldPid)&&oldPid>0) {
    try {process.kill(oldPid,0);alive=true;}
    catch(checkError){if(checkError.code!=='ESRCH')alive=true;}
  }
  if(alive||age<60000)throw new Error(`다른 수집기가 실행 중이거나 최근 시작했습니다: ${lockPath}`);
  await fs.rename(lockPath,`${lockPath}.stale-${Date.now()}`);
  lock=await fs.open(lockPath,'wx');
}
let browser, keepAlive, stopped=false;
process.on('SIGINT',()=>{stopped=true;console.log('현재 상태를 보존하고 종료합니다.');});
process.on('SIGTERM',()=>{stopped=true;});
let manifest={schemaVersion:1,source:MAP_URL,product:'수치지도2.0',scale,districts:[],sheets:[]};
const cache=new Map();
const inboxCache=new Map();
async function importInbox(sheets) {
  if(args['raw-format']==='ngi'){
    const before=sheets.filter(s=>s.status==='verified').length;
    const changed=await reconcileRawNgi(sheets,args.inbox,output);
    if(changed){
      const imported=sheets.filter(s=>s.status==='verified').length-before;
      if(imported)console.log(`NGI/NDA/XML 원본 ${imported}개 묶음 검증 및 보존 완료`);
      if(changed>imported)console.log(`원본 전송 이상 ${changed-imported}개 검토 기록`);
      await save();
    }
    return;
  }
  if(path.resolve(args.inbox)===output)return;
  try {
    const before=JSON.stringify(sheets.filter(s=>s.status==='review').map(s=>s.key));
    const {imported,reviews}=await importNgiiInbox({sheets,inbox:args.inbox,output,cache:inboxCache});
    if(imported.length)console.log(`외부 다운로드 폴더에서 ${imported.length}개 ZIP/XML 검증 및 복사 완료`);
    if(before!==JSON.stringify(sheets.filter(s=>s.status==='review').map(s=>s.key))) {
      for(const review of reviews)console.log(`검토 보류 ${review.number}: ${review.reason}. 다음 자료를 계속 진행합니다.`);
      await save();
    }
  } catch(error) {if(error.code!=='ENOENT')throw error;}
}
const save=()=>writeJson(manifestPath,manifest);
const summary=()=> {
  const counts=Object.fromEntries(['pending','requested','verified','review'].map(s=>[s,manifest.sheets.filter(x=>x.status===s).length]));
  console.log(JSON.stringify({districts:manifest.districts.length,sheets:manifest.sheets.length,...counts,output},null,2));
};
try {
  await lock.writeFile(String(process.pid));
  try {manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));}
  catch(error) {if(error.code!=='ENOENT')throw error;}
  if(manifest.schemaVersion!==1||manifest.product!=='수치지도2.0'||manifest.scale!==scale)throw new Error('지원하지 않는 수집 상태 파일');
  if(args.status) {
    if(args['raw-format']==='ngi'){
      await verifyRawNgi(manifest.sheets,output);await importInbox(manifest.sheets);
    }else await reconcileFiles(manifest.sheets,output,cache);
    await save();summary();
  } else {
    const needInventory=args.inventory||args.refresh||!manifest.inventoryCheckedAt;
    if(needInventory) {
      browser=await launchBrowser({inventory:true,channel:args.channel});
      const areas=args['district-code']?(await districts(browser.page,'')).filter(x=>String(x.code)===args['district-code']):await districts(browser.page);
      if(args['district-code']?areas.length!==1:areas.length!==25 || new Set(areas.map(x=>x.code)).size!==25)throw new Error('행정구역 목록을 확인하지 못했습니다.');
      const groups=[], coverage=[];
      for(const area of areas) {
        if(stopped)throw new Error('중단됨');
        const data=await queryDistrict(browser.page,area.code);
        checkInventory(data.counts,data.items);
        const sheets=data.items.filter(x=>String(x.scale)===String(scale)).map(x=>normalizeSheet(x,area.name,scale));
        if(!sheets.length)throw new Error(`${area.name}: 1:${scale} 목록이 없습니다. 전체 완료 처리 중단`);
        groups.push(sheets);coverage.push({...area,totalV2:data.items.length,selectedScale:scale,selectedSheets:sheets.length});
        console.log(`${area.name}: 2.0 집계 ${data.items.length}개 일치, 1:${scale} ${sheets.length}개`);
        await pause(700);
      }
      manifest={...manifest,districts:coverage,sheets:mergeSheets(groups,manifest.sheets),inventoryCheckedAt:new Date().toISOString()};
      await save();await browser.close();browser=null;
    }
    if(args['retry-review']||args['retry-review-once']) {
      for(const sheet of manifest.sheets)if(sheet.status==='review'
          &&(!args['retry-review-once']||(sheet.reviewRetryCount??0)<1)){
        sheet.reviewRetryCount=(sheet.reviewRetryCount??0)+1;
        sheet.status='pending';delete sheet.review;
      }
    }
    if(args['raw-format']==='ngi')await verifyRawNgi(manifest.sheets,output);
    await importInbox(manifest.sheets);
    if(args['raw-format']!=='ngi')await reconcileFiles(manifest.sheets,output,cache);
    await save();summary();
    if(!args.inventory && manifest.sheets.some(x=>['pending','requested'].includes(x.status))) {
      if(args['retry-pending']) {
        for(const sheet of manifest.sheets)if(sheet.status==='requested')sheet.status='pending';
        await save();
      }
      browser=await launchBrowser({channel:args.channel});
      let downloadError=null;
      watchBrowserDownloads(browser.context,output,message=>{downloadError=message;console.error(message);},{allowNgi:args['raw-format']==='ngi'});
      await ensureLogin(browser.page,()=>stopped,{allowPrompt:args['interactive-login']===true});
      keepAlive=setInterval(()=>browser?.page?.evaluate(()=>fetch('/mn/loginCheck.do',{method:'POST'}).then(r=>r.json()).then(d=>d.isLogin)).catch(()=>{}),240000);
      while(!stopped) {
        // An interrupted or timed-out request is watched first, never silently submitted twice.
        let batch=manifest.sheets.filter(x=>x.status==='requested');
        if(!batch.length) {
          batch=nextBatch(manifest.sheets,batchSize);
          if(!batch.length)break;
          await ensureLogin(browser.page,()=>stopped,{allowPrompt:false});
          for(const sheet of batch)sheet.status='requested';
          await save();
          console.log(`${batch.length}개 신청 준비 (${batch[0].number} ~ ${batch.at(-1).number})`);
          try {await openApplication(browser.page,batch);}
          catch(error) {
            if(['APPLICATION_FORM_INCOMPLETE','APPLICATION_REJECTED'].includes(error.code)) {
              for(const sheet of batch)sheet.status='pending';
              await save();
            }
            throw error;
          }
        } else console.log(`기존 신청 ${batch.length}개 파일을 먼저 기다립니다. 필요하면 사이트 신청 내역에서 해당 다운로드를 다시 여세요.`);
        console.log(args['raw-format']==='ngi'
          ? `NGI 원본 전송 창의 저장 위치를 ${args.inbox} 로 지정하세요. NGI/NDA/XML 검증 후 ${output} 에 원본을 보존합니다.`
          : `전송 창/외부 다운로드 프로그램에서 저장 위치를 ${output} 로 지정하세요. ZIP과 XML이 모두 필요합니다.`);
        const attempted=new WeakSet();
        let historyPage=null,historyAttempts=0,lastHistoryAt=0,lastProgressAt=Date.now(),lastResolved=-1;
        let lastLog=0;
        while(!stopped && batch.some(x=>!['verified','review'].includes(x.status))) {
          if(browser.page.isClosed())throw new Error('작업 브라우저가 닫혔습니다. 상태는 저장되어 있습니다.');
          await startTransferPopup(browser.context,attempted);
          await importInbox(batch);
          if(args['raw-format']!=='ngi'&&await reconcileFiles(batch,output,cache))await save();
          if(downloadError)throw new Error(downloadError);
          const resolved=batch.filter(x=>['verified','review'].includes(x.status)).length;
          if(resolved>lastResolved){lastResolved=resolved;lastProgressAt=Date.now();}
          const outstanding=batch.filter(x=>x.status==='requested');
          const transferOpen=browser.context.pages().some(page=>!page.isClosed()&&
            /^https:\/\/(?:map\.ngii\.go\.kr\/pd\/purchs\/download\.do|nlippd\.ngii\.go\.kr\/nlippd\/pd\/innorix\/innorixdownLoad\.do)(?:[?#]|$)/.test(page.url()));
          const idleMs=Date.now()-lastProgressAt;
          if(args['raw-format']==='ngi'&&outstanding.length&&historyAttempts<3
              &&idleMs>(transferOpen?180000:30000)&&Date.now()-lastHistoryAt>60000) {
            historyAttempts++;lastHistoryAt=Date.now();
            if(historyPage&&!historyPage.isClosed())await historyPage.close();
            console.log(`전송 정체: 신청 내역에서 남은 ${outstanding.length}장만 다시 엽니다 (${historyAttempts}/3).`);
            try {historyPage=await openRequestedFromHistory(browser.context,outstanding);}
            catch(error){if(error.code!=='HISTORY_NOT_READY')throw error;console.log(error.message);}
          }
          if(Date.now()-lastLog>30000) {console.log(`현재 묶음 파일 검증 ${batch.filter(x=>x.status==='verified').length}/${batch.length}`);lastLog=Date.now();}
          if(Date.now()-lastProgressAt>waitMs)
            throw new Error(`전송 정체: ${outstanding.length}장을 신청 상태로 보존했습니다. 새 신청 없이 신청 내역에서 재개해야 합니다.`);
          await pause(3000);
        }
        if(historyPage&&!historyPage.isClosed())await historyPage.close();
      }
      await save();summary();
      if(!stopped&&manifest.sheets.every(x=>x.status==='verified'))console.log('수집 목록의 모든 ZIP/XML 검증 완료. 앱 지형 데이터 반영은 별도 단계입니다.');
      else if(!stopped)console.log('일괄 다운로드 종료. review 상태 자료는 미완료이며 재검토가 필요합니다.');
    }
  }
} catch(error) {
  console.error(error.message);
  process.exitCode=error.code==='APPLICATION_FORM_INCOMPLETE'||/NGII login expired/.test(error.message)?3:1;
} finally {
  if(keepAlive)clearInterval(keepAlive);
  if(browser)await browser.close().catch(()=>{});
  await lock.close();await fs.unlink(lockPath);
}
