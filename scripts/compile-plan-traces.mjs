import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {planTraces,validatePlanTrace} from '../src/plan-models.js';

export async function attachPlanTraces(plans){
  const report=[];
  for(const trace of planTraces){
    const errors=validatePlanTrace(trace);
    try{
      const bytes=await readFile(trace.source.file),hash=createHash('sha256').update(bytes).digest('hex');
      const image=await sharp(bytes).metadata();
      if(hash!==trace.source.sha256)errors.push('source-image-changed');
      if(image.width!==trace.source.imageSize[0]||image.height!==trace.source.imageSize[1])errors.push('source-image-size-changed');
    }catch(error){errors.push(error.code==='ENOENT'?'source-image-missing':'source-image-unreadable');}
    const matches=plans.filter(p=>p.complexId===trace.complexId&&p.file===trace.source.file&&p.variant===trace.variant&&(p.displayType??p.id)===trace.type);
    for(const p of matches){
      delete p.trace;
      if(!errors.length&&p.available)p.trace={id:trace.id,sourceSha256:trace.source.sha256,openings:trace.windows.length,
        method:trace.evidence.method,allOpeningsVerified:false,scaleSource:trace.dimension?'printed-dimension-raster-estimate':'display-normalization-only',geographicPlacementVerified:false};
    }
    report.push({id:trace.id,source:trace.source.file,plans:matches.map(p=>p.id),openings:trace.windows.length,status:errors.length?'withheld':'attached',errors});
  }
  return report;
}
