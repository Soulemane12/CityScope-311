import assert from 'node:assert/strict';
import { DEFAULT_CREWS, SCENARIO_INCIDENTS, buildJobs, distanceKm, greedyRoute, createDispatchPlan, operationsGeoJSON, tourDistance } from '../lib/dispatch.mjs';

const job = (id, coordinates, score = 50, skill = 'roads', minutes = 20) => ({ id, coordinates, score, skill, minutes });
const crew = { id: 'A', skills: ['roads'], coordinates: [-74, 40.7], available: true, color: '#123456' };
assert.equal(distanceKm(crew.coordinates, crew.coordinates), 0);
assert.ok(Math.abs(distanceKm([-74,40.7],[-73.99,40.7])-distanceKm([-73.99,40.7],[-74,40.7]))<1e-9);
const jobs = [job('far', [-73.96,40.7]),job('near',[-73.999,40.7]),job('middle',[-73.98,40.7])];
const route = greedyRoute(crew.coordinates, jobs);
assert.deepEqual(route.stops.map(j=>j.id), ['near','middle','far']);
assert.equal(jobs[0].id,'far'); // no mutation of caller order
assert.equal(new Set(route.stops.map(j=>j.id)).size,jobs.length);
assert.equal(route.distanceKm,tourDistance(crew.coordinates,route.stops));
assert.ok(route.distanceKm>distanceKm(crew.coordinates,jobs[0].coordinates)); // return leg included
assert.deepEqual(greedyRoute(crew.coordinates,[]),{stops:[],distanceKm:0});

const plan=createDispatchPlan([job('low',[-74,40.7],20),job('high',[-74,40.7],90),job('water',[-74,40.7],95,'water')],[crew],{limit:3,shiftHours:1,maxStops:1});
assert.equal(plan.routes[0].stops[0].id,'high');
assert.equal(plan.assigned,1);
assert.equal(plan.unassigned.find(j=>j.id==='water').reason,'No available crew with water skills.');
assert.ok(plan.routes.every(r=>r.totalMinutes<=60));
assert.equal(createDispatchPlan(jobs,[{...crew,available:false}]).assigned,0);
assert.equal(createDispatchPlan([job('long',[-74,40.7],90,'roads',500)],[crew],{shiftHours:1}).assigned,0);

const report={id:'123',title:'Pothole',detail:'Road condition',address:'1 MAIN ST',borough:'MANHATTAN',created:'2026-11-04T00:00:00',coordinates:[-74,40.7],category:'streets',isClosed:false};
const routineWater=buildJobs([{...report,title:'Water Maintenance',detail:'Routine inspection'}],[],'2026-11-04T12:00:00').jobs[0];
const brokenMain=buildJobs([{...report,title:'Water Maintenance',detail:'Water main break'}],[],'2026-11-04T12:00:00').jobs[0];
assert.equal(routineWater.severity,3);assert.equal(brokenMain.severity,5);assert.ok(brokenMain.score>routineWater.score);
const analysis=buildJobs([report,{...report,id:'124'},{...report,id:'closed',isClosed:true},{...report,id:'noise',title:'Noise - Residential'}],[],'2026-11-04T12:00:00');
assert.equal(analysis.jobs.length,1);assert.equal(analysis.jobs[0].count,2);assert.equal(analysis.closed,1);assert.equal(analysis.referral,1);assert.equal(analysis.merged,1);
assert.equal(analysis.jobs[0].skill,'roads');
assert.equal(buildJobs([report],[],'2026-11-04T12:00:00',new Set(['311-123'])).jobs.length,0);
const scenario=buildJobs([],SCENARIO_INCIDENTS,'2026-11-04T12:00:00');
const scenarioPlan=createDispatchPlan(scenario.jobs,DEFAULT_CREWS);
assert.equal(scenarioPlan.assigned+scenarioPlan.unassigned.length,scenario.jobs.length);
assert.ok(scenarioPlan.assigned>0);
const allIds=scenarioPlan.routes.flatMap(r=>r.stops.map(s=>s.id));assert.equal(new Set(allIds).size,allIds.length);
for(const r of scenarioPlan.routes){assert.ok(r.stops.every(s=>r.crew.skills.includes(s.skill)));assert.ok(r.totalMinutes<=480);assert.ok(r.stops.length<=5);}
const geo=operationsGeoJSON(DEFAULT_CREWS,SCENARIO_INCIDENTS,scenarioPlan,new Set([allIds[0]]));
assert.equal(geo.crews.features.length,DEFAULT_CREWS.length);
assert.equal(geo.stops.features.length,scenarioPlan.assigned);
for(const f of geo.routes.features)assert.deepEqual(f.geometry.coordinates[0],f.geometry.coordinates.at(-1));
console.log('Dispatch checks passed: nearest neighbor, closed tours, priority, skills, availability, shift limits, deduplication, completion and map layers.');
