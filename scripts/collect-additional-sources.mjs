import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import sharp from 'sharp';

const sources=JSON.parse(await readFile('research/linkage/additional-sources.json','utf8'));
const root='research/linkage/downloads/evidence',report=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicUrl=url=>{const u=new URL(url);u.search='';return u.href;};
async function download(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  const parts=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>25_000_000)throw new Error('Source exceeds 25 MB');parts.push(chunk);}
  return Buffer.concat(parts);
}
for(const source of sources){
  const record={...source,assets:[],errors:[]};report.push(record);
  if(!/^[a-z0-9-]+$/.test(source.id))throw new Error('Invalid source ID');
  const dir=`${root}/${source.id}`;await mkdir(dir,{recursive:true});
  try{
    const html=await download(source.url),dom=load(html.toString('utf8'));
    record.title=dom('title').text().trim();record.htmlSha256=hash(html);
    await writeFile(`${dir}/source.html`,html);
    const content=dom('.tt_article_useless_p_margin, .entry-content, .bbs_content, .bbs_view .cts');
    await writeFile(`${dir}/text.txt`,content.text());
    const images=content.find('img').map((i,e)=>dom(e).attr('data-origin')||dom(e).attr('src')).get();
    const attachments=dom('a[href]').map((i,e)=>({url:dom(e).attr('href'),label:dom(e).text().trim()})).get().filter(r=>/\.pdf|\.hwp|\.zip|download|fileDown/i.test(r.url)&&/pdf|hwp|zip|다운로드|공급|공고/i.test(r.label)).map(r=>r.url);
    const links=[...new Set([...images,...attachments].filter(Boolean).map(u=>new URL(u,source.url).href))].filter(u=>/^https?:/.test(u)).slice(0,36);
    for(const [index,url] of links.entries()){
      try{
        const bytes=await download(url),digest=hash(bytes);let metadata;
        try{metadata=await sharp(bytes).metadata();}catch{}
        const pdf=bytes.subarray(0,4).toString()==='%PDF';
        if(!metadata&&!pdf&&!/\.hwp|\.zip/i.test(url))throw new Error('Not a recognized document/image');
        const extension=metadata?metadata.format==='jpeg'?'jpg':metadata.format:pdf?'pdf':/\.hwp/i.test(url)?'hwp':'zip';
        const file=`${dir}/${String(index+1).padStart(2,'0')}-${digest.slice(0,12)}.${extension}`;
        await writeFile(file,bytes);
        record.assets.push({file,source:source.url,assetUrl:publicUrl(url),sha256:digest,bytes:bytes.length,width:metadata?.width,height:metadata?.height,status:'downloaded-unreviewed'});
      }catch(e){record.errors.push({assetUrl:publicUrl(url),reason:e.message});}
    }
    record.status=record.assets.length?'downloaded':'no-assets';
  }catch(e){record.status='failed';record.errors.push({reason:e.message});}
  console.log(JSON.stringify({id:source.id,status:record.status,assets:record.assets.length,errors:record.errors.length}));
}
await mkdir('research/linkage/generated',{recursive:true});
await writeFile('research/linkage/generated/additional-sources.json',JSON.stringify({checkedAt:new Date().toISOString(),sources:report},null,2)+'\n');
