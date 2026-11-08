import assert from 'node:assert/strict';
import { greedyRoadRoute, createDispatchPlan, operationsGeoJSON } from '../lib/dispatch.mjs';
import { loadDrivingMatrix, createRoadDispatchPlan } from '../lib/road-routing.mjs';
import { responsibilityReport } from '../lib/responsibility.mjs';
import { suggestWithRules, validateProposal } from '../lib/intake.mjs';
import { analyzeLocally } from '../lib/local-intake.mjs';

const depot=[-74,40.7],near=[-73.999,40.7],far=[-73.98,40.7];
const job=(id,coordinates,score=80)=>({id,title:id,coordinates,score,skill:'roads',minutes:20,severity:5,ageHours:4,source:'311',borough:'BROOKLYN',neighborhood:'Community board 17 BROOKLYN'});
const jobs=[job('near',near),job('far',far)],crew={id:'R',coordinates:depot,skills:['roads'],available:true,color:'#123456'};
const travel=(a,b)=>({minutes:a===depot&&b===near?40:a===depot&&b===far?5:10,km:1});
assert.deepEqual(greedyRoadRoute(depot,jobs,travel).stops.map(j=>j.id),['far','near']);
assert.equal(greedyRoadRoute(depot,jobs,()=>null),null);
assert.equal(createDispatchPlan(jobs,[crew],{limit:2,shiftHours:2,maxStops:3},()=>null).unassigned[0].reasonCode,'unreachable');

let blocks=0;
const matrixFetch=async input=>{
  const url=new URL(input),coords=url.pathname.split('/').at(-1).split(';').map(s=>s.split(',').map(Number));
  assert.ok(coords.length>=2&&coords.length<=25);
  const sources=url.searchParams.get('sources').split(';').map(Number),destinations=url.searchParams.get('destinations').split(';').map(Number);
  assert.ok(sources.length*destinations.length>=2);
  blocks++;
  return Response.json({code:'Ok',durations:sources.map(s=>destinations.map(d=>coords[s][0]===coords[d][0]?0:Math.round((coords[s][0]+75)*1000)+(coords[d][0]+75)*100)),distances:sources.map(s=>destinations.map(d=>s===d?0:1000))});
};
const points=Array.from({length:25},(_,i)=>[-74+i*.001,40.7]);
const matrix=await loadDrivingMatrix(points,{token:'test-blocks',fetchImpl:matrixFetch});
assert.equal(blocks,8); // final single-node diagonal block needs no API call
assert.equal(matrix.durations.length,25);assert.notEqual(matrix.durations[0][24],matrix.durations[24][0]);assert.equal(matrix.durations[24][24],0);
const unreachable=await loadDrivingMatrix([[-73.8,40.8],[-73.7,40.8]],{token:'test-null',fetchImpl:async()=>Response.json({code:'Ok',durations:[[0,null],[null,0]],distances:[[0,null],[null,0]]})});
assert.equal(unreachable.durations[0][1],null);

let directionsCalls=0;
const roadGeometry={type:'LineString',coordinates:[depot,[-74.005,40.72],far,near,depot]};
const roadFetch=async input=>{
  const url=new URL(input);
  if(url.pathname.includes('directions-matrix')) {
    const n=url.pathname.split('/').at(-1).split(';').length;
    return Response.json({code:'Ok',durations:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:60)),distances:Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?0:1000))});
  }
  directionsCalls++;const coords=url.pathname.split('/').at(-1).split(';');
  return Response.json({code:'Ok',routes:[{duration:directionsCalls===1?4000:600,distance:8000,geometry:roadGeometry,legs:Array.from({length:coords.length-1},()=>({duration:200}))}]});
};
const roadPlan=await createRoadDispatchPlan(jobs,[crew],{limit:2,shiftHours:1,maxStops:3},{token:'test-road',fetchImpl:roadFetch});
assert.equal(roadPlan.mode,'road');assert.equal(roadPlan.assigned,1);assert.equal(roadPlan.unassigned[0].reasonCode,'capacity');assert.equal(directionsCalls,2);
assert.ok(roadPlan.routes.every(r=>r.totalMinutes<=60));assert.equal(roadPlan.routes[0].travelMinutes,10);assert.deepEqual(roadPlan.routes[0].geometry,roadGeometry);
assert.deepEqual(operationsGeoJSON([crew],[],roadPlan).routes.features[0].geometry,roadGeometry);

const old={...job('old',near),ageHours:90},deferred={...job('deferred',far),ageHours:60,source:'simulated',neighborhood:null};
const overview=responsibilityReport([...jobs,old,deferred],{routes:[{crew,stops:[jobs[0]]}],unassigned:[{...jobs[1],reasonCode:'skills',reason:'No roads crew'}]},new Set([jobs[0].id]));
assert.equal(overview.total,4);assert.equal(overview.assigned,1);assert.equal(overview.completed,1);assert.equal(overview.waiting[0].id,'old');assert.equal(overview.reasonCounts['outside-top-limit'],2);assert.equal(overview.reasonCounts.skills,1);
assert.equal(overview.neighborhoods.find(g=>g.name==='Community board 17 BROOKLYN').jobs,3);assert.equal(overview.neighborhoods.find(g=>g.source==='simulation').jobs,1);

const description='Water pouring into the street near a school.';
const rules=suggestWithRules(description);assert.equal(rules.method,'rules');assert.equal(rules.skill,'water');assert.equal(rules.severity,5);assert.equal(rules.reviewRequired,true);
assert.equal(suggestWithRules('A strange purple light appears every evening').skill,'unknown');
const proposal={title:'Water leak',skill:'water',severity:4,minutes:75,evidence:['pouring','invented sinkhole'],uncertainties:['Confirm location'],explanation:'Reported water flow.'};
assert.deepEqual(validateProposal(proposal,description).evidence,['pouring']);
assert.throws(()=>validateProposal({...proposal,skill:'police'},description));
assert.throws(()=>validateProposal({...proposal,severity:9},description));
let generateCalled=false;
const local=await analyzeLocally(description,'test-local',{fetchImpl:async (url,options)=>{
  assert.ok(url.startsWith('http://127.0.0.1:11434/'));
  if(url.endsWith('/api/tags'))return Response.json({models:[{name:'test-local'}]});
  generateCalled=true;const body=JSON.parse(options.body);assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.ok(body.prompt.includes(description));return Response.json({response:JSON.stringify(proposal)});
}});
assert.equal(generateCalled,true);assert.equal(local.method,'model');assert.equal(local.model,'test-local');
await assert.rejects(()=>analyzeLocally(description,'bad:cloud',{fetchImpl:async()=>Response.json({models:[{name:'bad:cloud',remote_host:'https://example.com'}]})}));
console.log('Upgrade checks passed: directed road-time routing, matrix limits, unreachable roads, final ETA capacity, real geometry, neighborhood denominators, waiting reasons and validated local intake.');
