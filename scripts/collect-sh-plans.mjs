import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root='research/linkage/downloads/evidence/sh';await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();await page.goto('https://www.i-sh.co.kr/houseinfo/');
  await page.waitForURL('**/main/mainPage.do',{timeout:60000});
  await page.waitForFunction(()=>typeof window.selectSrcListLimit==='function'&&typeof window.jQuery==='function');
  await writeFile(`${root}/houseinfo-rendered.html`,await page.content());
  const manifest={retrievedAt:new Date().toISOString(),source:page.url(),complexes:[]};
  const query=(endpoint,params)=>page.evaluate(({endpoint,params})=>new Promise((resolve,reject)=>$.ajax({url:'/houseinfo/'+endpoint,type:'POST',data:params,dataType:'json',success:resolve,error:(_,status,error)=>reject(new Error(status+error))})),{endpoint,params});
  for(const [id,name] of [['70339','신촌푸르지오'],['70109','동소문한진']]){
    const detail=await query('map/selectHouseBscDetail.do',{biznsCd:id,ctgrCd:'10'});
    const types=await query('map/selectSplyTyInfo.do',{biznsCd:id});
    await writeFile(`${root}/${id}-detail.json`,JSON.stringify(detail,null,2));
    await writeFile(`${root}/${id}-types.json`,JSON.stringify(types,null,2));
    const categories=await query('map/selectCmmCdList.do',{biznsCd:id,cateId:'SH0175'});
    const complex={id,name,types:types.result,categories:categories.result,assets:[]};
    const requests=[...(types.result??[]).map(t=>({label:t.splyTy,endpoint:'map/selectSplyTyImgInfo.do',params:{biznsCd:id,splyTy:t.splyTy}})),...(categories.result??[]).map(t=>({label:`category-${t.cd}`,endpoint:'map/selectImgList.do',params:{biznsCd:id,imgTy:t.cd}}))];
    for(const request of requests){
      const response=await query(request.endpoint,request.params);
      await writeFile(`${root}/${id}-${request.label}-images.json`,JSON.stringify(response,null,2));
      for(const entry of response.result??[]){
        const url=new URL('../'+entry.imgPath+entry.imgNewFileNm,page.url()).href;
        const response=await page.request.get(url);if(!response.ok())throw new Error(`Image HTTP ${response.status()}`);
        const bytes=await response.body();const metadata=await sharp(bytes).metadata();
        const hash=createHash('sha256').update(bytes).digest('hex');
        const file=`${root}/${id}-${request.label}-${hash.slice(0,12)}.${metadata.format}`;
        await writeFile(file,bytes);
        complex.assets.push({type:request.label,name:entry.imgNm,url,file,sha256:hash,width:metadata.width,height:metadata.height});
      }
    }
    manifest.complexes.push(complex);console.log(name,'types',types.result?.length,'images',complex.assets.length);
    await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
  }
  for(const keyword of ['신촌푸르지오','경희궁','한신한진']){
    const responsePromise=page.waitForResponse(r=>r.url().includes('/selectSearchListLimit.do'));
    await page.evaluate(keyword=>{$('#searchVal').val(keyword);selectSrcListLimit();},keyword);
    const result=await (await responsePromise).json();
    await writeFile(`${root}/search-${keyword}.json`,JSON.stringify(result,null,2));
    console.log('Search',keyword,'matches',result.result?.length??0);
  }
  for(const keyword of ['신촌푸르지오','북아현','경희궁']){
    const responsePromise=page.waitForResponse(r=>r.url().includes('/getTemplateItem.do'));
    await page.evaluate(keyword=>{$('#searchData').val(keyword);pamphlet();},keyword);
    const result=await (await responsePromise).json();
    await writeFile(`${root}/pamphlet-${keyword}.json`,JSON.stringify(result,null,2));
    console.log('Pamphlet',keyword,'matches',result.totalCnt);
  }
}finally{await browser.close();}
