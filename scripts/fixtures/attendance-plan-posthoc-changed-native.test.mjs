// Inert/static fixture checks only, not actual PostgreSQL acceptance evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {quote} from './attendance-bound-clocks-native.mjs';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';

const url=new URL('./attendance-plan-posthoc-changed-native.mjs',import.meta.url),source=readFileSync(url,'utf8');
const ast=ts.createSourceFile('changed.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const body=name=>{const found=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);assert.equal(found.length,1);return found[0].getText(ast).replace(/^export\s+/,'');};
const has=(text,...parts)=>parts.forEach(p=>assert(text.includes(p),p));

test('helper import is inert and invalid context fails before any SQL',async()=>{
  const helper=await import(url);assert.deepEqual(Object.keys(helper),['checkPosthocChangedNative']);
  let queries=0;await assert.rejects(()=>helper.checkPosthocChangedNative({d:{syntheticOnly:false},h:{syntheticOnly:true},native:{query:()=>{queries++;}}}),/posthoc_changed_synthetic_context_required/);
  assert.equal(queries,0);assert.doesNotMatch(source,/spawn\(|execFile\(|createBrowser|withAttendanceConcurrencySandbox|runPlanPosthocNative/);
});

test('both mutations are actual old service commands, use explicit real actors and saved parent approval with UTC6 outside bounds',()=>{
  const run=body('checkPosthocChangedNative');
  has(run,"require('../../src/lib/merchantAttendanceMissing.server.ts')","assert.equal(name,'faolla_attendance_missing_v1')",'set local role service_role',
    "q.access==='owner'?d.owner:h.employeeAuthUserId","action:'revise'",'supersedesRequestId:savedRef.requestId,expectedApprovalOperationId:savedRef.approvalOperationId',
    "action:'approve'",'expectedRevision:1,evidenceToken:review.detail.evidenceToken',"interval '5 minutes'","interval '10 minutes'",'assert.equal(timing.past,true',
    'fromDate:timing.today,throughDate:timing.today','expectedPolicyRevision:home.policyRevision');
  assert.doesNotMatch(run,/insert into public\.|update public\.|delete from public\.|disable trigger|alter table|set_policy|submissionWindowDays/);
  assert.equal((run.match(/writeCount\+\+/g)||[]).length,2);
});

test('pending and approved stages use actual evaluator and explicitly preserve saved snapshots, old rule and displaced source',()=>{
  const run=body('checkPosthocChangedNative');
  has(run,'result=await evaluate()',"pending.state,'blocked'","pending.blockers.includes('pending_missing')",
    "pendingObservation.current.blockers.includes('pending_missing')",'assert.deepEqual(pendingObservation.current.reference,savedRef)',
    "changed.state,'blocked'","changed.source.resolutionBlockers.includes('source_changed')",
    'assert.deepEqual(changed.source.posthoc,originalPosthoc','assert.deepEqual(changed.source.approval,originalApproval',
    'assert.deepEqual(observed.reference,savedRef)',"{kind:'missing',requestId,rootRequestId:savedRef.rootRequestId,approvalOperationId:approvalId}",
    "observed.current.blockers.includes('source_outside_plan')",'current point read must not be limited to old plan context',
    'posthoc_changed_evaluation_zero_writes','posthoc_changed_missing_read_zero_writes');
});

test('protected hash excludes exact new IDs only; definitions and catalog are unchanged and parent owns cleanup',()=>{
  const context={assert,quote};vm.createContext(context);vm.runInContext(body('preservedSql')+';globalThis.hash=preservedSql;',context);
  const sql=context.hash(['merchants','merchant_attendance_missing_requests','merchant_attendance_missing_entries','merchant_attendance_plan_posthoc_operations'],id(2051),id(2052));
  has(sql,'from public.merchants preserved_rows) rows','from public.merchant_attendance_plan_posthoc_operations preserved_rows) rows',
    'where preserved_rows.request_id<>'+quote(id(2051)),"where preserved_rows.operation_id not in("+quote(id(2051))+','+quote(id(2052))+')');
  assert.throws(()=>context.hash(['outside.table'],id(1),id(2)));assert.throws(()=>context.hash(['merchants','merchants'],id(1),id(2)));
  const run=body('checkPosthocChangedNative');has(run,'assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)',
    "set local time zone 'UTC'",'assert.equal(d.definitions(),definitions)','assert.equal(d.tableCatalog(),catalog)',
    'afterCounts.requests,beforeCounts.requests+1','afterCounts.entries,beforeCounts.entries+2','callerOwnsRuntimeAndCleanup:true');
});
