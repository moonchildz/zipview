import test from 'node:test';
import assert from 'node:assert/strict';
import {luminanceStats} from '../scripts/cas-rgb-preview.mjs';
import {planScenes} from '../scripts/cas-imagery-plan.mjs';
test('RGB brightness score rewards visible midtones and penalizes clipping and deep darkness',()=>{
  const bright=luminanceStats([120,140,160,180,190]),dark=luminanceStats([10,20,25,35,100]),white=luminanceStats([250,251,253,254,255]);
  assert.ok(bright.score>dark.score);assert.ok(bright.score>white.score);
  assert.equal(luminanceStats([],10).score,null);assert.equal(luminanceStats([100,120],4).validFraction,.5);
});
test('RGB planning selects the best measured image separately for each apartment cell',()=>{
  const cells=['a','b'].map(id=>({id,corners:[[126.1,37.1],[126.2,37.1],[126.2,37.2],[126.1,37.2]],targetIds:[id]}));
  const scenes=['one','two','unknown'].map(id=>({id,ring:[[126,37],[127,37],[127,38],[126,38]],sunElevation:60,cloud:0,roll:0,pitch:0,estimatedBytes:6e9}));
  const previewScores={one:{scores:{a:{score:.9},b:{score:.2}}},two:{scores:{a:{score:.3},b:{score:.8}}}};
  const plan=planScenes(cells,scenes,{previewScores,qualityTolerance:0});
  assert.deepEqual(plan.selected.map(s=>s.id),['one','two']);
  assert.deepEqual(plan.selected[0].newCells,['a']);assert.deepEqual(plan.selected[1].newCells,['b']);
  assert.equal(plan.policy.maxGB,1000);assert.equal(plan.estimatedDownloadGB,12);
  assert.equal(plan.policy.qualityBasis,'RGB-preview-local-luminance');
});
