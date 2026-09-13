import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { checkInventory, normalizeSheet, mergeSheets, nextBatch, reconcileFiles, writeJson } from './ngii-files.mjs';
import { MAP_URL, launchBrowser, districts, queryDistrict, ensureLogin, openApplication, watchBrowserDownloads, startTransferPopup, pause } from './ngii-browser.mjs';
import { importNgiiInbox } from './ngii-inbox.mjs';

const {values:args}=parseArgs({options:{
  inventory:{type:'boolean'}, status:{type:'boolean'}, refresh:{type:'boolean'}, help:{type:'boolean'},
  output:{type:'string',default:'mapinfo'}, state:{type:'string',default:'.tools/ngii-downloads'},
  inbox:{type:'string',default:path.join(os.homedir(),'Downloads')},
  channel:{type:'string',default:process.platform==='win32'?'msedge':'chromium'},
  'batch-size':{type:'string',default:'100'}, 'retry-pending':{type:'boolean'}, 'retry-review':{type:'boolean'},
  'wait-minutes':{type:'string',default:'60'}
}});
if(args.help) {
  console.log(`서울 수치지도 2.0 / 1:1,000 수집
npm run collect:mapinfo -- --inventory     공개 도엽 목록만 작성 (로그인 불필요)
npm run collect:mapinfo                    간편인증 후 다운로드 / 재개
npm run collect:mapinfo -- --status        로컬 ZIP/XML 검증 및 진행 현황
--output mapinfo --batch-size 100 --channel msedge|chrome|chromium
--inbox C:\\Users\\User\\Downloads          외부 프로그램의 down_* 폴더 자동 가져오기
--refresh                                 공개 목록 갱신
--retry-pending                           미완료 신청의 재신청을 명시적으로 허용
--retry-review                            보류 자료를 다시 검증하고 필요하면 재신청
--wait-minutes 60                         묶음당 대기 시간. 시간 초과 자료는 보류 후 다음 묶음 진행
인증은 전용 브라우저에서 직접 진행합니다. 외부 전송 프로그램의 저장 폴더도 output으로 지정하세요.`);
  process.exit(0);
}
const output=path.resolve(args.output), stateDir=path.resolve(args.state), manifestPath=path.join(stateDir,'manifest.json');
const batchSize=Number(args['batch-size']), waitMs=Number(args['wait-minutes'])*60000;
nextBatch([],batchSize);
if(!Number.isFinite(waitMs)||waitMs<=0)throw new Error('wait-minutes는 양수여야 합니다.');
await fs.mkdir(output,{recursive:true});await fs.mkdir(stateDir,{recursive:true});
const lockPath=path.join(stateDir,'run.lock');
let lock;
try {lock=await fs.open(lockPath,'wx');}
catch(error) {if(error.code==='EEXIST')throw new Error(`다른 수집기가 실행 중이거나 강제 종료 흔적이 있습니다. 실행 여부를 확인한 뒤 ${lockPath}를 제거하세요.`);throw error;}
let browser, stopped=false;
process.on('SIGINT',()=>{stopped=true;console.log('현재 상태를 보존하고 종료합니다.');});
process.on('SIGTERM',()=>{stopped=true;});
let manifest={schemaVersion:1,source:MAP_URL,product:'수치지도2.0',scale:1000,districts:[],sheets:[]};
const cache=new Map();
const inboxCache=new Map();
async function importInbox(sheets) {
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
  if(manifest.schemaVersion!==1||manifest.product!=='수치지도2.0'||manifest.scale!==1000)throw new Error('지원하지 않는 수집 상태 파일');
  if(args.status) {
    await reconcileFiles(manifest.sheets,output,cache);await save();summary();
  } else {
    const needInventory=args.inventory||args.refresh||!manifest.inventoryCheckedAt;
    if(needInventory) {
      browser=await launchBrowser({inventory:true,channel:args.channel});
      const areas=await districts(browser.page);
      if(areas.length!==25 || new Set(areas.map(x=>x.code)).size!==25)throw new Error('서울 25개 구 목록을 확인하지 못했습니다.');
      const groups=[], coverage=[];
      for(const area of areas) {
        if(stopped)throw new Error('중단됨');
        const data=await queryDistrict(browser.page,area.code);
        checkInventory(data.counts,data.items);
        const sheets=data.items.filter(x=>String(x.scale)==='1000').map(x=>normalizeSheet(x,area.name));
        if(!sheets.length)throw new Error(`${area.name}: 1:1,000 목록이 없습니다. 전체 완료 처리 중단`);
        groups.push(sheets);coverage.push({...area,totalV2:data.items.length,sheets1000:sheets.length});
        console.log(`${area.name}: 2.0 집계 ${data.items.length}개 일치, 1:1,000 ${sheets.length}개`);
        await pause(700);
      }
      manifest={...manifest,districts:coverage,sheets:mergeSheets(groups,manifest.sheets),inventoryCheckedAt:new Date().toISOString()};
      await save();await browser.close();browser=null;
    }
    if(args['retry-review']) {
      for(const sheet of manifest.sheets)if(sheet.status==='review'){sheet.status='pending';delete sheet.review;}
    }
    await importInbox(manifest.sheets);
    await reconcileFiles(manifest.sheets,output,cache);await save();summary();
    if(!args.inventory && manifest.sheets.some(x=>['pending','requested'].includes(x.status))) {
      if(args['retry-pending']) {
        for(const sheet of manifest.sheets)if(sheet.status==='requested')sheet.status='pending';
        await save();
      }
      browser=await launchBrowser({channel:args.channel});
      let downloadError=null;
      watchBrowserDownloads(browser.context,output,message=>{downloadError=message;console.error(message);});
      await ensureLogin(browser.page,()=>stopped);
      while(!stopped) {
        // An interrupted or timed-out request is watched first, never silently submitted twice.
        let batch=manifest.sheets.filter(x=>x.status==='requested');
        if(!batch.length) {
          batch=nextBatch(manifest.sheets,batchSize);
          if(!batch.length)break;
          await ensureLogin(browser.page,()=>stopped);
          for(const sheet of batch)sheet.status='requested';
          await save();
          console.log(`${batch.length}개 신청 준비 (${batch[0].number} ~ ${batch.at(-1).number})`);
          await openApplication(browser.page,batch);
        } else console.log(`기존 신청 ${batch.length}개 파일을 먼저 기다립니다. 필요하면 사이트 신청 내역에서 해당 다운로드를 다시 여세요.`);
        console.log(`전송 창/외부 다운로드 프로그램에서 저장 위치를 ${output} 로 지정하세요. ZIP과 XML이 모두 필요합니다.`);
        const deadline=Date.now()+waitMs, attempted=new WeakSet();
        let lastLog=0;
        while(!stopped && batch.some(x=>!['verified','review'].includes(x.status))) {
          if(browser.page.isClosed())throw new Error('작업 브라우저가 닫혔습니다. 상태는 저장되어 있습니다.');
          await startTransferPopup(browser.context,attempted);
          await importInbox(batch);
          if(await reconcileFiles(batch,output,cache))await save();
          if(downloadError)throw new Error(downloadError);
          if(Date.now()-lastLog>30000) {console.log(`현재 묶음 파일 검증 ${batch.filter(x=>x.status==='verified').length}/${batch.length}`);lastLog=Date.now();}
          if(Date.now()>deadline) {
            for(const sheet of batch)if(!['verified','review'].includes(sheet.status)) {
              sheet.status='review';sheet.review={reason:'transfer-timeout',checkedAt:new Date().toISOString()};
            }
            await save();console.log('대기 시간이 지난 자료를 검토 보류하고 다음 묶음을 진행합니다.');
            break;
          }
          await pause(3000);
        }
      }
      await save();summary();
      if(!stopped&&manifest.sheets.every(x=>x.status==='verified'))console.log('수집 목록의 모든 ZIP/XML 검증 완료. 앱 지형 데이터 반영은 별도 단계입니다.');
      else if(!stopped)console.log('일괄 다운로드 종료. review 상태 자료는 미완료이며 재검토가 필요합니다.');
    }
  }
} catch(error) {
  console.error(error.message);process.exitCode=1;
  if(browser&&!args.inventory&&!stopped&&!browser.page.isClosed()) {
    console.log('자동 처리가 오류로 멈췄습니다. 인증·전송 창은 닫지 않고 유지합니다. 확인 후 작업 창을 닫거나 Ctrl+C로 종료하세요.');
    while(!stopped&&!browser.page.isClosed())await pause(1000);
  }
} finally {
  if(browser)await browser.close().catch(()=>{});
  await lock.close();await fs.unlink(lockPath);
}
