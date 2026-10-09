import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createAttendanceRecoverySecurityPlan,attendanceRecoverySecuritySite,attendanceRecoverySecurityProtectedSql,
 attendanceRecoverySecurityProbeSql,runAttendanceRecoverySecurityProbe,prepareAttendanceRecoverySecurity,attendanceRecoverySecurityProbeCounts,
 attendanceRecoverySecurityFactsSql} from './attendance-recovery-security-native.mjs';
import {outageNativeFingerprintSql} from './attendance-outage-native.mjs';
const require=createRequire(import.meta.url),schema='attendance_race_0123456789abcdef0123456789abcdef';
const names=['merchants','faolla_schema_migrations','merchant_attendance_account_epochs'];
const plan=()=>createAttendanceRecoverySecurityPlan({owner:'00000000-0000-4000-8000-000000000099',now:'2026-10-07T10:00:00.123456Z'});
const source=readFileSync(new URL('./attendance-recovery-security-native.mjs',import.meta.url),'utf8');

test('new security tenant and identity roles are deterministic, separate and bounded',()=>{
 const p=plan();assert.equal(p.site,attendanceRecoverySecuritySite);assert.equal(p.site,'99990226');
 assert.notEqual(p.target.worker,p.paused.worker);assert.notEqual(p.delegate.employee,p.target.employee);assert.notEqual(p.delegate.auth,p.target.auth);
 const ids=[p.location,p.role,p.delegateRole,p.target.employee,p.target.auth,p.target.worker,p.paused.employee,p.paused.auth,p.paused.worker,p.delegate.employee,p.delegate.auth,
  ...p.terminals.map(t=>t.id),...p.pinOperations,...p.statusOperations,p.lease,...Object.values(p.grants).map(c=>c.operationId),...Object.values(p.revokes).map(c=>c.operationId)];
 assert.equal(new Set(ids).size,ids.length);for(const value of ids)assert.match(value,/^00000000-0000-4000-8000-000226800[0-9]{3}$/);
 assert.notEqual(p.terminals[0].deviceHash,p.terminals[1].deviceHash);assert.notEqual(p.terminals[0].pairHash,p.terminals[0].deviceHash);
 assert.equal(Date.parse(p.grants.missing.validUntil)-Date.parse(p.grants.missing.validFrom),86460000);
 assert.deepEqual(p,plan());
});

test('all three grant/revoke intents pass actual existing strict command parsers',()=>{
 const p=plan(),parsers={missing:require('../../src/lib/merchantAttendanceMissingDelegation.ts').parseMissingDelegationCommand,
  application:require('../../src/lib/merchantAttendanceApplicationDelegation.ts').parseApplicationDelegationCommand,
  schedule:require('../../src/lib/merchantAttendanceScheduleDelegation.ts').parseScheduleDelegationCommand};
 for(const kind of Object.keys(parsers)){
  assert.deepEqual(parsers[kind](p.grants[kind]),p.grants[kind]);assert.deepEqual(parsers[kind](p.revokes[kind]),p.revokes[kind]);
  assert.equal(p.revokes[kind].grantId,p.grants[kind].operationId);assert.equal(p.revokes[kind].expectedRevision,1);
 }
});

test('invalid identity/time plans cannot reach preparation',async()=>{
 for(const owner of ['x',null])assert.throws(()=>createAttendanceRecoverySecurityPlan({owner,now:'2026-10-07T00:00:00.000000Z'}));
 for(const now of ['invalid','2026-10-07','2026-10-07T00:00:00.000Z',null])assert.throws(()=>createAttendanceRecoverySecurityPlan({owner:plan().owner,now}));
 await assert.rejects(()=>prepareAttendanceRecoverySecurity({d:{syntheticOnly:false}}));
});

test('old-row guard excludes only dedicated new tenant rows, not whole changed tables',()=>{
 const s=attendanceRecoverySecurityProtectedSql(names);
 assert(s.includes("to_jsonb(r)->>'id' is distinct from '99990226'"));
 assert(s.includes("to_jsonb(r)->>'merchant_id' is distinct from '99990226'"));
 for(const name of names)assert(s.includes('from public.'+name));
 for(const bad of [[],['merchants','merchants'],['merchants;drop table x'],['auth.users']])assert.throws(()=>attendanceRecoverySecurityProtectedSql(bad));
});

test('security probes use service-role RPC within guarded rollback and never bypass triggers',()=>{
 const s=attendanceRecoverySecurityProbeSql({schema,names,expression:"jsonb_build_object('denied',true)"});
 for(const value of ["current_user='postgres'",'security226_namespace_required','security226_scope_required','set local role service_role','exception when others','returned_sqlstate','rollback;'])assert(s.includes(value));
 assert.match(s,/set local statement_timeout='15s'/);assert.match(s,/set local lock_timeout='3s'/);
 assert.doesNotMatch(s,/disable trigger|session_replication_role|commit;/i);
 assert.throws(()=>attendanceRecoverySecurityProbeSql({schema:'public',names,expression:'null'}));
 assert.throws(()=>attendanceRecoverySecurityProbeSql({schema,names,expression:'a'.repeat(32768)}));
});

test('rollback comparison detects changed facts even if returned denial is expected',async()=>{
 const before='a'.repeat(32),config={schema,names,expression:'null'},calls=[];
 const packet={before,value:{denied:true},error:null,sqlState:null};
 const exec=sql=>{calls.push(sql);return calls.length===1?JSON.stringify(packet):before;};
 assert.deepEqual(await runAttendanceRecoverySecurityProbe(exec,config),packet);assert.equal(calls.length,2);
 assert.match(calls[1],/select \(select md5/);assert(calls[1].endsWith('rollback;'));
 let n=0;await assert.rejects(()=>runAttendanceRecoverySecurityProbe(()=>++n===1?JSON.stringify(packet):'b'.repeat(32),config),/security226_probe_rollback_all_facts/);
});

test('probe exception packet remains exact; driver must distinguish real codes from transport failure',async()=>{
 const config={schema,names,expression:'null'},before='a'.repeat(32),packet={before,value:null,error:'attendance_access_denied',sqlState:'P0001'};
 let n=0;assert.deepEqual(await runAttendanceRecoverySecurityProbe(()=>++n===1?JSON.stringify(packet):before,config),packet);
 for(const bad of [{...packet,extra:true},{...packet,before:'bad'},{...packet,error:null}]){
  n=0;await assert.rejects(()=>runAttendanceRecoverySecurityProbe(()=>++n===1?JSON.stringify(bad):before,config));
 }
});

test('fixture prepares real credential/revocation/status RPCs; direct seed is limited to identity prerequisites',()=>{
 for(const rpc of ['faolla_attendance_admin_v1','faolla_attendance_terminal_admin_v1','faolla_attendance_terminal_device_v1','faolla_attendance_pin_admin_v1',
  'faolla_attendance_pin_begin_v1','faolla_update_merchant_enterprise_employee_v1','faolla_attendance_account_suspensions_v1','faolla_attendance_self_v1'])assert(source.includes(rpc));
 const tables=[...source.matchAll(/insert into public\.([a-z_]+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,['merchants','merchant_enterprise_roles','merchant_enterprise_employees']);
 assert.match(source,/await deriveAttendancePin\(/);assert.match(source,/attendance_suspension_enabled:true/);
 assert.match(source,/assert\.equal\(epoch\.generation,1\)/);assert.match(source,/assert\.equal\(epoch\.paused,true\)/);
 assert.doesNotMatch(source,/process\.env|disable trigger|create database|pg_ctl|pg_restore|execFile|listen\(/i);
});

test('revoked PIN is tested via active separate terminal and every public result uses existing parsers',()=>{
 assert.match(source,/p\.terminals\[0\]\.id/);assert.match(source,/revoked_terminal_device/);
 assert.match(source,/pinPositive\.value,\{workerId:p\.target\.worker,employeeId:p\.target\.employee,revision:1\}/);
 for(const name of ['parsePinStatus','parseTerminalList','parseTerminalDevice','parseAccountSuspensionResult','parseMissingDelegationResult','parseApplicationDelegationResult','parseScheduleDelegationResult'])assert(source.includes(name));
 assert.match(source,/assert\.deepEqual\(parsed\.receipt,savedDelegations\[kind\]\[command\.action\]\)/);
 assert.match(source,/pinRateCountersMayChangeInsideRollback:true/);
 assert.match(source,/actualInvitationOrAuthentication:false/);assert.match(source,/httpOrBrowserFlowsTested:false/);
});

test('original replay and gate-closed recovery are separate and no reset/restore can resurrect authority',()=>{
 assert.match(source,/mode==='replay'&&command\.action==='grant'&&kind!=='schedule'/);
 assert.match(source,/_grant_replay_gate_closed/);assert.match(source,/mode==='recover'\?delegationQuery/);
 assert.match(source,/assert\.equal\(parsed\.enabled,false\)/);assert.match(source,/assert\.equal\(parsed\.detail\.status,'revoked'\)/);
 assert.match(source,/assert\.equal\(parsed\.items\[0\]\.state,'revoked'\)/);
 assert.match(source,/attendance_suspension_enabled:false/);
 assert.doesNotMatch(source,/action:'restore'|action:'approve'|action:'publish'|action:'clock_in'/);
 assert.match(source,/assert\.equal\(await targetFacts\(\),allFacts\)/);
 assert.match(source,/assert\.equal\(d\.definitions\(\),definitions\)/);assert.match(source,/assert\.equal\(d\.tableCatalog\(\),catalog\)/);
});

test('probe case counts distinguish both rollback transactions and target boundary fingerprints',()=>{
 assert.deepEqual(attendanceRecoverySecurityProbeCounts(33),{sourceProbeCases:34,targetProbeCases:33,sourceProbeTransactions:69,targetProbeTransactions:68,
  transactionCountsExcludeSetupAndCatalogReads:true});
 assert.equal(attendanceRecoverySecurityProbeCounts(1).sourceProbeTransactions,5);
 assert.equal(attendanceRecoverySecurityProbeCounts(40).targetProbeTransactions,82);
 for(const n of [0,-1,41,1.5,'33',null])assert.throws(()=>attendanceRecoverySecurityProbeCounts(n));
 assert.match(source,/\.\.\.attendanceRecoverySecurityProbeCounts\(probes\.length\)/);
});

test('every source setup RPC has explicit transaction and actual SQL service-role assertion',()=>{
 assert.match(source,/d\.exec\("begin;set local role service_role;do \$security226_service\$ begin assert current_user='service_role','security226_service_role_required';end;\$security226_service\$;select "\+expression\+';commit;'\)/);
 assert.match(source,/actualInvitationOrAuthentication:false/);
 assert.match(source,/httpOrBrowserFlowsTested:false/);
});

test('source, restored boundaries and every probe use the same full-fact SQL and fixed serialization',async()=>{
 const settings="set local time zone 'UTC';set local datestyle='ISO,YMD';set local extra_float_digits=3;set local bytea_output='hex';set local intervalstyle='postgres';";
 const expected=`begin;reset role;${settings}select ${outageNativeFingerprintSql(names)};rollback;`;
 assert.equal(attendanceRecoverySecurityFactsSql(names),expected);
 const probe=attendanceRecoverySecurityProbeSql({schema,names,expression:'null'});
 assert(probe.startsWith(`begin;reset role;${settings}`));
 assert(probe.includes('before_hash:='+outageNativeFingerprintSql(names)+';'));
 for(const name of names)assert(expected.includes('from public.'+name+' outage_row'));
 assert.doesNotMatch(expected,/where|limit|offset|delete|update|truncate/i);
 const calls=[],digest='d'.repeat(32);
 await runAttendanceRecoverySecurityProbe(sql=>{
  calls.push(sql);return calls.length===1?JSON.stringify({before:digest,value:null,error:null,sqlState:null}):digest;
 },{schema,names,expression:'null'});
 assert.equal(calls[1],expected);
 assert(source.includes('const allFacts=String(d.exec(attendanceRecoverySecurityFactsSql(names))).trim();'));
 assert(source.includes('const targetFacts=async()=>String(await restoredExec(attendanceRecoverySecurityFactsSql(names))).trim();'));
 assert.doesNotMatch(source,/d\.fingerprint\(/);
 for(const bad of [[],['merchants','merchants'],['auth.users']])assert.throws(()=>attendanceRecoverySecurityFactsSql(bad));
});
