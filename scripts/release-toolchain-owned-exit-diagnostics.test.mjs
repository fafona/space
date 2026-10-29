import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {safeOwnedExitResources,scheduleOwnedExitDiagnostics} from './release-toolchain-owned-exit-diagnostics.mjs';
test('owned exit diagnostics retain only bounded resource types and child exit facts, never environment or handle internals',()=>{
 const child={constructor:{name:'ChildProcess'},pid:123,exitCode:null,signalCode:null,spawnargs:['secret'],env:{secret:true},_handle:{hasRef:()=>true}},runtime={stdin:{},stdout:{},stderr:{},getActiveResourcesInfo:()=>['ProcessWrap','secret/path'],_getActiveHandles:()=>[child],_getActiveRequests:()=>[{constructor:{name:'FSReqCallback'}}]};
 assert.deepEqual(safeOwnedExitResources(runtime),{resources:['ProcessWrap','redacted'],handles:[{type:'ChildProcess',stdio:null,pid:123,exitCode:null,signalCode:null,referenced:true}],requests:['FSReqCallback']});
 assert.doesNotMatch(JSON.stringify(safeOwnedExitResources(runtime)),/secret/);
});
test('diagnostic timers are unreferenced and only observe; they never close resources, signal or manufacture success',()=>{
 const calls=[],timers=[],runtime={pid:55,stdin:{},stdout:{},stderr:{},getActiveResourcesInfo:()=>[],_getActiveHandles:()=>[],_getActiveRequests:()=>[]};
 scheduleOwnedExitDiagnostics('/var/lib/faolla-booking-full-rehearsal-Test1',{runtime,write:(phase,value)=>calls.push({phase,value}),schedule:(callback,delay)=>{const timer={callback,delay,unref:()=>{timer.unreferenced=true;}};timers.push(timer);return timer;},now:()=> '2026-10-29T04:30:00.000Z'});
 assert.equal(calls.length,1);assert.deepEqual(timers.map(t=>[t.delay,t.unreferenced]),[[2000,true],[10000,true]]);timers.forEach(t=>t.callback());assert.deepEqual(calls.map(c=>c.phase),['returned','after-2s','after-10s']);assert.ok(calls.every(c=>c.value.publicationAuthority===false&&c.value.observationOnly));assert.equal(runtime.exitCode,undefined);
 assert.throws(()=>scheduleOwnedExitDiagnostics('/var/lib/faolla-online-release',{runtime}),/diagnostic_path/);
 const source=readFileSync(new URL('./release-toolchain-owned-exit-diagnostics.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/process\.exit\(|\.kill\(|\.destroy\(|\.close\(|process\.env/);
});
