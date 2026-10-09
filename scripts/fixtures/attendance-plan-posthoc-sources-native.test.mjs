// Static/isolated JavaScript tests only. These are not PostgreSQL evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const url=new URL('./attendance-plan-posthoc-sources-native.mjs',import.meta.url),text=readFileSync(url,'utf8');
const ast=ts.createSourceFile('posthoc-sources.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function nodes(root,predicate){const result=[];function visit(n){if(predicate(n))result.push(n);ts.forEachChild(n,visit);}visit(root);return result;}
const named=name=>{const found=nodes(ast,n=>(ts.isFunctionDeclaration(n)||ts.isVariableDeclaration(n))&&n.name?.getText(ast)===name);assert.equal(found.length,1,name);return found[0];};
const functionText=name=>named(name).getText(ast).replace(/^export\s+/,'');
const initializer=name=>named(name).initializer.getText(ast);
const plain=value=>JSON.parse(JSON.stringify(value));

test('import is inert and both functions reject non-synthetic contexts before any native query',async()=>{
  const helper=await import(url);assert.deepEqual(Object.keys(helper).sort(),['createPosthocMissingNative','seedPosthocNativeSources']);
  let calls=0;const ctx={d:{syntheticOnly:false},h:{syntheticOnly:true,syntheticHistoricalRows:10},native:{query:()=>{calls++;throw Error('must not connect');}}};
  for(const fn of Object.values(helper))await assert.rejects(()=>fn(ctx),/posthoc_synthetic_history_required/);
  assert.equal(calls,0);
  assert.equal(nodes(ast,n=>ts.isCallExpression(n)&&/\b(?:spawn|execFile|runAttendance|preparePlan|withAttendanceConcurrencySandbox)/.test(n.expression.getText(ast))).length,0);
});

test('real owned namespace and exact history bindings gate both entry points',()=>{
  const guard=functionText('ownedContext');
  for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    'assert.equal(h.workerId,d.otherWorker)','assert.equal(h.employeeId,d.otherEmployee)','assert.equal(h.employeeAuthUserId,d.otherAuth)',
    'set local time zone','set local datestyle'])assert(guard.includes(token),token);
  for(const name of ['seedPosthocNativeSources','createPosthocMissingNative'])assert(functionText(name).includes('state=ownedContext(ctx)'));
});

test('original-row fingerprint excludes only exact new IDs, not whole mutable tables',()=>{
  const context={assert,id,quote};vm.createContext(context);
  vm.runInContext('const ids='+initializer('ids')+';const sessionTargets='+initializer('sessionTargets')+';const missingTargets='+initializer('missingTargets')+';'+functionText('factsSql')+
    ';globalThis.session=factsSql(["merchant_attendance_events","merchants"],sessionTargets);globalThis.missing=factsSql(Object.keys(missingTargets),missingTargets);',context);
  assert(context.session.includes("where r.id not in('"+id(204710)+"','"+id(204711)+"')"));
  assert(context.session.includes('from public.merchants r) rows'));
  for(const number of [204714,204715,204716])assert(context.missing.includes(id(number)));
  assert.throws(()=>vm.runInContext('factsSql(["outside_schema.table"])',context));
  assert.throws(()=>vm.runInContext('factsSql(["merchants","merchants"])',context));
});

test('history seed uses exactly two new events plus unverified133 binding and real148 proof, with no plan sidecar fabrication',()=>{
  const seed=functionText('seedPosthocNativeSources');
  const inserts=[...seed.matchAll(/insert into public\.([a-z0-9_]+)/g)].map(m=>m[1]);
  assert.deepEqual(inserts,['merchant_attendance_events','merchant_attendance_shift_rule_bindings']);
  for(const token of ["sequence=2 and action='clock_out'","interval '25 minutes'","interval '20 minutes'","interval '15 minutes'",
    "'unverified','source_unavailable',null",'faolla_attendance_period_session_v1',"proof->'relation'='null'::jsonb",'posthoc_seed_preserves_original_rows',
    'actualHistoricalClockRequests:false','lastSequence:4'])assert(seed.includes(token),token);
  assert(!/\b(?:update|delete|truncate|alter|create\s+table)\b/i.test(seed));
  const checks=functionText('tableChecks');assert(checks.includes('c.relrowsecurity'));assert(checks.includes('not c.convalidated'));assert(checks.includes("t.tgenabled<>'O'"));
});

test('missing path invokes actual old service and explicit old policy with exact actor split and submission date scope',()=>{
  const body=functionText('createPosthocMissingNative');
  for(const token of ["require('../../src/lib/merchantAttendanceMissing.server.ts')","assert.equal(name,'faolla_attendance_missing_v1')",'faolla_attendance_correction_controls_v2',
    'submissionWindowDays:365','fromDate:timing.today,throughDate:timing.today',"interval '10 minutes'","interval '5 minutes'",
    "q.access==='owner'?d.owner:h.employeeAuthUserId",'expectedRevision:1,evidenceToken:review.detail.evidenceToken',
    'posthoc_missing_read_zero_writes','posthoc_missing_all_preexisting_business_rows_unchanged'])assert(body.includes(token),token);
  assert(!/insert into public\.merchant_attendance_missing/.test(body),'business success must be actual RPC, not forged request/decision');
  const returnStatement=nodes(named('createPosthocMissingNative'),n=>ts.isReturnStatement(n)).at(-1);
  assert.deepEqual(returnStatement.expression.properties.map(n=>n.name.getText(ast)),['kind','rootRequestId','requestId','approvalOperationId']);
  const roleSetup=body.slice(body.indexOf('const role='),body.indexOf('const preserved='));
  assert(roleSetup.includes('posthoc_role_setup_compare_and_swap'));assert(roleSetup.includes('assert.deepEqual(stable(configured),stable(role))'));
  assert(roleSetup.includes('posthoc_only_explicit_fixture_role_setup'));
});

test('actual seed orchestration rejects a changed original-row fingerprint (isolated ports, no PG)',async()=>{
  const run=async tamper=>{
    const calls=[],session={item:{events:[{id:id(204710),sequence:3,action:'clock_in'},{id:id(204711),sequence:4,action:'clock_out'}]},ruleBinding:{employeeId:id(1),employeeAuthUserId:id(2)}};
    let wrote=false;
    const exec=sql=>{calls.push(sql);if(sql.includes('do $posthoc_session_seed$')){wrote=true;return JSON.stringify(session);}
      if(sql.includes('count(*)'))return JSON.stringify({merchant_attendance_events:wrote?4:2,merchant_attendance_shift_rule_bindings:wrote?1:0});
      return tamper&&wrote?'changed':'unchanged';};
    const d={site:'99990001',owner:id(3),location:id(4)},h={workerId:id(5),employeeId:id(1),employeeAuthUserId:id(2),startEventId:id(6),lastEventId:id(7),slot:{endAt:'2026-10-04T10:00:00.000Z'}};
    const context={assert,id,quote,ownedContext:()=>({owned:{oid:123},exec,names:['merchant_attendance_events','merchant_attendance_shift_rule_bindings']}),
      factsSql:()=>'(original_rows_hash)',tableChecks:()=>'',locks:()=>'',sameDefinitions:()=>{},counts:(e,t)=>JSON.parse(e('select count(*) from '+Object.keys(t).join(',')))};
    vm.createContext(context);vm.runInContext('const ids='+initializer('ids')+';const sessionTargets='+initializer('sessionTargets')+';'+functionText('seedPosthocNativeSources'),context);
    const result=await context.seedPosthocNativeSources({d,h,native:{pass:()=>{}}});return {result:plain(result),calls};
  };
  const normal=await run(false);assert.equal(normal.result.reference.startEventId,id(204710));assert.equal(normal.result.syntheticHistoricalRows,3);
  assert.equal(normal.calls.filter(sql=>sql.includes('do $posthoc_session_seed$')).length,1);
  await assert.rejects(()=>run(true),/changed|unchanged/);
});
