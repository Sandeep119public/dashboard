import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStateOutcomes } from '../src/research/state-outcomes.js';
function fixture() {
 const t=[0,3600,7200,10800,14400,18000,21600,25200],o=t.map(()=>100),h=t.map(()=>101),l=t.map(()=>99),c=[100,101,102,103,102,101,100,99];
 const values=[1,1,2,2,1,2,0,0].map(code=>({code}));
 return {bars:{t,o,h,l,c,v:t.map(()=>10)},states:{labels:['Warm-up','Compression','Expansion'],values}};
}
test('summarizes forward close returns by state and horizon',()=>{
 const {bars,states}=fixture(),result=summarizeStateOutcomes(bars,states,{horizons:[1,2]});
 const compression=result.states.find(s=>s.code===1);
 assert.equal(compression.horizons[0].samples,3);
 assert.ok(Math.abs(compression.horizons[0].medianReturnPct-((102/101-1)*100))<1e-9);
 assert.ok(Math.abs(compression.horizons[0].winRatePct-200/3)<1e-9);
 assert.equal(compression.horizons[1].samples,3);
 assert.equal(result.overlappingSamples,true);
});
test('excludes outcome windows that cross missing hourly bars',()=>{
 const {bars,states}=fixture();bars.t[2]+=7200;for(let i=3;i<bars.t.length;i++)bars.t[i]+=7200;
 const result=summarizeStateOutcomes(bars,states,{horizons:[1,2]});
 const compression=result.states.find(s=>s.code===1);
 assert.equal(compression.horizons[0].samples,2);
 assert.equal(compression.horizons[1].samples,1);
});
test('does not use warm-up labels or start bars outside the selected window',()=>{
 const {bars,states}=fixture();
 const result=summarizeStateOutcomes(bars,states,{horizons:[1],startTime:3600,endTime:7200});
 assert.equal(result.states.find(s=>s.code===0).horizons[0].samples,0);
 assert.equal(result.states.find(s=>s.code===1).horizons[0].samples,1);
});
test('rejects mismatched labels, invalid horizons and bad bars',()=>{
 const {bars,states}=fixture();
 assert.throws(()=>summarizeStateOutcomes(bars,{labels:states.labels,values:[]}),/align/);
 assert.throws(()=>summarizeStateOutcomes(bars,states,{horizons:[0]}),/whole-bar/);
 assert.throws(()=>summarizeStateOutcomes({...bars,c:[]},states),/equal-length/);
});
