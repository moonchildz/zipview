import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {tilePoint,tileLocation} from '../src/imagery-coordinates.js';

const dir='research/seoul/raw/terrain';await mkdir(dir,{recursive:true});
const requestedBounds=[126.75,37.4,127.2,37.73],zoom=12;
const [left,top]=tilePoint(requestedBounds[0],requestedBounds[3],zoom).map(Math.floor);
const [right,bottom]=tilePoint(requestedBounds[2],requestedBounds[1],zoom).map(Math.floor);
if((right-left+1)*(bottom-top+1)>60)throw new Error('Terrain request cap');
const tiles=[];
for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
  const file=`${zoom}-${x}-${y}.png`,url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
  let buffer,cached=true;
  try{buffer=await readFile(`${dir}/${file}`);PNG.sync.read(buffer);}
  catch{
    cached=false;const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error(`Terrain HTTP ${response.status}; no automatic retry`);
    buffer=Buffer.from(await response.arrayBuffer());const png=PNG.sync.read(buffer);
    if(png.width!==256||png.height!==256)throw new Error('Unexpected terrain size');
    await writeFile(`${dir}/${file}.tmp`,buffer);await rename(`${dir}/${file}.tmp`,`${dir}/${file}`);
  }
  tiles.push({x,y,file,url,sha256:createHash('sha256').update(buffer).digest('hex')});console.log(`${file} ${cached?'cached':'downloaded'}`);
}
const [west,north]=tileLocation(left,top,zoom),[east,south]=tileLocation(right+1,bottom+1,zoom);
await writeFile(`${dir}/manifest.json`,JSON.stringify({acquiredAt:new Date().toISOString(),zoom,requestedBounds,
  bounds:[west,south,east,north],left,top,right,bottom,tiles,encoding:'Terrarium: R*256+G+B/256-32768 metres',
  source:'https://registry.opendata.aws/terrain-tiles/',attribution:'Mapzen / Tilezen and underlying elevation providers',
  licenseSource:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',quality:'coarse-background-only; NOT surveyed site/floor elevation',
  groundSampleMetersApprox:30,verticalDatum:'provider-dependent; registration unverified'},null,2));
