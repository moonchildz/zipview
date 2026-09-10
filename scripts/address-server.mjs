import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createAddressPipeline} from './address-pipeline.mjs';
import {extractImageCharts} from './extract-image-charts.mjs';

function rebuild(){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['scripts/build-linkage.mjs'],{stdio:['ignore','ignore','pipe']});let stderr='';
  child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('exit',code=>code?reject(new Error('수집 결과의 조회 인덱스 갱신에 실패했습니다.')):resolve());
});}
export function addressPipelinePlugin(){
  let queue=Promise.resolve(),queued=0;
  const install=server=>{
    server.middlewares.use(async(req,res,next)=>{
      const path=(req.url??'').split('?')[0];
      if(!/^\/research\/linkage\/downloads\/kb\/\d+\/\d+-(?:basic|extended)\.(?:jpg|png|webp)$/.test(path))return next();
      if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;return res.end();}
      try{const bytes=await readFile(path.slice(1));res.setHeader('Content-Type',path.endsWith('.jpg')?'image/jpeg':path.endsWith('.png')?'image/png':'image/webp');res.end(req.method==='HEAD'?undefined:bytes);}catch{res.statusCode=404;res.end();}
    });
    server.middlewares.use('/api/address-pipeline',async(req,res)=>{
    const send=(code,data)=>{res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
    if(req.method!=='POST')return send(405,{error:'POST required'});
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'Same-origin requests only'});
    if(queued>=4)return send(429,{error:'주소 수집이 진행 중입니다. 잠시 후 다시 조회해 주세요.'});
    let text='';try{for await(const chunk of req){text+=chunk;if(text.length>2048)return send(413,{error:'Request too large'});}}catch{return send(400,{error:'Invalid request'});}
    let input;try{input=JSON.parse(text);if(typeof input.address!=='string')throw new Error();}catch{return send(400,{error:'주소를 입력해 주세요.'});}
    queued++;
    const work=queue.then(async()=>{
      const pipeline=createAddressPipeline({maxRequests:90});
      const result=await pipeline.run(input.address,{providerId:input.providerId});
      if(result.complex){await extractImageCharts({download:true});await rebuild();const catalog=JSON.parse(await readFile('research/linkage/generated/catalog.json','utf8'));return {result,catalog};}
      return {result};
    });queue=work.catch(()=>{});
    try{send(200,await work);}catch(e){send(502,{error:e.message});}finally{queued--;}
    });
  };
  return {name:'address-pipeline',configureServer:install,configurePreviewServer:install};
}
