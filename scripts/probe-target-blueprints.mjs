import {load} from 'cheerio';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {hubPublicSession} from './hub-public-client.mjs';

// Follow the public search form, including its session and CSRF protections.
const origin='https://www.hub.go.kr',page='/portal/opn/tyb/idx-batch-flrpln.do';
const {html,post}=await hubPublicSession(page),dom=load(html);
const viewer=dom('script:not([src])').map((i,e)=>dom(e).text()).get().find(text=>text.includes('function opnFlrplnPop'));
const viewerBase=viewer?.match(/var url = "(http[^"\s]+\?bldkey=)"/),viewerKey=viewer?.match(/\+y\+"&key=([^"\s]+)"/);
const targets=[{id:'gyeonghuigung-xi',sigungu:'11110',sigunguNm:'종로구',dongName:'홍파동',bun:'199'},
  {id:'sinchon-prugio',sigungu:'11410',sigunguNm:'서대문구',dongName:'북아현동',bun:'1011'}];
const reports=[];
for(const target of targets){
  try{
    const {list}=await post('/portal/opn/tyb/selectBjdongList.do',{sido:'11000',sigunguCd:target.sigungu});
    const dong=list?.find(d=>d.bjdongNm===target.dongName);if(!dong)throw new Error('Legal dong not returned by official list');
    const params={sido:'11000',sigungu:target.sigungu,sigunguNm:target.sigunguNm,bjdong:dong.bjdongCd,bjdongNm:target.dongName,bun:target.bun,ji:'0'};
    const permitted=await post('/portal/opn/tyb/idx-srvc-hstry-insert.do',params);
    if(permitted.success!=='Y'){reports.push({id:target.id,status:'search-not-permitted',response:permitted});continue;}
    const data=await post('/onepass/select-batch-rest-list.do',params);
    if(!Array.isArray(data))throw new Error('Blueprint search schema changed');
    const files=[];
    for(const entry of data){
      try{
        // The response's legacy image URL is stale. Use the public viewer's actual URL.
        if(!viewerBase||!viewerKey)throw new Error('Public viewer URL schema changed');
        const url=new URL(viewerBase[1]+encodeURIComponent(entry.mgmBldrgstPk));url.searchParams.set('fileId',entry.fileId);url.searchParams.set('key',viewerKey[1]);
        if(url.hostname!=='blcm.go.kr')throw new Error('Unexpected official file host');
        const image=await fetch(url,{signal:AbortSignal.timeout(30000)});
        if(!image.ok)throw new Error(`Blueprint HTTP ${image.status}`);
        const bytes=Buffer.from(await image.arrayBuffer()),metadata=await sharp(bytes).metadata();
        if(!['jpeg','png','webp','tiff'].includes(metadata.format))throw new Error('Unsupported image format');
        const file=`research/linkage/downloads/hub/${target.id}.${metadata.format==='jpeg'?'jpg':metadata.format}`;
        await mkdir('research/linkage/downloads/hub',{recursive:true});await writeFile(file,bytes);
        files.push({file,source:origin+page,registryId:entry.mgmBldrgstPk,fileId:entry.fileId,
          viewerEndpoint:url.origin+url.pathname,legacyImageUrl:entry.image,
          width:metadata.width,height:metadata.height,sha256:createHash('sha256').update(bytes).digest('hex')});
      }catch(error){files.push({source:entry.image,status:'failed',reason:error.message});}
    }
    reports.push({id:target.id,status:data.length?'found':'empty',data,files});
  }catch(error){reports.push({id:target.id,status:'failed',reason:error.message});}
}
await mkdir('research/linkage/generated',{recursive:true});
const report={checkedAt:new Date().toISOString(),source:origin+page,targets:reports};
await writeFile('research/linkage/generated/target-blueprint-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
