import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {xiPlanOrientation,transformPlanPoint,inversePlanPoint,XI_PLAN_CROP} from '../src/xi-plan-orientation.js';
import {xiOpeningCandidates} from '../src/xi-unit-layout.js';

const data=JSON.parse(readFileSync('research/gyeonghuigung-xi/scene.json'));
const target=data.buildings.find(b=>b.id===data.targetBuildingId);

test('north-up plan rotates front toward the world bearing and mirrors exactly once',()=>{
  for(const mirrored of [false,true]) {
    const {matrix,bearing}=xiPlanOrientation(target,mirrored),[a,b,c,d]=matrix;
    assert.equal(Math.sign(a*d-b*c),mirrored?-1:1);
    assert.ok(Math.abs((Math.atan2(c,-d)*180/Math.PI+360)%360-bearing)<1e-8);
    const windows=xiOpeningCandidates(target,data.center,{mirrored});
    const w1=windows.find(w=>w.id==='living'),w2=windows.find(w=>w.id==='balcony');
    const p1=transformPlanPoint(matrix,w1.pixel),p2=transformPlanPoint(matrix,w2.pixel);
    const u=p2.map((v,i)=>v-p1[i]),v=w2.point.map((n,i)=>n-w1.point[i]);
    assert.ok((u[0]*v[0]+u[1]*v[1])/(Math.hypot(...u)*Math.hypot(...v))>.999999);
    const {x,y,width,height}=XI_PLAN_CROP;
    for(const p of [[x,y],[x+width,y],[x,y+height],[x+width,y+height]]) {
      for(const n of transformPlanPoint(matrix,p))assert.ok(n>=71.99&&n<=728.01);
    }
  }
});

test('rotated and mirrored observer clicks invert back to the same room position',()=>{
  for(const mirrored of [false,true]){
    const {matrix}=xiPlanOrientation(target,mirrored);
    for(const point of [[1142,430],[996,470],[1127,220]]){
      const screen=transformPlanPoint(matrix,point),back=inversePlanPoint(matrix,screen);
      assert.ok(Math.hypot(...back.map((v,i)=>v-point[i]))<1e-8);
      const up=inversePlanPoint(matrix,[screen[0],screen[1]-8]);
      const projected=transformPlanPoint(matrix,up);
      assert.ok(Math.abs(projected[0]-screen[0])<1e-8);
      assert.ok(Math.abs(projected[1]-screen[1]+8)<1e-8);
    }
  }
});
