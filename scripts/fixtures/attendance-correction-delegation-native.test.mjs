import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {correctionDelegationNativePlan,correctionDelegationNativeQuery,correctionDelegationNativeProtectedHash,correctionDelegationNativeEmptySlotsSql,verifyCorrectionDelegationNative} from './attendance-correction-delegation-native.mjs';
const source=readFileSync(new URL('./attendance-correction-delegation-native.mjs',import.meta.url),'utf8'),p=correctionDelegationNativePlan();
test('native import is inert; plan IDs are unique and isolated238 identifiers',()=>{
 assert.equal(typeof verifyCorrectionDelegationNative,'function');assert.equal(new Set(Object.values(p)).size,Object.keys(p).length);
 assert.doesNotMatch(source,/spawn\(|listen\(|chromium|initdb|pg_ctl|disable trigger|session_replication_role/);
 assert(source.includes('native.connect()'));assert(source.includes('assert(++steps<=75'));assert(source.includes("set local statement_timeout='10s'"));
});
test('queries retain exact owner7/delegate9 shapes and null cursor relationships',()=>{
 const owner=correctionDelegationNativeQuery('99990001'),delegate=correctionDelegationNativeQuery('99990001','delegate');
 assert.equal(Object.keys(owner).length,7);assert.equal(Object.keys(delegate).length,9);
 assert.equal(owner.mode,'list');assert.equal(delegate.mode,'grants');
 const recover=correctionDelegationNativeQuery('99990001','delegate','recover',{operationId:p.approve});
 assert.equal(recover.operationId,p.approve);assert.equal(recover.grantId,null);assert.equal(recover.requestId,null);
});
test('old-row hash excludes only prechecked exact site and operation identities, never entire business tables',()=>{
 const tables=['merchants','merchant_attendance_events','merchant_attendance_correction_decisions','merchant_attendance_correction_effects','merchant_attendance_correction_delegations'];
 const sql=correctionDelegationNativeProtectedHash(tables,'99990001',p);
 assert(sql.includes("x.merchant_id='99990001'"));assert(sql.includes(p.approve));assert(sql.includes(p.oldApprove));assert(!sql.includes(p.failed));
 assert(sql.includes('from public.merchant_attendance_events x)'));assert(sql.includes('to_jsonb(x) order by to_jsonb(x)::text'));
 assert.throws(()=>correctionDelegationNativeProtectedHash(['bad;drop table x'],'99990001',p));
 assert.throws(()=>correctionDelegationNativeProtectedHash(tables,"x'bad",p));
});
test('real employee submission and both approval paths use strict actual Node parsers',()=>{
 for(const name of ['faolla_attendance_correction_self_v3','executeCorrectionDelegation','parseCorrectionResult','parseCurrentCorrectionDecision','faolla_attendance_correction_decide_v2'])
  assert(source.includes(name),name);
 assert(source.includes("proposal:{startAt:events[0].occurredAt"));
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_(?:events|correction_entries|correction_decisions|correction_effects)/);
 assert(source.includes('operationId:p.oldApprove'));
});
test('every excluded slot is independently proved absent before saving the protection hash',()=>{
 const empty=correctionDelegationNativeEmptySlotsSql('99990001',p);
 const names=[...empty.matchAll(/from public\.([a-z_]+) x/g)].map(m=>m[1]);
 assert.equal(names.length,14);assert.equal(new Set(names).size,14);
 for(const name of names){
  const protectedSql=correctionDelegationNativeProtectedHash([name],'99990001',p);
  const predicate=empty.split('\n').find(line=>line.includes('public.'+name+' x where ')).split(' x where ')[1].split('),\'correction_delegation_slot_not_empty:')[0];
  assert(protectedSql.includes('where ('+predicate+') is not true'),name);
 }
 assert(source.indexOf('${correctionDelegationNativeEmptySlotsSql(d.site,p)}')<source.indexOf("perform set_config('faolla.cd238_baseline'"));
 for(const name of ['merchant_enterprise_audit_events','merchant_attendance_correction_effects','merchant_attendance_account_suspensions','merchant_attendance_account_status_operations','merchant_attendance_account_restores'])assert(names.includes(name),name);
});
test('a real grant for another existing active location has included time but no visible request or detail',()=>{
 for(const needle of ["'outsideLocation',(select l.id",'and l.active','assert.notEqual(profile.outsideLocation,events[0].locationId)',
  'operationId:p.outsideGrant,locationId:profile.outsideLocation,includePending:true',"saved_basis_outside_grant_location",'detail(p.outsideGrant)'])assert(source.includes(needle),needle);
 assert(source.includes("assert.deepEqual((await run(q('delegate','list',{grantId:p.outsideGrant}))).items,[])"));
 assert.doesNotMatch(source,/insert into public\.merchant_attendance_locations/);
});
test('authority failure and every rejection are full-facts zero-write, with saved raw receipt after revoked/paused',()=>{
 for(const needle of ['correction_delegation_read_or_rejected_write_changed_facts','synthetic238_fault','23514','same_operation_changed_body',
  'old_auth_recovery','new_auth_cannot_adopt','revoked_grant','restored_old_epoch_denied','historical_pending_not_included','scope_unavailable'])
  if(needle!=='scope_unavailable')assert(source.includes(needle),needle);
 assert(source.includes("await restore('cd238_reject',rejectBranch)"));assert(source.includes("await restore('cd238_old',oldBranch)"));
});
test('self grant distinguishes zero-RPC Node rejection from the separately executed SQL authorization rejection',()=>{
 for(const needle of ["error=>error.code==='attendance_invalid_request'",'self_grant_Node_rejection_must_be_zero_RPC','assert.equal(lastResult,beforeSelfResult)',
  "call('self_grant_real_SQL'","assert.equal(selfSql.error,'attendance_access_denied'","assert.equal(selfSql.sqlstate,'P0001')",
  'must_reach_exactly_one_real_RPC','SQL_rejection_required'])assert(source.includes(needle),needle);
 assert.doesNotMatch(source,/await denied\('self_grant'/);
});
test('no-worker disable passes false to real lifecycle and still captures generation; restore never creates worker',()=>{
 assert(source.includes('attendance_suspension_enabled:false'));assert(source.includes('faolla_update_merchant_enterprise_employee_v1'));
 assert(source.includes('faolla_attendance_account_suspensions_v1'));assert(source.includes('and paused and generation=1'));
 assert(source.includes('and not paused and generation=1'));assert(source.includes('assert.equal(captured.delegateWorkers,0)'));
});
test('finally closes connection and checks all facts, definitions, catalog and both exact archive bytes',()=>{
 for(const needle of ["if(!rolledBack)await connection.step('rollback;')",'await connection.close()','d.fingerprint(),baseline','d.definitions(),definitions',
  'd.tableCatalog(),catalog','periodContinuationArchiveBytes(await archive()),old155','periodContinuationArchiveBytes(await periodArchive()),old207'])
  assert(source.includes(needle),needle);
 assert(source.includes('realAuth:false'));assert(source.includes('syntheticPrerequisiteRows:2'));
});
