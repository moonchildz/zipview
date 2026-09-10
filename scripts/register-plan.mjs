import {readFile} from 'node:fs/promises';
import {inferPlanRegistration} from '../src/plan-registration.js';

try {
  if(process.argv.length!==3)throw new Error('Usage: node scripts/register-plan.mjs <correspondences.json>');
  const input=JSON.parse(await readFile(process.argv[2],'utf8'));
  console.log(JSON.stringify({unitKey:input.unitKey??null,...inferPlanRegistration(input)},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}
