//201 INERT owned-context extension. Import performs no process/network/DB work.
//The caller owns the existing cluster and MUST stop it in its outer finally.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {assertLifecycleSandbox,lifecycleJson as json} from './merchant-attendance-lifecycle-native-support.mjs';
import {createOperationalCycleNativeProtection,assertAttendanceNativeCatalogEqual} from './merchant-attendance-cycle-native.mjs';
import {reminderSqlSha,reminderInstallationManifest,reminderInstallationGuard} from './merchant-attendance-reminder-installation.mjs';

export const reminderNativeMigration='202610080201_merchant_attendance_reminders.sql';
export const reminderNativeSha=reminderSqlSha.toUpperCase();
export const reminderNativePrerequisites=Object.freeze([
 Object.freeze({version:202610080193,name:'merchant_attendance_operational_punch'}),
 Object.freeze({version:202610080195,name:'merchant_attendance_administrative_closure'}),
 Object.freeze({version:202610080198,name:'merchant_attendance_review_routing'}),
 Object.freeze({version:202610080200,name:'merchant_attendance_operational_cycle'}),
]);
export const reminderNativeBudget=Object.freeze({groups:8,sql:180,rpc:120,milliseconds:120000,statementMs:10000,maxConnections:3,
 protectionQueries:64,archiveCallbacks:8,pidRaces:2,pidPollsPerRace:34,pidPollIntervalMs:75,pidPollDeadlineMs:2500,
 actualWaits:1,actualWaitMilliseconds:60000,newClusters:0,newDatabases:0,browser:0,realAuth:0,kdf:0,production:0});

//The audited generic owned protection transport is reused, not its200 cases.
//All its SQL dispatches remain separately visible under protectionQueries.
export function createReminderNativeProtection(ctx){return createOperationalCycleNativeProtection(ctx);}
export function reminderNativeOldCatalogSql(oid){
 assert(Number.isSafeInteger(oid)&&oid>0);
 return `select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relowner,c.relacl,c.relrowsecurity,
   (select jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) from pg_constraint k where k.conrelid=c.oid
    and not exists(select 1 from pg_trigger capture where capture.tgconstraint=k.oid and capture.tgrelid=c.oid
     and k.contype='t' and c.relnamespace=${oid}
     and ((c.relname='merchant_attendance_cycle_operations' and capture.tgtype=5)
      or (c.relname='merchant_attendance_review_responsibility_heads' and capture.tgtype=21))
     and capture.tgname='reminder_capture' and capture.tgfoid=to_regprocedure(format('%I.faolla_attendance_reminder_capture_v1()',
      (select nspname from pg_namespace where oid=${oid})))
     and not capture.tgisinternal and capture.tgenabled='O' and capture.tgnargs=0 and capture.tgqual is null
     and capture.tgdeferrable and capture.tginitdeferred and capture.tgparentid=0)),
  (select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal
   and not(t.tgname='reminder_capture' and c.relname in('merchant_attendance_operational_punch_sessions','merchant_attendance_review_responsibility_heads','merchant_attendance_cycle_operations')))) order by c.oid)
  from pg_class c where c.relnamespace=${oid} and c.relkind in('r','p') and c.relname not like 'merchant_attendance_reminder_%';`;
}

export async function installAndVerifyRemindersNative(ctx,options={}){
 assert(options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='businessCases'),'reminder_native_options_invalid');
 const {businessCases='run'}=options;assert(['run','skip'].includes(businessCases),'reminder_native_business_cases_invalid');
 const audit=createReminderNativeProtection(ctx),{d,native}=ctx;
 assert.deepEqual(assertLifecycleSandbox(sql=>audit.run('reminder_owned_schema',sql)),d.owned);
 const body=readFileSync(path.join(native.root,'scripts/supabase-migrations',reminderNativeMigration),'utf8');
 assert.equal(createHash('sha256').update(body).digest('hex').toUpperCase(),reminderNativeSha,'reminder201_frozen_SQL');
 const manifest=reminderInstallationManifest(native.root,body.replaceAll('\r\n','\n'));
 assert.deepEqual(JSON.parse(audit.run('reminder_prerequisite_registry',`select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name) order by version),'[]')
  from public.faolla_schema_migrations where version in(202610080193,202610080195,202610080198,202610080200);`)),reminderNativePrerequisites);
 //One complete exact preflight. A missing dependency stops here; no guessed
 //prerequisite installation, historical matrix, or source-pin relaxation.
 audit.run('reminder_exact_preflight',reminderInstallationGuard(manifest,'reminder_native_exact_preflight')+'select 1;');
 const oldTables=audit.inventory().filter(n=>n!=='faolla_schema_migrations'),oldFacts=audit.fingerprint(oldTables);
 const archive155=await audit.archiveBytes('155'),archive207=await audit.archiveBytes('207');
 const oids=audit.run('reminder_old_function_oids',`select array_agg(oid order by oid)::text from pg_proc where pronamespace=${d.owned.oid} and prokind='f';`);
 const replaced=audit.run('reminder_one_forward_oid',`select array_agg(to_regprocedure('public.'||(r->>'name')||'('||(r->>'types')||')')::oid)::text from jsonb_array_elements(${json(manifest.forward)}) r;`);
 const functions=audit.functions(oids,replaced),metadata=audit.metadata(replaced);assert.equal(JSON.parse(metadata).length,1);
 const oldCatalog=audit.run('reminder_old_catalog',reminderNativeOldCatalogSql(d.owned.oid));
 audit.install(body);
 assert.equal(audit.fingerprint(oldTables),oldFacts);assert.equal(audit.functions(oids,replaced),functions);assert.equal(audit.metadata(replaced),metadata);
 assertAttendanceNativeCatalogEqual(audit.run('reminder_old_catalog_after',reminderNativeOldCatalogSql(d.owned.oid)),oldCatalog,'reminder201_after_install_old_catalog');
 const names=audit.inventory();assert.deepEqual(names.filter(n=>n!=='faolla_schema_migrations'&&!oldTables.includes(n)).sort(),manifest.tables.map(t=>t.name).sort());
 const installed=audit.fingerprint(names),definitions=audit.definitions(),catalog=audit.catalog();
 audit.install(body);assert.equal(audit.fingerprint(names),installed);assert.equal(audit.definitions(),definitions);assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'reminder201_reentry_catalog');
 native.pass('201 install/reentry: five private tables, twenty functions, three atomic source triggers, one exact activation forward; old facts/OID/ACL retained');
 let acceptance=null;
 try{
  if(businessCases==='run')acceptance=await(await import('./fixtures/attendance-reminders-native.mjs')).verifyRemindersNative({...ctx,reminderAudit:audit});
  else assert.equal(audit.fingerprint(names),installed,'reminder_skip_installed_facts_changed');
 }
 finally{
  assert.equal(audit.definitions(),definitions);assertAttendanceNativeCatalogEqual(audit.catalog(),catalog,'reminder201_final_catalog');assert.equal(audit.functions(oids,replaced),functions);assert.equal(audit.metadata(replaced),metadata);
  assertAttendanceNativeCatalogEqual(audit.run('reminder_final_old_catalog',reminderNativeOldCatalogSql(d.owned.oid)),oldCatalog,'reminder201_final_old_catalog');
  assert.deepEqual(await audit.archiveBytes('155'),archive155);assert.deepEqual(await audit.archiveBytes('207'),archive207);
 }
 if(businessCases==='run'){assert.equal(acceptance.groups.length,8);assert(acceptance.sqlSteps<=180&&acceptance.rpcCalls<=120);assert.equal(acceptance.oldFactsUnchanged,true);}
 return {phase:201,acceptance,businessCasesExecuted:businessCases==='run',protection:audit.summary(),installAndReentry:true,newTables:5,newFunctions:20,sourceTriggers:3,approvedOldBodies:1,
  oldFactsUnchanged:true,oldArchivesUnchanged:true,newCluster:false,browser:false,realAuth:false,kdf:false,productionAccess:false,deployed:false,
  cleanupOwnedByParent:true,clusterStopConfirmedByParent:false};
}
