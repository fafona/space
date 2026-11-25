import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {loadInstallationPlan} from './member-checkout-installation-plan.mjs';
import {inspectCompatibilityCatalog} from './member-checkout-compatibility-check.mjs';
import {compile047LegacyFunctions,loadCheckout047Compatibility,readCheckout047Compatibility,inspectCheckout047Compatibility} from './member-checkout-047-compatibility.mjs';
const contract=await loadCheckout047Compatibility(),plan=await loadInstallationPlan();
const fixture=()=>({functions:contract.expected.functions.map(fn=>({...fn,body:'unavailable-in-synthetic-fixture',sqlBody:false,ownerBypassesRls:true,
 publicExecute:false,executors:[]})),tables:contract.expected.tables.map(name=>({name,kind:'r',rls:true,forced:true,policies:0,publicAccess:false,accessors:[]})),
 triggers:contract.expected.triggers.map(t=>({...t,enabled:'O',args:0,qualified:false,columns:''})),schemas:[{name:'faolla_checkout_design',publicAccess:false,accessors:[]}]});
test('the separate expectation binds all 047 functions, renamed original, exact patches, runtime and private audit',()=>{
 assert.equal(contract.legacy.length,11);assert.equal(contract.expected.functions.length,plan.expected.functions.length+13);
 assert.equal(contract.expected.tables.length,plan.expected.tables.length+1);assert.equal(contract.expected.triggers.length,plan.expected.triggers.length+2);
 assert.equal(contract.expected.functions.find(fn=>fn.name==='faolla_commit_redemption_v1').bodySha256,contract.revision.oldWrapper.bodySha256);
 assert.equal(contract.expected.functions.find(fn=>fn.name==='faolla_commit_redemption_internal_v1').bodySha256,plan.prerequisites.functions.find(fn=>fn.name==='faolla_commit_redemption_v1').bodySha256);
 for(const fn of contract.legacy)assert.ok(contract.expected.functions.includes(fn));
 assert.ok(Object.isFrozen(contract.expected));assert.equal(contract.productionAuthorized,false);assert.equal(contract.deploymentReady,false);
});
test('the old inspector is not loosened and unbranded caller expectations cannot be used',()=>{
 const catalog=fixture();assert.ok(inspectCompatibilityCatalog(plan.expected,catalog).issues.some(v=>v.startsWith('unexpected_private_table:')));
 assert.throws(()=>inspectCheckout047Compatibility({...contract},catalog),/expectation_unverified/);
 assert.equal(inspectCheckout047Compatibility(contract,catalog).deploymentReady,false);
});
test('047-specific parser refuses extra functions, argument defaults or composite substitutions',()=>{
 const source=contract.revision.legacySql;
 assert.throws(()=>compile047LegacyFunctions(source+'\nCREATE OR REPLACE FUNCTION public.extra() RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;'),/count_changed/);
 assert.throws(()=>compile047LegacyFunctions(source.replace('p_operation_id text default null','p_operation_id text default 1')),/argument_changed/);
 assert.throws(()=>compile047LegacyFunctions(source.replace('p_row public.faolla_redemption_checkouts','p_row public.pages')),/argument_changed/);
});
test('new expectation has no environment/connector/write or authority path, and the old checker is still a fixed read-only inspector',async()=>{
 const source=await readFile(new URL('member-checkout-047-compatibility.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/process\.env|writeFile|appendFile|child_process|\bfetch\s*\(|from ['"](?:pg|node:net|node:https?)['"]/);
 assert.doesNotMatch(source,/deploymentReady:\s*true|productionAuthorized:\s*true/);
});

const exposed=new Set(['faolla_commit_redemption_v1','faolla_stage_redemption_checkout_v1','faolla_get_redemption_checkout_v1','faolla_cancel_redemption_checkout_v1','faolla_ack_redemption_checkout_v1','faolla_commit_redemption_v2']);
const legacy=()=>{
 const catalog=fixture(),definitions=[...contract.legacy,{signature:'public.faolla_commit_redemption_internal_v1(text,jsonb)',name:'faolla_commit_redemption_internal_v1',defaults:0}];
 for(const fn of definitions)catalog.functions.find(row=>row.signature===fn.signature).executors=exposed.has(fn.name)?['service_role']:[];
 const details=definitions.map(fn=>({signature:fn.signature,defaults:fn.defaults,executorExecute:fn.name==='faolla_commit_redemption_v1',runtimeExecute:false}));
 return {catalog,details,definitions};
};
test('all twelve exact old entry points bind defaults, effective executor/runtime rights and API exposure',()=>{
 const {catalog,details,definitions}=legacy();
 // Bodies here deliberately remain synthetic; only inspect the additional
 // invocation/boundary issues. Full body matching is exercised in real PG.
 assert.deepEqual(inspectCheckout047Compatibility(contract,catalog,details).issues.filter(v=>v.startsWith('legacy_047_')),[]);
 for(const definition of definitions){
  const invocation='legacy_047_invocation_changed:'+definition.signature,boundary='legacy_047_boundary_changed:'+definition.signature;
  for(const key of ['defaults','runtimeExecute','executorExecute']){
   const changed=structuredClone(details),row=changed.find(v=>v.signature===definition.signature);
   row[key]=key==='defaults'?row[key]+1:!row[key];
   assert.ok(inspectCheckout047Compatibility(contract,catalog,changed).issues.includes(invocation));
  }
  for(const patch of [{publicExecute:true},{executors:['authenticated','service_role']},...(catalog.functions.find(fn=>fn.signature===definition.signature).securityDefiner?[{ownerBypassesRls:false}]:[])]){
   const changed=structuredClone(catalog);Object.assign(changed.functions.find(fn=>fn.signature===definition.signature),patch);
   assert.ok(inspectCheckout047Compatibility(contract,changed,details).issues.includes(boundary));
  }
  assert.ok(inspectCheckout047Compatibility(contract,catalog,details.filter(v=>v.signature!==definition.signature)).issues.includes(invocation));
  assert.ok(inspectCheckout047Compatibility(contract,catalog,[...details,details.find(v=>v.signature===definition.signature)]).issues.includes(invocation));
 }
 assert.deepEqual(inspectCheckout047Compatibility(contract,catalog,details.map(row=>({...row,signature:row.signature.replace(/^public\./,'')}))).issues.filter(v=>v.startsWith('legacy_047_')),[]);
});
test('the independent reader uses only four original metadata SELECTs and one parameterized twelve-signature SELECT',async()=>{
 const {catalog,details}=legacy(),calls=[];
 const result=await readCheckout047Compatibility(async(sql,args)=>{calls.push({sql,args});return {rows:calls.length===5?details:catalog[['functions','tables','triggers','schemas'][calls.length-1]]};},contract);
 assert.deepEqual(result,{catalog,legacyDetails:details});assert.equal(calls.length,5);
 for(const call of calls)assert.match(call.sql,/^SELECT\s/i);
 for(const call of calls.slice(0,4))assert.equal(call.args,undefined);
 assert.match(calls[4].sql,/\$1::regprocedure\[\]/);assert.deepEqual(calls[4].args,[details.map(row=>row.signature)]);
 let queried=false;await assert.rejects(readCheckout047Compatibility(async()=>{queried=true;},{...contract}),/expectation_unverified/);assert.equal(queried,false);
 await assert.rejects(readCheckout047Compatibility(async(sql)=>({rows:sql.includes('pronargdefaults')?details.slice(1):[]}),contract),/legacy_details_invalid/);
});
