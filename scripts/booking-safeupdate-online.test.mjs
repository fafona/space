import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {bookingSafeupdateOnlineWorkflow} from './booking-safeupdate-online-workflow.mjs';
import {bookingSafeupdateScope as scope,bookingSafeupdateAllowedFiles,assertBookingSafeupdateSource,
  assertBookingSafeupdateDryRun,assertBookingSafeupdateState,bookingSafeupdateRollbackSql,bookingSafeupdateOldRegistry} from './booking-safeupdate-online.mjs';
import {attendanceProductionIdentity as identity} from './attendance-production-database-migrations.mjs';
import {BOOKING_RELEASE_BASELINE,BOOKING_APPLICATION_FILES,BOOKING_TOOL_FILES,assertBookingReleaseClosure} from './booking-publication-policy.mjs';
import {readReviewedApplicationFixture} from './test-support/reviewed-application-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const generic=read('.github/workflows/database-migrate.yml');
const actual=read('.github/workflows/booking-safeupdate-online.yml');
const require=createRequire(import.meta.url);
const yaml=require('js-yaml');

test('separate online workflow preserves every existing gate except the explicitly approved maintenance admission',()=>{
  assert.equal(actual,bookingSafeupdateOnlineWorkflow(generic).trimEnd()+'\n');
  const old=yaml.load(generic),online=yaml.load(actual);
  assert.ok(old.on.workflow_dispatch.inputs.maintenance_window_confirmed);
  assert.ok(generic.includes('test "$MAINTENANCE_WINDOW_CONFIRMED" = "true"'));
  assert.deepEqual(Object.keys(online.on.workflow_dispatch.inputs).sort(),['backup_run_id','confirmation','expected_live_app_sha','target_sha']);
  assert.deepEqual(online.concurrency,old.concurrency);
  assert.equal(online.jobs.migrate.env.MAINTENANCE_MODE,'off');
  assert.equal(online.jobs.migrate.env.THROUGH_VERSION,scope.version);
  assert.equal(online.jobs.migrate.env.FORWARD_REPAIR_CONFIRMED,'false');
  for(const step of online.jobs.migrate.steps)if(step.run)assert.ok(step.run.length<=21000,'run step exceeds GitHub limit: '+step.name);
  for(const guard of ['Verify Recursive Backup Attestation Chain','Revalidate Evidence And Apply Exact Through','Verify Signed Backup Maintenance Binding','Verify Expected Live Application Build Exactly','Verify Expected Live Application Build Remains Exact','Setup Pinned SSH Host Trust'])
    assert.ok(actual.includes('- name: '+guard));
  assert.ok(actual.includes('test "$EXPECTED_LIVE_APP_SHA" = "'+scope.live+'"'));
  assert.ok(actual.includes('booking-safeupdate-online.mjs dry-run "$dry_report_path"'));
  assert.ok(actual.includes('booking-safeupdate-online.mjs plan > "$dry_report_path"'));
  assert.ok(actual.includes('booking-safeupdate-online.mjs apply "$FAOLLA_REPORT_DIR" > "$apply_report_path"'));
  assert.ok(actual.includes('booking-safeupdate-online.mjs prepare "$FAOLLA_REPORT_DIR" >&2'));
  assert.ok(actual.includes('booking-safeupdate-online.mjs verify "$FAOLLA_REPORT_DIR" >&2'));
});

test('workflow construction refuses a changed old admission rather than dropping unreviewed checks',()=>{
  assert.throws(()=>bookingSafeupdateOnlineWorkflow(generic.replace('test "$MAINTENANCE_WINDOW_CONFIRMED" = "true"','changed_guard')),/workflow template changed/);
});

test('all retained shell steps parse before any publication is attempted',()=>{
  const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'bash';
  for(const step of yaml.load(actual).jobs.migrate.steps){
    if(!step.run)continue;
    const r=spawnSync(bash,['-n'],{input:step.run,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.ifError(r.error);assert.equal(r.status,0,step.name+': '+r.stderr);
  }
});

test('only exact approved migration bytes are accepted and application files are outside the allowed diff',()=>{
  const bytes=readFileSync(path.join(root,'scripts/supabase-migrations',scope.fileName));
  assert.doesNotThrow(()=>assertBookingSafeupdateSource(bytes));
  assert.throws(()=>assertBookingSafeupdateSource(Buffer.concat([bytes,Buffer.from('-- extra SQL\n')])));
  assert.equal(bookingSafeupdateAllowedFiles.length,9);
  assert.ok(bookingSafeupdateAllowedFiles.every(f=>!f.startsWith('src/')&&!f.endsWith('database-migrate.yml')));
});

test('historical fixture matches its original approved pin while the old lane still rejects the new package',()=>{
  const sealed=JSON.parse(read('scripts/test-support/booking-ci-source-base.json'));
  const readBlob=file=>file==='.github/workflows/ci.yml'?sealed.workflow:readReviewedApplicationFixture(file);
  const input={baseline:BOOKING_RELEASE_BASELINE,files:[...BOOKING_APPLICATION_FILES,...BOOKING_TOOL_FILES],readBlob};
  assert.match(assertBookingReleaseClosure(input),/^[a-f0-9]{64}$/);
  for(const changed of ['package.json','scripts/booking-atomic-postgres-acceptance.mjs'])
    assert.throws(()=>assertBookingReleaseClosure({...input,readBlob:file=>file===changed?read(changed):readBlob(file)}),/application_content_rejected/);
});

function dry(){return {ok:true,mode:'dry_run',status:'dry_run',databaseContainer:identity.containerName,
  through:scope.version,effectiveThrough:scope.version,pending:[{version:scope.version,name:scope.name,fileName:scope.fileName}],
  lane:'booking_safeupdate_online',executed:[],registeredVersions:bookingSafeupdateOldRegistry().map(r=>r.version)};}
test('dry-run rejects other pending migrations, a replay, unknown container or wrong boundary',()=>{
  assert.doesNotThrow(()=>assertBookingSafeupdateDryRun(dry()));
  for(const mutate of [v=>v.pending.push({version:'202610250212'}),v=>v.pending.splice(0),v=>v.executed.push({}),
    v=>v.databaseContainer='pilot',v=>v.through='202611050214',v=>v.registeredVersions.pop(),v=>v.ok=false]){
    const v=dry();mutate(v);assert.throws(()=>assertBookingSafeupdateDryRun(v));
  }
});

function state(){return {actor:'supabase_admin',database:identity.databaseName,oid:identity.databaseOid,
  systemIdentifier:identity.systemIdentifier,serverVersionNum:identity.serverVersionNum,
  control:{singleton:true,active:true,protocol:2,generation:'synthetic',revision:0},
  function:{oid:111377,owner:'supabase_admin',acl:['supabase_admin=X/supabase_admin','service_role=X/supabase_admin'],config:['search_path=pg_catalog, public'],definer:true,bodyMd5:scope.before},
  access:{anon:false,authenticated:false,service:true},registry:bookingSafeupdateOldRegistry()};}
test('online preflight binds the production database, active generation and exact private function',()=>{
  assert.doesNotThrow(()=>assertBookingSafeupdateState(state(),'before'));
  for(const mutate of [s=>s.database='pilot',s=>s.oid='6',s=>s.systemIdentifier='other',s=>s.actor='postgres',
    s=>s.control.active=false,s=>s.control.protocol=1,s=>s.function.owner='other',s=>s.function.definer=false,
    s=>s.function.config.push('search_path=public'),s=>s.function.bodyMd5='other',s=>s.access.anon=true,s=>s.registry.pop()]){
    const s=state();mutate(s);assert.throws(()=>assertBookingSafeupdateState(s,'before'));
  }
});

test('postflight permits legitimate concurrent booking revisions but forbids ACL, generation or old registry changes',()=>{
  const before=state();const after=structuredClone(before);
  after.function.bodyMd5=scope.after;after.registry.push({version:scope.version,name:scope.name});
  after.control.revision=7;
  assert.doesNotThrow(()=>assertBookingSafeupdateState(after,'after',before));
  for(const mutate of [s=>s.function.oid++,s=>s.function.acl.push('anon=X/supabase_admin'),
    s=>s.control.generation='changed',s=>s.registry[0].name='changed']){
    const s=structuredClone(after);mutate(s);assert.throws(()=>assertBookingSafeupdateState(s,'after',before));
  }
});

test('rollback is pinned to the original function, serializes with migrations and never deletes the applied registry',()=>{
  const old=read('scripts/supabase-migrations/202610250212_booking_atomic_runtime.sql').match(/create or replace function public\.faolla_booking_atomic_commit_v1\([\s\S]*?\$commit_booking\$;/)[0];
  const sql=bookingSafeupdateRollbackSql(old);
  assert.ok(sql.includes('pg_advisory_xact_lock(20260731,1)'));
  assert.ok(sql.includes(scope.after));
  assert.ok(sql.includes('where singleton and active and protocol=2 for update'));
  assert.doesNotMatch(sql,/delete\s+from|truncate|alter\s+(?:role|system)|safeupdate\.enabled/i);
  assert.throws(()=>bookingSafeupdateRollbackSql(old.replace('revision = revision + 1','revision = revision + 2')));
});

test('online SQL checks original booking data, control and ACLs inside the same bounded transaction',()=>{
  const sql=read('scripts/supabase-migrations/'+scope.fileName);
  for(const part of ["lock_timeout = '2s'","statement_timeout = '10s'",'where singleton for update',
    'faolla_booking_safeupdate_before','booking_atomic_safeupdate_postcondition_failed','pages_md5','metadata'])assert.ok(sql.includes(part));
  assert.ok(sql.indexOf('where singleton for update')<sql.indexOf('create or replace function'));
  assert.ok(sql.indexOf('$unchanged$;')<sql.indexOf('insert into public.faolla_schema_migrations'));
});
