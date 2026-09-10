import {readFile,writeFile} from 'node:fs/promises';
import {normalizeComplexes} from '../src/seoul-data.js';

const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const reference=await readJSON('research/seoul/coverage-reference.json');
const rows=normalizeComplexes(await readJSON('research/seoul/raw/apartments.json'));
const kinds=rows.reduce((counts,row)=>{const key=row.kind??'미분류';counts[key]=(counts[key]??0)+1;return counts;},{});
const report={calculatedAt:new Date().toISOString(),numerator:rows.length,numeratorUnit:'Seoul OA-15818 records, mixed housing categories',
  denominator:reference.apartment.complexes,denominatorUnit:'Apartment complexes in MOLIT preliminary price-disclosure inventory',
  denominatorReferenceDate:reference.referenceDate,ratioPercent:rows.length/reference.apartment.complexes*100,
  metric:'aggregate-count-comparison-only',exactMatchedCoveragePercent:null,kinds,
  caveats:['Different reference dates','Different housing classifications','Complex grouping and source IDs not crossmatched',
    'Public-price inventory is not certified as all Seoul housing','Not floorplan or window-view readiness'],
  sources:['https://data.seoul.go.kr/dataList/OA-15818/A/1/datasetView.do',reference.sourcePage]};
await writeFile('research/seoul/coverage-comparison.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
