import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createBookingAtomicRoutingPlan} from './booking-handoff-routing.mjs';import {ACTIVE_BOOKING_INCIDENT as P} from './release-toolchain-active-generation-contract.mjs';
import {WEB_RELEASE_FILES} from './web-presentation-release-policy.mjs';
import {createActiveBookingRoutingPlan,assertActiveBookingRoutingPlan,assertActiveBookingRoutingCurrent,executeActiveBookingRoutingPhase} from './release-toolchain-active-generation-routing.mjs';
const anchor=(target,port)=>({target,port,name:'merchant-space-online-'+target.slice(0,12),directory:'/www/wwwroot/merchant-space.web-releases/'+target.slice(0,12)+'-online'});
const original=createBookingAtomicRoutingPlan({before:JSON.parse(readFileSync(new URL('./test-support/booking-handoff-routing-fixture.json',import.meta.url),'utf8')),primary:anchor(P.candidate,3104),rollback:anchor(P.compatibleRollback,3110),window:P.originalWindow});
const window={id:'10000000-0000-4000-8000-000000000001',startedAt:'2026-10-29T01:00:00.000Z',deadlineAt:'2026-10-29T01:10:00.000Z'},plan=()=>createActiveBookingRoutingPlan({originalPlan:original,window});
test('new edge begins with exact compatible rollback and retains the old plan without granting historical phase authority',()=>{
 const before=structuredClone(original),value=plan();assertActiveBookingRoutingPlan(value,original);assert.deepEqual(value.before,original.phases.rollback);assert.deepEqual(original,before);assert.deepEqual(Object.keys(value.phases),['primary','rollback']);
 assert.equal(value.primary.port,3104);assert.equal(value.rollback.port,3110);for(const file of WEB_RELEASE_FILES)for(const phase of Object.values(value.phases)){assert.ok(!phase[file].includes('127.0.0.1:3000;'));assert.ok(!phase[file].includes('127.0.0.1:3103;'));}
});
test('old receipt, altered old plan, old window, extra phase and changed source bytes fail closed',()=>{
 for(const mutate of [v=>v.primary.port=3106,v=>v.before[WEB_RELEASE_FILES[0]]+='\n',v=>v.window.id=window.id]){const copy=structuredClone(original);mutate(copy);assert.throws(()=>createActiveBookingRoutingPlan({originalPlan:copy,window}));}
 assert.throws(()=>createActiveBookingRoutingPlan({originalPlan:original,window:P.originalWindow}));const value=plan();value.phases.armed=original.phases.armed;assert.throws(()=>assertActiveBookingRoutingPlan(value,original));
});
function fixture(phase='primary',failAt){const value=plan(),events=[];let current=structuredClone(phase==='primary'?value.before:value.phases.primary),receipt;
 const step=(name,fn=()=>{})=>async(...args)=>{events.push(name);if(failAt===name)throw Error('unknown_'+name);return fn(...args);};
 return{value,events,current:()=>current,receipt:()=>receipt,setCurrent:v=>{current=v;},operations:{now:()=>window.startedAt,read:async()=>structuredClone(current),authorize:step('authorize'),begin:step('begin'),replace:step('replace',(file,before,after)=>{assert.equal(current[file],before);current[file]=after;}),syntax:step('syntax'),reload:step('reload'),verify:step('verify'),complete:step('complete',value=>{receipt=value;})}};
}
for(const phase of ['primary','rollback'])test('ordered already-active '+phase+' changes only the three owned routes and validates both sides of reload',async()=>{
 const f=fixture(phase),result=await executeActiveBookingRoutingPhase(f.operations,f.value,original,phase);assert.deepEqual(f.events,['authorize','begin','replace','replace','replace','syntax','reload','verify','complete']);assert.equal(result.activationPerformed,false);assert.equal(result.legacyRestartPerformed,false);assertActiveBookingRoutingCurrent(f.value,original,f.current(),{phase});
});
test('recovery accepts partial own C/A batches but never B, arbitrary bytes or a forward replay',async()=>{
 const f=fixture('rollback');f.setCurrent({...f.value.phases.primary,[WEB_RELEASE_FILES[0]]:f.value.phases.rollback[WEB_RELEASE_FILES[0]]});await executeActiveBookingRoutingPhase(f.operations,f.value,original,'rollback');
 for(const current of [original.before,original.phases.armed,{...f.value.before,[WEB_RELEASE_FILES[0]]:'unowned'}])assert.throws(()=>assertActiveBookingRoutingCurrent(f.value,original,current));
 f.setCurrent(structuredClone(f.value.phases.primary));await assert.rejects(executeActiveBookingRoutingPhase(f.operations,f.value,original,'primary'));await assert.rejects(executeActiveBookingRoutingPhase(f.operations,f.value,original,'armed'));
});
for(const phase of ['primary','rollback'])for(const stage of ['authorize','begin','replace','syntax','reload','verify','complete'])test(phase+' unknown '+stage+' does not retry or restore old phases',async()=>{
 const f=fixture(phase,stage);await assert.rejects(executeActiveBookingRoutingPhase(f.operations,f.value,original,phase),new RegExp('unknown_'+stage));assert.equal(f.events.filter(value=>value===stage).length,1);assert.equal(f.receipt(),undefined);
});
