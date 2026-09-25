// Recover existing, free 1:1000 V2 requests; never submit a new application.
export async function resumeFromHistory(context,sheets) {
 const numbers=sheets.filter(s=>s.status==='requested'&&s.payload?.mapScale==='1000').map(s=>s.number);
 if(!numbers.length)return {selected:0};
 let page=context.pages().find(p=>!p.isClosed()&&p.url().startsWith('https://map.ngii.go.kr/pd/purchs/userPurchsDtlsList2.do'));
 if(!page)page=await context.newPage();
 await page.goto('https://map.ngii.go.kr/pd/purchs/userPurchsDtlsList2.do?listType=1',{waitUntil:'domcontentloaded',timeout:60000});
 await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('#selectNumbox').selectOption('100')]);
 await page.waitForFunction(()=>document.querySelector('#selectNumbox')?.value==='100',null,{polling:500});
 let result=await page.evaluate(selectRequestedHistoryRows,{numbers});
 for(let index=2;!result.selected&&index<=5;index++){
  const next=page.locator(`button[onclick="fn_purchs_dtls_page(${index}); return false;"]`);
  if(!await next.count())break;
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.evaluate(i=>fn_purchs_dtls_page(i),index)]);
  result=await page.evaluate(selectRequestedHistoryRows,{numbers});
 }
 if(result.selected){
  await page.bringToFront();
  await page.evaluate(()=>fn_pd_download('download.do',false,''));
 }
 return result;
}

export function selectRequestedHistoryRows({numbers}) {
 const wanted=new Set(numbers),selected=new Set();
 for(const box of document.querySelectorAll('input[name="orderList"]'))box.checked=false;
 for(const row of document.querySelectorAll('tbody tr')){
  const cells=[...row.querySelectorAll('td')].map(c=>c.textContent.trim());
  const number=cells[5],box=row.querySelector('input[name="orderList"]');
  const button=row.querySelector('button.fn');
  if(!wanted.has(number)||selected.has(number)||cells[3]!=='1:1,000'||cells[2].replace(/\s/g,'')!=='수치지도V2.0')continue;
  // Only the site's ready, zero-cost single-download action qualifies.
  if(!box||box.disabled||box.dataset.complate!=='true'||!button||!/'0'\s*\);?\s*$/.test(button.getAttribute('onclick')||''))continue;
  box.checked=true;selected.add(number);
 }
 return {selected:selected.size,numbers:[...selected]};
}
