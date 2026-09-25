import {spawn} from 'node:child_process';
// Discover the nationwide public notice queue first, then preserve all attachments.
for(const args of [['--discover-only'],['--queued-only','--all-attachments']]){
 const child=spawn(process.execPath,['scripts/collect-lh-plan-library.mjs',...args],{stdio:'inherit',windowsHide:true});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 if(code!==0){process.exitCode=code??1;break;}
}
