import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {load} from 'cheerio';
const root='research/linkage/downloads/evidence/myhome';await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.goto('https://www.myhome.go.kr/');
  await page.waitForURL('**/getMgtMainHubPage.do',{timeout:30000});
  await page.goto('https://www.myhome.go.kr/hws/portal/sch/selectRentalHouseInfoListView.do');
  await page.waitForFunction(()=>document.querySelector('#brtcCode')?.options.length>1);
  if(!await page.locator('#brtcCode').isVisible())await page.locator('.btn-open-searchbox').click();
  const seoul=await page.locator('#brtcCode option').evaluateAll(rows=>rows.find(r=>r.textContent.includes('서울'))?.value);
  if(!seoul)throw new Error('Seoul option missing');await page.selectOption('#brtcCode',seoul);
  await page.waitForFunction(()=>[...document.querySelector('#signguCode').options].some(r=>r.textContent.includes('서대문')));
  const district=await page.locator('#signguCode option').evaluateAll(rows=>rows.find(r=>r.textContent.includes('서대문'))?.value);
  await page.selectOption('#signguCode',district);await page.fill('#hsmpNm','신촌푸르지오');
  const responsePromise=page.waitForResponse(r=>r.url().includes('/selectRentalHouseInfoList.do'),{timeout:45000});
  // Invoke the same public form handler as the search button, including NetFunnel.
  await page.evaluate(()=>window.fnSearch('1'));
  const response=await responsePromise,raw=await response.text();await writeFile(`${root}/search-result.json`,raw);
  const data=JSON.parse(raw);console.log(JSON.stringify({count:data.resultCnt,results:data.resultList.map(r=>({name:r.hsmpNm,address:r.rnAdres,id:r.hsmpSn}))}));
  await writeFile(`${root}/search-rendered.html`,await page.content());
  const matches=data.resultList.filter(r=>r.rnAdres==='서울특별시 서대문구 북아현로1길 50'&&r.hsmpNm.startsWith('신촌푸르지오'));
  if(matches.length!==1)throw new Error('Ambiguous public rental complex');
  const detailPromise=page.waitForURL('**/selectRentalHouseInfoDetail.do?**');
  await page.evaluate(r=>window.fnRentalHouseInfoDetail(r.rthousSe,r.hsmpSn,r.atchFileId,r.suplyTy),matches[0]);await detailPromise;
  await page.waitForLoadState('domcontentloaded');
  const html=await page.content();await writeFile(`${root}/detail.html`,html);
  const dom=load(html);console.log(JSON.stringify({url:page.url(),images:dom('img').map((i,e)=>({alt:dom(e).attr('alt'),src:dom(e).attr('src')})).get().filter(r=>/평면|단지|주택/.test(r.alt??'')),links:dom('a,button').map((i,e)=>({text:dom(e).text().trim().slice(0,50),onclick:dom(e).attr('onclick'),href:dom(e).attr('href')})).get().filter(r=>/평면|도면|첨부/.test(r.text))},null,2));
}finally{await browser.close();}
