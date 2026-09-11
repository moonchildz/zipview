import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const items=JSON.parse(await readFile('research/linkage/plan-supplements.json','utf8'));
const root=resolve('research/linkage/downloads');
for(const item of items){
  const path=resolve(item.file),rel=relative(root,path);
  if(rel.startsWith('..')||resolve(root,rel)!==path)throw new Error('Supplement destination is outside downloads');
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const cached=await readFile(path).catch(()=>null);
  if(cached&&digest(cached)===item.sha256){console.log(`Cached: ${item.displayType}`);continue;}
  const url=new URL(item.imageUrl);
  if(url.protocol!=='https:')throw new Error('Expected a public HTTPS image');
  const response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error(`Supplement ${item.displayType}: HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(digest(bytes)!==item.sha256)throw new Error(`Supplement ${item.displayType}: source changed; review required`);
  const metadata=await sharp(bytes).metadata();
  if(!metadata.width||!metadata.height)throw new Error('Image could not be decoded');
  await mkdir(dirname(path),{recursive:true});await writeFile(`${path}.part`,bytes);await rename(`${path}.part`,path);
  console.log(`Downloaded: ${item.displayType}, ${metadata.width}x${metadata.height}`);
}
