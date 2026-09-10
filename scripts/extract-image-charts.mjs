import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readColorChart} from './chart-image-reader.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
export async function extractImageCharts({download=false}={}){
  const results=[];
  const readerHash=hash(await readFile(new URL('./chart-image-reader.mjs',import.meta.url)));
  await mkdir('research/linkage/generated/charts',{recursive:true});
  for(const name of (await readdir('research/linkage')).filter(n=>n.endsWith('-chart-profile.json')).sort()){
    const profileBytes=await readFile(`research/linkage/${name}`),profile=JSON.parse(profileBytes);
    if(!/^[a-z0-9-]+$/.test(profile.id))throw new Error('Invalid chart profile identity');
    const output=`research/linkage/generated/charts/${profile.id}.json`;
    let result;
    try{
      let bytes;
      try{bytes=await readFile(profile.image);}catch(e){
        if(!download)throw new Error('chart-image-missing');
        if(!/^research\/linkage\/downloads\/charts\/[a-z0-9-]+\.jpg$/.test(profile.image))throw new Error('Invalid chart image path');
        const response=await fetch(profile.source,{signal:AbortSignal.timeout(20000),redirect:'error'});
        if(!response.ok)throw new Error(`Chart HTTP ${response.status}`);
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>8_000_000)throw new Error('Chart too large');chunks.push(chunk);}
        bytes=Buffer.concat(chunks);await mkdir('research/linkage/downloads/charts',{recursive:true});
        await writeFile(profile.image,bytes);
      }
      const imageHash=hash(bytes),profileHash=hash(profileBytes);
      if(profile.sha256&&imageHash!==profile.sha256)throw new Error('chart-image-changed-recalibration-required');
      let cached;try{cached=JSON.parse(await readFile(output,'utf8'));}catch{}
      if(cached?.status==='extracted'&&cached.imageHash===imageHash&&cached.profileHash===profileHash&&cached.readerHash===readerHash){results.push(cached);continue;}
      const extracted=await readColorChart(bytes,profile);
      result={id:profile.id,complexId:profile.complexId,status:'extracted',source:profile.source,image:profile.image,imageHash,profileHash,readerHash,
        scannedBuildings:profile.panels.map(p=>p.building),lines:extracted.lines,rejected:extracted.rejected,
        limitation:'Line candidates only; floor exceptions, unit existence and orientation are unverified.'};
    }catch(e){result={id:profile.id,complexId:profile.complexId,status:'failed',source:profile.source,lines:[],reason:e.message};}
    await writeFile(`${output}.tmp`,JSON.stringify(result,null,2)+'\n');await rename(`${output}.tmp`,output);
    results.push(result);
  }
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const results=await extractImageCharts({download:true});
  console.log(JSON.stringify(results.map(r=>({id:r.id,status:r.status,lines:r.lines.length,reason:r.reason})),null,2));
  if(results.some(r=>r.status==='failed'))process.exitCode=1;
}
