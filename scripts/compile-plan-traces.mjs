import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {planTraces,validatePlanTrace} from '../src/plan-models.js';
import {planCalibrations} from '../src/plan-calibrations.js';

export async function attachPlanTraces(plans){
  const report=[];
  for(const trace of planTraces){
    const errors=validatePlanTrace(trace);
    const calibration=planCalibrations[trace.id];let calibrationValid=false;
    if(calibration){
      try{
        const bytes=await readFile(calibration.file);
        calibrationValid=createHash('sha256').update(bytes).digest('hex')===calibration.sha256;
        if(calibration.axes.some(a=>![0,1].includes(a.axis)||a.pixels.length!==2||a.pixels.some(n=>!Number.isFinite(n)||n<0||n>trace.source.imageSize[a.axis])||!(a.pixels[1]>a.pixels[0])||!(a.meters>0)||Math.abs(a.chainMm.reduce((n,x)=>n+x,0)/1000-a.meters)>1e-6))throw new Error('Invalid dimension chain');
      }catch{calibrationValid=false;}
    }
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
        method:trace.evidence.method,allOpeningsVerified:false,calibrationSha256:calibrationValid?calibration.sha256:null,scaleSource:calibrationValid?'cross-source-dimension-estimate':trace.dimension?'printed-dimension-raster-estimate':'display-normalization-only',geographicPlacementVerified:false};
    }
    report.push({id:trace.id,source:trace.source.file,plans:matches.map(p=>p.id),openings:trace.windows.length,status:errors.length?'withheld':'attached',calibration:calibration?(calibrationValid?'applied':'withheld'):'unavailable',errors});
  }
  return report;
}
