import test from 'node:test';import assert from 'node:assert/strict';
import {waitForActiveBookingWorkerSettlement,assertActiveBookingWorkerConfigurationTransition} from './release-toolchain-active-generation-worker-settlement.mjs';
const before={pid:1,restartCount:0,script:'/owned/old',status:'online',configured:{pm_exec_path:'/owned/old',restart_time:0,env:{KEEP:'same'},axm_actions:[{action_name:'heap'}],axm_options:{metrics:true}},raw:{pm_exec_path:'/owned/old',KEEP:'same'},identity:{pid:1,startTicks:'1'}};
const after=()=>({...structuredClone(before),pid:2,restartCount:1,script:'/owned/new',configured:{...structuredClone(before.configured),pm_exec_path:'/owned/new',restart_time:1},raw:{pm_exec_path:'/owned/new',KEEP:'same'},identity:{pid:2,startTicks:'2'}});
function clock(observe){let time=0;return{observe:()=>observe(time),now:()=>time,delay:async ms=>{time+=ms;},elapsed:()=>time};}
test('online before instrumentation is ready waits for full unchanged config and stable process, without a second mutation',async()=>{
 const c=clock(time=>{const value=after();if(time<700){value.configured.axm_actions=[];value.configured.axm_options={};}return value;});
 assert.deepEqual(await waitForActiveBookingWorkerSettlement({...c,before,script:'/owned/new'}),after());assert.ok(c.elapsed()>=1500);
});
for(const change of [v=>v.configured.env.KEEP='changed',v=>v.raw.KEEP='changed',v=>v.configured.axm_actions=[],(v,time)=>v.identity={pid:2,startTicks:String(time)}])test('permanent full config/raw/identity drift is never accepted',async()=>{
 const c=clock(time=>{const value=after();change(value,time);return value;});await assert.rejects(waitForActiveBookingWorkerSettlement({...c,before,script:'/owned/new'}),/attempt_unknown/);assert.equal(c.elapsed(),10000);
});
test('an unexpected second process birth is unknown, not a retry',async()=>{const c=clock(time=>{const value=after();if(time>=500){value.pid=3;value.identity={pid:3,startTicks:'3'};}return value;});await assert.rejects(waitForActiveBookingWorkerSettlement({...c,before,script:'/owned/new'}),/attempt_unknown/);});
test('independent postconditions retain every manager field except the explicitly permitted restart metadata',()=>{
 assertActiveBookingWorkerConfigurationTransition(before.configured,after().configured);for(const key of ['axm_actions','axm_options','env']){const changed=after().configured;delete changed[key];assert.throws(()=>assertActiveBookingWorkerConfigurationTransition(before.configured,changed));}
});
