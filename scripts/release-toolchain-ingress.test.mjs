import test from 'node:test';import assert from 'node:assert/strict';
import {drainAndProbeIngress} from './release-toolchain-ingress.mjs';
function fixture(){let clock=10000,polls=0;const events=[],operations={nowMs:()=>clock,now:()=>new Date(clock).toISOString(),
 authorize:()=>events.push('authorize'),workers:()=>['old'],begin:()=>events.push('begin'),install:()=>events.push('install'),syntax:()=>events.push('syntax'),reload:()=>events.push('reload'),
 drain:()=>{events.push('drain');return {oldWorkersRemaining:++polls<3?1:0,applicationConnections:polls<2?1:0};},wait:ms=>{clock+=ms;},probeGate:()=>events.push('probe')};
 return {events,operations,options:{startedAtMs:10000,deadlineAtMs:100000,window:{}},setClock:v=>{clock=v;}};}
test('the reusable primitive makes all generations/connections leave before its one strict gate proof',async()=>{
 const f=fixture(),r=await drainAndProbeIngress(f.operations,f.options);assert.deepEqual(r.proof,{oldWorkersRemaining:0,applicationConnections:0});assert.equal(f.events.at(-1),'probe');assert.equal(f.events.filter(v=>v==='probe').length,1);
});
for(const stage of ['authorize','workers','begin','install','syntax','reload','drain','probeGate'])test('unknown '+stage+' is terminal and has no generic retry',async()=>{
 const f=fixture(),failure=Error('unknown');let calls=0;f.operations[stage]=()=>{calls++;throw failure;};await assert.rejects(drainAndProbeIngress(f.operations,f.options),v=>v===failure);assert.equal(calls,1);
});
test('drain budget never expands; stuck connections never become admitted',async()=>{
 const f=fixture();f.operations.drain=()=>({oldWorkersRemaining:0,applicationConnections:1});await assert.rejects(drainAndProbeIngress(f.operations,f.options),/ingress_not_drained/);assert.equal(f.events.includes('probe'),false);
 const g=fixture();g.options.deadlineAtMs=100001;await assert.rejects(drainAndProbeIngress(g.operations,g.options),/invalid_contract/);
});
test('negative/fractional counts, backwards clocks and a slow proof cannot produce readiness',async()=>{
 for(const observed of [{oldWorkersRemaining:-1,applicationConnections:0},{oldWorkersRemaining:0,applicationConnections:0.5},{oldWorkersRemaining:NaN,applicationConnections:0}]){
  const f=fixture();f.operations.drain=()=>observed;await assert.rejects(drainAndProbeIngress(f.operations,f.options),/observation_mismatch/);}
 const f=fixture();f.setClock(9999);await assert.rejects(drainAndProbeIngress(f.operations,f.options),/clock_invalid/);
 const g=fixture();g.operations.probeGate=()=>g.setClock(g.options.deadlineAtMs);await assert.rejects(drainAndProbeIngress(g.operations,g.options),/ingress_not_drained/);
});
