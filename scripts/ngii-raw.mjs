import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {metadataMatches,safeFilename} from './ngii-files.mjs';

const sha256=data=>createHash('sha256').update(data).digest('hex');
const layerNames=data=>[...data.matchAll(/\$LAYER_NAME\s+"([^"]+)"/g)].map(x=>x[1]);

export function inspectNgiPair(ngi,nda){
 const a=ngi.toString('utf8'),b=nda.toString('utf8');
 const namesA=layerNames(a),namesB=layerNames(b);
 const count=(text,label)=>(text.match(new RegExp(label,'g'))??[]).length;
 if(!namesA.length||JSON.stringify(namesA)!==JSON.stringify(namesB)
   ||count(a,'<LAYER_START>')!==namesA.length||count(b,'<LAYER_START>')!==namesB.length
   ||count(a,'<LAYER_END>')!==namesA.length||count(b,'<LAYER_END>')!==namesB.length
   ||!a.trimEnd().endsWith('<LAYER_END>')||!b.trimEnd().endsWith('<LAYER_END>'))
   throw Error('NGI/NDA layer structure mismatch or incomplete transfer');
 return {layers:namesA.length,geometryRecords:count(a,'\\$RECORD '),attributeRecords:count(b,'\\$RECORD ')};
}

async function copyVerified(from,to,expected){
 try{await fs.copyFile(from,to,fs.constants.COPYFILE_EXCL);}
 catch(error){if(error.code!=='EEXIST')throw error;
  if(sha256(await fs.readFile(to))!==expected)throw Error(`Existing raw file differs: ${to}`);}
}

export async function reconcileRawNgi(sheets,inbox,output){
 await fs.mkdir(output,{recursive:true});
 const names=await fs.readdir(inbox);
 const groups=new Map();
 for(const name of names){
  if(!/\.(ngi|nda|xml)$/i.test(name))continue;
  try{safeFilename(name,{allowNgi:true});}catch{continue;}
  const match=name.match(/_([0-9]{9})_([0-9]{4})_([0-9]+)\.(ngi|nda|xml)$/i);
  if(!match)continue;
  const stem=name.slice(0,name.lastIndexOf('.'));
  const group=groups.get(stem)??{number:match[1],year:match[2]};
  group[match[4].toLowerCase()]=name;groups.set(stem,group);
 }
 const bySheet=new Map();
 for(const group of groups.values()){
  const key=`${group.number}:${group.year}`;
  const candidates=bySheet.get(key)??[];
  candidates.push(group);bySheet.set(key,candidates);
 }
 let changed=0;
 for(const sheet of sheets.filter(s=>s.status!=='verified')){
  let badCandidate=null;
  for(const group of bySheet.get(`${sheet.number}:${sheet.year}`)??[]){
   if(!group.ngi||!group.nda||!group.xml)continue;
   const files=[group.ngi,group.nda,group.xml];
   let before;
   try{
    before=await Promise.all(files.map(name=>fs.stat(path.join(inbox,name))));
    if(before.some(stat=>!stat.isFile()||Date.now()-stat.mtimeMs<2500))continue;
    if(before.some(stat=>stat.size<100)){
     if(before.every(stat=>Date.now()-stat.mtimeMs>120000)&&sheet.review?.reason!=='raw-empty-or-short'){
      sheet.status='review';sheet.review={reason:'raw-empty-or-short',files,checkedAt:new Date().toISOString()};changed++;
     }
     continue;
    }
    const [ngi,nda,xmlBuffer]=await Promise.all(files.map(name=>fs.readFile(path.join(inbox,name))));
    const after=await Promise.all(files.map(name=>fs.stat(path.join(inbox,name))));
    if(after.some((stat,i)=>stat.size!==before[i].size||stat.mtimeMs!==before[i].mtimeMs))continue;
    const xml=xmlBuffer.toString('utf8');
    if(!metadataMatches(xml,sheet)){
     if(before.every(stat=>Date.now()-stat.mtimeMs>120000))
      badCandidate={reason:'raw-metadata-mismatch',files};
     continue;
    }
    const check=inspectNgiPair(ngi,nda);
    const values={};
    for(const [extension,name,data] of [['ngi',group.ngi,ngi],['nda',group.nda,nda],['xml',group.xml,xmlBuffer]]){
     const hash=sha256(data);await copyVerified(path.join(inbox,name),path.join(output,name),hash);
     values[extension]={name,sha256:hash,bytes:data.length};
    }
    sheet.status='verified';sheet.file={format:'ngi',...values,...check,checkedAt:new Date().toISOString()};
    delete sheet.review;changed++;break;
   }catch(error){
    // External transfer software exposes names before writes finish. Keep
    // polling this sheet while later, unrelated downloads continue.
    sheet.rawProbeError=error.message;
    if(before?.every(stat=>Date.now()-stat.mtimeMs>120000))
     badCandidate={reason:'raw-validation-failed',files,detail:error.message};
   }
  }
  if(badCandidate&&sheet.status!=='verified'&&sheet.review?.reason!==badCandidate.reason){
   sheet.status='review';sheet.review={...badCandidate,checkedAt:new Date().toISOString()};changed++;
  }
 }
 return changed;
}

export async function verifyRawNgi(sheets,output){
 let changed=0;
 for(const sheet of sheets.filter(s=>s.status==='verified'&&s.file?.format==='ngi')){
  try{
   for(const extension of ['ngi','nda','xml']){
    const entry=sheet.file[extension];
    if(!entry||sha256(await fs.readFile(path.join(output,entry.name)))!==entry.sha256)
      throw Error(`Missing or altered ${extension} original`);
   }
  }catch(error){sheet.status='review';sheet.review={reason:'raw-file-missing-or-altered',detail:error.message,checkedAt:new Date().toISOString()};changed++;}
 }
 return changed;
}
