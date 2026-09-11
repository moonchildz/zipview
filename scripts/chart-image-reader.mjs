import sharp from 'sharp';
const luma=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
export function components(mask,width,height){
  const seen=new Uint8Array(mask.length),out=[];
  for(let i=0;i<mask.length;i++)if(mask[i]&&!seen[i]){
    const pixels=[i];seen[i]=1;let x0=width,y0=height,x1=0,y1=0;
    for(let k=0;k<pixels.length;k++){
      const p=pixels[k],x=p%width,y=Math.floor(p/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const nx=x+dx,ny=y+dy,n=ny*width+nx;if(nx>=0&&ny>=0&&nx<width&&ny<height&&mask[n]&&!seen[n]){seen[n]=1;pixels.push(n);}
      }
    }
    out.push({box:[x0,y0,x1-x0+1,y1-y0+1],pixels});
  }
  return out;
}
const norm=(c,width)=>{
  const [x,y,w,h]=c.box,bits=new Set(c.pixels),out=[];
  for(let v=0;v<16;v++)for(let u=0;u<12;u++)out.push(bits.has((y+Math.min(h-1,Math.floor(v*h/16)))*width+x+Math.min(w-1,Math.floor(u*w/12)))?1:0);
  return out;
};
export function classifyGlyph(glyph,templates){
  const ranked=templates.map(t=>({digit:t.digit,score:glyph.vector.reduce((s,v,i)=>s+(v===t.vector[i]?1:0),0)/glyph.vector.length-.12*Math.abs(glyph.aspect-t.aspect)})).sort((a,b)=>b.score-a.score);
  return {...ranked[0],margin:ranked[0].score-(ranked.find(r=>r.digit!==ranked[0].digit)?.score??0)};
}
export async function readColorChart(image,profile){
  const {data,info}=await sharp(image).toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
  if(info.width!==profile.imageSize[0]||info.height!==profile.imageSize[1])throw new Error('Chart dimensions differ from calibrated profile');
  for(const box of [...profile.panels,...profile.glyphReferences].map(r=>r.box))if(box.length!==4||!box.every(Number.isInteger)||box[0]<0||box[1]<0||box[2]<1||box[3]<1||box[0]+box[2]>info.width||box[1]+box[3]>info.height)throw new Error('Invalid calibrated region');
  for(const {sample:[x,y]} of profile.legend)if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=info.width||y>=info.height)throw new Error('Invalid legend sample');
  const rgb=(x,y)=>[...data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3)];
  const palette=profile.legend.map(l=>({...l,rgb:rgb(...l.sample)}));
  function glyphs(box,type,contrast=32){
    const [left,top,width,height]=box,mask=new Uint8Array(width*height),color=palette.find(p=>p.type===type).rgb;
    const shades=[];for(let y=0;y<height;y++)for(let x=0;x<width;x++){const c=rgb(left+x,top+y);if(distance(c,color)<80)shades.push(luma(c));}
    shades.sort((a,b)=>a-b);const base=shades[Math.floor(shades.length*.8)]??luma(color);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(luma(rgb(left+x,top+y))<base-contrast)mask[y*width+x]=1;
    return components(mask,width,height).filter(c=>{
      const [x,y,w,h]=c.box;return x>0&&y>0&&x+w<width&&y+h<height&&w>=1&&w<=8&&h>=3&&h<=10&&c.pixels.length>=4;
    }).map(c=>({vector:norm(c,width),aspect:c.box[2]/c.box[3],box:[left+c.box[0],top+c.box[1],...c.box.slice(2)]}));
  }
  const templates=[];
  for(const t of profile.glyphReferences){
    const p=palette.map(p=>({p,d:distance(rgb(t.box[0]+1,t.box[1]+1),p.rgb)})).sort((a,b)=>a.d-b.d)[0].p;
    for(const contrast of [22,27,32,37,42,47]){
      const found=glyphs(t.box,t.backgroundType??p.type,contrast).filter(g=>t.digit===1?g.aspect<.65&&g.box[2]>=2:g.box[2]>=3&&g.box[3]>=5).sort((a,b)=>b.box[2]*b.box[3]-a.box[2]*a.box[3]);
      if(found.length)templates.push({...found[0],digit:t.digit});
    }
  }
  if(templates.length<2)throw new Error('Insufficient readable digit references');
  const lines=[],rejected=[],regions=[];
  for(const panel of profile.panels){
    const [left,top,width,height]=panel.box;
    for(const color of palette){
      const mask=new Uint8Array(width*height);
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){
        const c=rgb(left+x,top+y);const closest=palette.map(p=>({type:p.type,d:distance(c,p.rgb)})).sort((a,b)=>a.d-b.d)[0];
        if(closest.type===color.type&&closest.d<48)mask[y*width+x]=1;
      }
      for(const region of components(mask,width,height).filter(c=>c.pixels.length>=25&&c.box[2]>=4&&c.box[3]>=4)){
        const box=[left+region.box[0],top+region.box[1],...region.box.slice(2)];regions.push({building:panel.building,type:color.type,box});
        for(const contrast of [22,27,32,37,42,47])for(const g of glyphs(box,color.type,contrast)){
          const prediction=classifyGlyph(g,templates),record={building:panel.building,line:prediction.digit,type:color.type,
            box:g.box,region:box,contrast,templateSimilarity:prediction.score,margin:prediction.margin,method:'color-legend-and-digit-template',verified:false};
          if(g.box[2]>=2&&prediction.score>=.96&&prediction.margin>=.055)lines.push(record);else rejected.push({...record,reason:'digit-ambiguous'});
        }
      }
    }
  }
  const accepted=[];
  const visited=new Set();
  for(const r of lines){const key=`${r.building}:${r.line}`;if(visited.has(key))continue;visited.add(key);
    const same=lines.filter(x=>x.building===r.building&&x.line===r.line);
    const near=same.every(x=>x.type===r.type&&Math.hypot(x.box[0]-r.box[0],x.box[1]-r.box[1])<5);
    if(near&&new Set(same.map(x=>x.contrast)).size>=2)accepted.push({...same.sort((a,b)=>b.templateSimilarity-a.templateSimilarity)[0],votes:same.length});
    else rejected.push({...r,reason:'duplicate-or-unstable-line-detection'});
  }
  const marked=new Set();
  for(const [building,line,x,y] of profile.reviewedLineMarkers??[]){
    const key=`${building}:${line}`;
    if(marked.has(key)||!profile.panels.some(p=>p.building===building)||!Number.isInteger(line)||line<1||line>99||![x,y].every(Number.isInteger)||x<4||y<4||x>=info.width-4||y>=info.height-4)throw new Error('Invalid reviewed line marker');
    marked.add(key);
    const votes=new Map();
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const ranked=palette.map(p=>({type:p.type,d:distance(rgb(x+dx,y+dy),p.rgb)})).sort((a,b)=>a.d-b.d);
      if(ranked[0].d<35&&ranked[1].d-ranked[0].d>6)votes.set(ranked[0].type,(votes.get(ranked[0].type)??0)+1);
    }
    const ranked=[...votes].sort((a,b)=>b[1]-a[1]),total=[...votes.values()].reduce((a,b)=>a+b,0);
    if(!ranked.length||ranked[0][1]<12||ranked[0][1]/total<.8){rejected.push({building,line,box:[x-4,y-4,9,9],reason:'reviewed-marker-color-ambiguous',votes:Object.fromEntries(votes)});continue;}
    const record={building,line,type:ranked[0][0],box:[x-4,y-4,9,9],colorPixels:ranked[0][1],samplePixels:81,
      method:'manually-reviewed-line-number-and-source-color',verified:false};
    const previous=accepted.find(r=>r.building===building&&r.line===line);
    if(previous&&previous.type!==record.type)throw new Error(`Reviewed marker conflicts with glyph result: ${key}`);
    if(!previous)accepted.push(record);
  }
  for(const [building,line,reason] of profile.unresolvedLineMarkers??[]){
    if(marked.has(`${building}:${line}`))throw new Error('Line cannot be both reviewed and unresolved');
    const index=accepted.findIndex(r=>r.building===building&&r.line===line);
    if(index>=0)accepted.splice(index,1);
    rejected.push({building,line,reason});
  }
  return {lines:accepted,rejected,regions,palette,templates};
}
