import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createDirectPgProbe,directPgQuery} from './member-checkout-direct-pg-probe.mjs';
const name='faolla_member_checkout_catalog_snapshot_v1',args={p_site_id:'10909994'};
function fixture(overrides={},options={}){
 const counts={connect:0,query:0,end:0},queries=[];
 const client={connect:async()=>{counts.connect++;},query:async q=>{counts.query++;queries.push(q);return {rows:[{result:{ok:true}}]};},end:async()=>{counts.end++;},...overrides};
 return {counts,queries,client,probe:createDirectPgProbe({clientFactory:()=>client,...options})};
}
test('one fixed parameterized extended query; repeated awaiting dispatches once and closes once',async()=>{
 const f=fixture(),call=f.probe.rpc(name,args);assert.equal(f.counts.query,0);
 assert.deepEqual(await call,{data:{ok:true},error:null});assert.deepEqual(await call,{data:{ok:true},error:null});
 assert.deepEqual(f.counts,{connect:1,query:1,end:1});assert.deepEqual(f.queries,[{text:directPgQuery,values:[name,JSON.stringify(args)],queryMode:'extended'}]);
 assert.equal(f.probe.from,undefined);assert.equal(f.probe.auth,undefined);
});
test('unknown methods, extra/missing parameters and malicious JSON refuse before opening',()=>{
 let created=0;const p=createDirectPgProbe({clientFactory:()=>{created++;}}),cyclic={};cyclic.value=cyclic;let getter=0;
 const values=[{},[],{p_site_id:'x',sql:'DROP TABLE pages'},cyclic,{p_site_id:NaN},{p_site_id:new Date()},{p_site_id:undefined},{get p_site_id(){getter++;return 'x';}}];
 for(const value of values)assert.throws(()=>p.rpc(name,value),/checkout_runtime_unavailable/);
 assert.throws(()=>p.rpc(name+';SELECT 1',args));assert.throws(()=>p.rpc('toString',args));assert.equal(created,0);assert.equal(getter,0);
});
test('captures immutable argument copy before a caller changes its object',async()=>{
 const f=fixture(),input={...args},call=f.probe.rpc(name,input);input.p_site_id='changed';await call;assert.equal(f.queries[0].values[1],JSON.stringify(args));
});
test('pre-aborted signal does not connect',async()=>{
 const f=fixture();await f.probe.rpc(name,args).abortSignal(AbortSignal.abort());assert.deepEqual(f.counts,{connect:0,query:0,end:0});
});
test('aborting during connect prevents even a late successful connect from dispatching',async()=>{
 let ready;const f=fixture({connect:()=>new Promise(resolve=>{ready=resolve;})}),stop=new AbortController();
 const waiting=Promise.resolve(f.probe.rpc(name,args).abortSignal(stop.signal));await delay(0);stop.abort();assert.equal((await waiting).error.message,'checkout_runtime_unavailable');ready();await delay(0);
 assert.equal(f.counts.query,0);assert.equal(f.counts.end,1);
});
test('deadline during a query closes connection, ignores late result, never retries',async()=>{
 let ready;const f=fixture({query:()=>new Promise(resolve=>{ready=resolve;})},{timeoutMs:15});
 const call=f.probe.rpc(name,args);assert.equal((await call).error.message,'checkout_runtime_unavailable');ready({rows:[{result:{late:true}}]});await delay(0);
 assert.equal((await call).data,null);assert.equal(f.counts.end,1);
});
test('business errors are allowlisted; database diagnostics and credential-bearing errors are never returned',async()=>{
 for(const [code,message,expected] of [['P0001','checkout_version_conflict','checkout_version_conflict'],['42501','password:synthetic-do-not-export','checkout_runtime_unavailable'],['P0001','SQL includes synthetic-private-value','checkout_runtime_unavailable']]){
  const f=fixture({query:async()=>{throw Object.assign(Error(message),{code});}});assert.deepEqual(await f.probe.rpc(name,args),{data:null,error:{message:expected}});assert.equal(f.counts.end,1);
 }
});
test('bounded concurrent connections refuse overload without enqueueing or opening',async()=>{
 let ready;let made=0;const client={connect:async()=>{},query:()=>new Promise(resolve=>{ready=resolve;}),end:async()=>{}};
 const p=createDirectPgProbe({clientFactory:()=>{made++;return client;},maxActive:1}),first=Promise.resolve(p.rpc(name,args));await delay(0);
 assert.equal((await p.rpc(name,args)).error.message,'checkout_runtime_unavailable');assert.equal(made,1);ready({rows:[{result:{ok:true}}]});await first;
});
test('cannot append an abort signal after dispatch; invalid resource settings refuse',async()=>{
 const f=fixture(),call=f.probe.rpc(name,args);await call;assert.throws(()=>call.abortSignal(new AbortController().signal));
 for(const timeoutMs of [0,12001,NaN])assert.throws(()=>createDirectPgProbe({clientFactory:()=>{},timeoutMs}));
 for(const maxActive of [0,5])assert.throws(()=>createDirectPgProbe({clientFactory:()=>{},maxActive}));
});
test('malformed replies and invalid factory handles fail closed without leaking diagnostics',async()=>{
 for(const response of [{rows:[]},{rows:[{},{}]},{rows:[{}]},{rows:[{result:undefined}]}]){
  const f=fixture({query:async()=>response});assert.equal((await f.probe.rpc(name,args)).error.message,'checkout_runtime_unavailable');assert.equal(f.counts.end,1);
 }
 const p=createDirectPgProbe({clientFactory:()=>{throw Error('synthetic secret must stay private');}});
 assert.deepEqual(await p.rpc(name,args),{data:null,error:{message:'checkout_runtime_unavailable'}});
});
test('a client whose closure failed is not recycled or silently replaced',async()=>{
 let made=0;const p=createDirectPgProbe({maxActive:1,clientFactory:()=>{made++;return {connect:async()=>{},query:async()=>({rows:[{result:{ok:true}}]}),end:async()=>{throw Error('synthetic close failure');}};}});
 assert.equal((await p.rpc(name,args)).data.ok,true);assert.equal((await p.rpc(name,args)).error.message,'checkout_runtime_unavailable');assert.equal(made,1);
});
