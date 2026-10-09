import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {attendanceRecoveryBudgets as budgets,attendanceRecoveryTargetIdentity,attendanceRecoveryResourceGuard,
 attendanceRecoveryDependencySql,attendanceRecoveryWithoutComments,attendanceRecoveryDependencyReport,runAttendanceRecoveryNative} from './merchant-attendance-recovery-native.mjs';

test('recovery requires additional explicit synthetic target/dump approval before local startup',async()=>{
 await assert.rejects(()=>runAttendanceRecoveryNative(['--run-local','--directory','C:/synthetic']),/recovery_explicit/);
 for(const extension of [{phase:999,prepare:()=>{}},{phase:226,prepare:null},{phase:226,prepare:()=>{},extra:true}])
  await assert.rejects(()=>runAttendanceRecoveryNative([],extension),/recovery_extension_invalid/);
});
test('recovery cleanup requires independent exact target database OID owner marker and name',()=>{
 const owned={oid:1000,name:`faolla_attendance_restore_${'a'.repeat(32)}`,owner:'postgres',marker:'faolla-synthetic-restore:00000000-0000-4000-8000-000000000001'};
 assert.deepEqual(attendanceRecoveryTargetIdentity(owned,{...owned}),owned);
 for(const patch of [{oid:1001},{owner:'user'},{marker:owned.marker.slice(0,-1)+'2'},{name:'faolla_attendance_foundation_test'},{oid:0},{marker:'faolla-synthetic-concurrency:00000000-0000-4000-8000-000000000001'}])
  assert.throws(()=>attendanceRecoveryTargetIdentity({...owned,...patch},owned));
});
test('recovery resource caps fail closed before creating and during dump/restore',()=>{
 attendanceRecoveryResourceGuard({free:budgets.diskReserve+budgets.clusterGrowth,initial:true});
 attendanceRecoveryResourceGuard({free:budgets.diskReserve,source:budgets.source,target:budgets.target,dump:budgets.dump,growth:budgets.clusterGrowth});
 for(const input of [{free:budgets.diskReserve-1},{free:budgets.diskReserve,initial:true},{source:budgets.source+1},{target:budgets.target+1},{dump:budgets.dump+1},{growth:budgets.clusterGrowth+1},{source:-1},{free:NaN}])
  assert.throws(()=>attendanceRecoveryResourceGuard({free:budgets.diskReserve+budgets.clusterGrowth,...input}));
});
test('recovery only generates fixed own-schema dependency inspection',()=>{
 const sql=attendanceRecoveryDependencySql(`attendance_race_${'1'.repeat(32)}`);
 for(const x of ['pg_constraint','pg_trigger','pg_attrdef','pg_policy','pg_rewrite','pg_identify_object','textCandidates'])assert(sql.includes(x));
 for(const schema of ['public','auth','attendance_race_bad',"x';drop database postgres;"])assert.throws(()=>attendanceRecoveryDependencySql(schema));
});
test('dependency inspection distinguishes135 request-auth comment from real or dynamic qualified references',()=>{
 const inspect=body=>attendanceRecoveryDependencyReport({external:[],textCandidates:[{name:'fixture',body}]}).textReferences;
 assert.deepEqual(inspect("-- module pause, the historical author, and the original clock's request auth.\n perform true;"),[]);
 assert.deepEqual(inspect('/* auth.users /* public.rows */ still comment */ select 1;'),[]);
 for(const sql of ['select auth.users;','select "auth" . "users";','select auth.\nusers;',"execute 'select * from auth.users';","execute $$select * from auth.users$$;","select 'not -- a comment',public.rows;","select 'escaped '' quote',auth.users;"])
  assert.deepEqual(inspect(sql),['fixture'],sql);
 for(const sql of ['/* no end',"select 'no end",'select $body$no end'])assert.throws(()=>attendanceRecoveryWithoutComments(sql));
});
test('recovery runner preserves original schema and globals; bounded owned cleanup without force',()=>{
 const src=readFileSync(new URL('./merchant-attendance-recovery-native.mjs',import.meta.url),'utf8');
 for(const token of ["'--format=custom'","'--strict-names'",'--schema=${scope.schema}',"'--single-transaction'","'--exit-on-error'",'same(before,profile(config.database))','attendanceRecoveryTargetIdentity(targetIdentity(),owned)','sourceRoles','recovery_empty_target_required','recovery_source_not_quiescent','dumpIdentity','rmdirSync(artifactDirectory)'])assert(src.includes(token),token);
 assert(!/pg_dumpall|--clean|--create|--no-owner|--no-acl|with\s*\(force\)|rmSync\(|initdb\s*\(/i.test(src));
 assert(!src.includes('create-production-database-backup'));
 assert(!/(?:owned|provisional)\s*=\s*targetIdentity\(/.test(src),'failed identity reads must not become cleanup authority');
 assert(src.includes('attendanceRecoveryTargetIdentity(targetIdentity(),{...provisional,marker})'));
 assert(src.includes("path.join(directory,'data','base',String(provisional.oid))"));
 assert(src.includes('recovery_default_tablespace_required'));
 for(const token of ['await extension.prepare(ctx)','recovery_extended_roster_incomplete','await added.verifyRestored','same(before,profile(target))'])assert(src.includes(token));
});
