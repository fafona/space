// Explicit LOCAL Windows PG17 acceptance. It is not a substitute for the real
// server PG15 rehearsal, and is not auto-discovered by dependency-free tests.
// Uses the already pinned TEMP runtime; never installs into app node_modules.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import net from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {BOOKING_SCOPE} from './booking-publication-policy.mjs';
import {guardedProductionBookingActivationSql,isolatedBookingActivationAcceptanceSql,
  bookingHandoffActivationSnapshotSql,BOOKING_ACTIVATION_BODY_SHA256} from './booking-handoff-activation.mjs';
import {planBookingRuleOptionRepair,isolatedBookingRepairActivationAcceptanceSql} from './booking-handoff-rule-repair.mjs';

assert.equal(process.platform,'win32','this local fixture requires the pinned Windows runtime');
assert.equal(process.argv.length,2,'no database URL, path or role CLI overrides');
const runtime=path.resolve(process.env.FAOLLA_BOOKING_TEST_RUNTIME_DIR||'.missing-runtime'),relative=path.relative(tmpdir(),runtime);
assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(runtime).startsWith('faolla-booking-pg-'));
assert.equal((await realpath(runtime)).toLowerCase(),runtime.toLowerCase());
const requireTest=createRequire(path.join(runtime,'test-loader.cjs')),{Client}=requireTest('pg');
const pgRoot=path.join(runtime,'node_modules/@embedded-postgres/windows-x64');
assert.equal(JSON.parse(await readFile(path.join(pgRoot,'package.json'),'utf8')).version,'17.10.0-beta.17');
assert.equal(JSON.parse(await readFile(path.join(runtime,'node_modules/pg/package.json'),'utf8')).version,'8.23.1');
const binaries=await import(pathToFileURL(path.join(pgRoot,'dist/index.js')).href),exec=promisify(execFile);
const evidence=await mkdtemp(path.join(tmpdir(),'faolla-booking-handoff-pg-')),cluster=path.join(evidence,'cluster');
const database='faolla_booking_activation_'+randomBytes(8).toString('hex'),hash=v=>createHash('sha256').update(v).digest('hex');
let started=false,admin,service,passed=0,completed=false;
const check=async(name,work)=>{await work();passed++;console.log('[booking-handoff-pg] PASS '+name);};
const resultsRows=results=>(Array.isArray(results)?results:[results]).flatMap(r=>r.rows??[]);
const snapshot=async()=>resultsRows(await admin.query(bookingHandoffActivationSnapshotSql)).find(row=>row.snapshot)?.snapshot;
const scalar=async sql=>(await admin.query(sql)).rows[0];
async function rejectTransaction(sql,pattern){await assert.rejects(admin.query(sql),pattern);await admin.query('rollback');}
async function repairAcceptance(config){
  const repairDatabase='faolla_booking_activation_'+randomBytes(8).toString('hex');
  await admin.query('create database '+repairDatabase);const connection=new Client({...config,database:repairDatabase});
  let legacy,observer,advisoryKey;
  try{
    await connection.connect();await connection.query(`set role supabase_admin;
      create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,
        created_at timestamptz default now(),updated_at timestamptz default now());
      create table public.faolla_schema_migrations(version bigint primary key,name text not null);
      insert into public.faolla_schema_migrations select n,'synthetic-registry-'||n from generate_series(1,209) n;
      grant usage on schema public to service_role;grant select,insert,update,delete on public.pages to service_role;
      create function public.set_current_timestamp_updated_at() returns trigger language plpgsql as $$begin new.updated_at=now();return new;end;$$;
      create trigger set_pages_updated_at before update on public.pages for each row execute function public.set_current_timestamp_updated_at();`);
    const records=Array.from({length:17},(_,i)=>({id:'synthetic-'+i,siteId:'12345678',status:'completed',createdAt:'2026-05-01T00:00:00Z'}));
    const entry={viewport:'desktop',blockId:'synthetic-booking',availableTimeRanges:['10:00-11:00'],timeSlotRules:[],blockedDates:[],holidayDates:[],maxBookingsPerSlot:null};
    const rules={version:1,snapshots:{'12345678':{version:1,siteId:'12345678',publishedAt:'2026-05-01T00:00:00Z',
      entries:Array.from({length:3},()=>structuredClone(entry))}}};
    const publicId='00000000-0000-4000-8000-000000000002';
    for(const [tenant,slug,blocks,id]of [
      ['__faolla_booking_persistence__','__merchant_booking_records__:v1',{version:1,records}],
      ['__faolla_booking_persistence__','__merchant_booking_rules__:v1',rules],
      ['__faolla_booking_persistence__','__merchant_booking_rules__:v1:backup',{version:1,snapshots:{}}],
      ['__faolla_booking_persistence__','__merchant_booking_workbench__:v1',{version:1,settingsBySiteId:{}}],
      ['12345678',null,[],publicId],['other-merchant','ordinary-page',[{unrelated:true}]],
    ])await connection.query(`insert into public.pages(id,merchant_id,slug,blocks,created_at,updated_at)
      values(coalesce($1::uuid,gen_random_uuid()),$2,$3,$4::jsonb,'2026-05-01T00:00:00Z','2026-05-01T00:00:00Z')`,[id??null,tenant,slug,JSON.stringify(blocks)]);
    for(const name of ['202610250211_booking_atomic_preparation.sql','202610250212_booking_atomic_runtime.sql']){
      const file='scripts/supabase-migrations/'+name,source=await readFile(new URL('../'+file,import.meta.url),'utf8');
      assert.equal(hash(source.replaceAll('\r\n','\n')),BOOKING_SCOPE.pins[file]);await connection.query(source);
    }
    const rows=async()=>(await connection.query(`select to_jsonb(p) as value,
      encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') as digest from public.pages p order by id`)).rows;
    const initial=await rows(),source=initial.find(r=>r.value.id===publicId),rule=initial.find(r=>r.value.slug==='__merchant_booking_rules__:v1');
    const expected=structuredClone(rules.snapshots['12345678']);for(const e of expected.entries)
      Object.assign(e,{storeOptions:["Store's main",'Branch 2','Branch 3'],itemOptions:['A','B','C','D','E'],titleOptions:['Ms','Mr']});
    const makePlan=(overrides={})=>planBookingRuleOptionRepair({rulesRow:{...rule.value,rowSha256:rule.digest},
      publishedRows:[{...source.value,rowSha256:source.digest,...overrides}],buildSnapshot:()=>structuredClone(expected)});
    const before=resultsRows(await connection.query(bookingHandoffActivationSnapshotSql)).find(r=>r.snapshot).snapshot;
    const plan=makePlan(),sql=(p=plan,b=before)=>isolatedBookingRepairActivationAcceptanceSql({before:b,databaseName:repairDatabase,plan:p,backupSealSha256:'d'.repeat(64)});
    const rejects=async(query,pattern)=>{await assert.rejects(connection.query(query),pattern);await connection.query('rollback');assert.deepEqual(await rows(),initial);};
    await check('repair rejects a changed source page and leaves rules, records and timestamps untouched',async()=>{
      await rejects(sql(makePlan({rowSha256:'0'.repeat(64)})),/booking_rule_repair_published_source_changed/);
    });
    await check('stale saved rows reject before any repair; a later activation failure rolls back the entire repair',async()=>{
      await rejects(sql(plan,{...before,savedBookingRowsSha256:'0'.repeat(64)}),/booking_rule_repair_saved_rows_changed/);
      await rejects(sql(plan,{...before,generation:'00000000-0000-4000-8000-000000000001'}),/booking_activation_snapshot_changed/);
    });
    await check('unexpected trigger changes to other columns or booking records are detected and fully rolled back',async()=>{
      await connection.query(`create function public.synthetic_repair_other_column() returns trigger language plpgsql as $$begin
        if new.slug='__merchant_booking_rules__:v1' then new.created_at=now();end if;return new;end;$$;
        create trigger zzz_synthetic_repair_other_column before update on public.pages for each row execute function public.synthetic_repair_other_column();`);
      await rejects(sql(),/booking_rule_repair_other_fields_changed/);
      await connection.query('drop trigger zzz_synthetic_repair_other_column on public.pages;drop function public.synthetic_repair_other_column()');
      await connection.query(`create function public.synthetic_repair_other_record() returns trigger language plpgsql as $$begin
        if new.slug='__merchant_booking_rules__:v1' then update public.pages set blocks='{}'::jsonb where slug='__merchant_booking_records__:v1';end if;return new;end;$$;
        create trigger synthetic_repair_other_record after update on public.pages for each row execute function public.synthetic_repair_other_record();`);
      await rejects(sql(),/booking_rule_repair_other_saved_rows_changed/);
      await connection.query('drop trigger synthetic_repair_other_record on public.pages;drop function public.synthetic_repair_other_record()');
    });
    legacy=new Client({...config,database:repairDatabase});await legacy.connect();await legacy.query('set role service_role');
    observer=new Client({...config,database:repairDatabase});await observer.connect();
    let queuedLegacyRejected=false;
    await check('repair plus activation preserves all 17 records, original publication time, backup, workbench and unrelated rows',async()=>{
      const handoffPid=(await connection.query('select pg_backend_pid() as pid')).rows[0].pid,
        legacyPid=(await legacy.query('select pg_backend_pid() as pid')).rows[0].pid;
      advisoryKey=randomBytes(4).readInt32BE();await observer.query('select pg_advisory_lock($1::integer)',[advisoryKey]);
      // A real lock barrier, not an assumed sleep: the handoff is paused after
      // its update but before commit, while the old writer is actually queued.
      const handoff=connection.query(sql().replace(/commit;$/,'select pg_advisory_xact_lock('+advisoryKey+');commit;'));
      const waitFor=async(predicate)=>{
        const deadline=Date.now()+5000;
        while(Date.now()<deadline){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
        throw Error('isolated_repair_lock_barrier_timeout');
      };
      await waitFor(async()=>Boolean((await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event='advisory'",[handoffPid])).rowCount));
      const oldWrite=legacy.query("update public.pages set blocks=$1::jsonb where slug='__merchant_booking_rules__:v1'",[JSON.stringify(rules)]).then(()=>({ok:true}),error=>({error}));
      await waitFor(async()=>Boolean((await observer.query("select 1 from pg_locks where pid=$1 and relation='public.pages'::regclass and not granted",[legacyPid])).rowCount));
      await observer.query('select pg_advisory_unlock($1::integer)',[advisoryKey]);advisoryKey=undefined;
      const result=resultsRows(await handoff),oldResult=await oldWrite;
      assert.match(oldResult.error?.message??'',/booking_atomic_legacy_writer_fenced/);queuedLegacyRejected=true;
      const receipt=result.find(r=>r.repair).repair,activation=result.find(r=>r.value).value;
      assert.equal(receipt.planSha256,plan.planSha256);assert.equal(receipt.beforeRowSha256,rule.digest);
      assert.equal(receipt.beforeSavedRowsSha256,before.savedBookingRowsSha256);
      assert.notEqual(receipt.afterSavedRowsSha256,receipt.beforeSavedRowsSha256);
      assert.deepEqual(activation.before,{...before,savedBookingRowsSha256:receipt.afterSavedRowsSha256});
      assert.deepEqual(activation.after,{...activation.before,active:true});
      const after=await rows(),afterRule=after.find(r=>r.value.id===rule.value.id);
      assert.deepEqual(afterRule.value.blocks,plan.next);
      assert.deepEqual({...afterRule.value,blocks:rule.value.blocks,updated_at:rule.value.updated_at},rule.value);
      assert.notEqual(afterRule.value.updated_at,rule.value.updated_at);assert.equal(afterRule.digest,receipt.afterRowSha256);
      assert.deepEqual(after.filter(r=>r.value.id!==rule.value.id),initial.filter(r=>r.value.id!==rule.value.id));
      assert.equal(after.find(r=>r.value.slug==='__merchant_booking_records__:v1').value.blocks.records.length,17);
    });
    await check('an old writer already queued behind the repair transaction is fenced after commit',async()=>{
      assert.equal(queuedLegacyRejected,true);
    });
    await check('after the combined commit a legacy writer cannot replace repaired rules with its stale snapshot',async()=>{
      const after=await rows();await assert.rejects(legacy.query("update public.pages set blocks=$1::jsonb where slug='__merchant_booking_rules__:v1'",[JSON.stringify(rules)]),/booking_atomic_legacy_writer_fenced/);
      assert.deepEqual(await rows(),after);
    });
  }finally{
    if(advisoryKey!==undefined)await observer?.query('select pg_advisory_unlock($1::integer)',[advisoryKey]).catch(()=>{});
    await observer?.end().catch(()=>{});await legacy?.end().catch(()=>{});await connection.end().catch(()=>{});
  }
}
try{
  const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  await exec(binaries.initdb,['-D',cluster,'-U','booking_test_admin','-A','trust','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await exec(binaries.pg_ctl,['-D',cluster,'-l',path.join(evidence,'postgres.log'),'-w','-t','30','-o',
    `-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=12`,'start'],{windowsHide:true,timeout:45000});started=true;
  const config={host:'127.0.0.1',port,user:'booking_test_admin',database:'postgres',connectionTimeoutMillis:5000,
    statement_timeout:25000,query_timeout:30000,application_name:'faolla-booking-handoff-isolated-local'};
  admin=new Client(config);await admin.connect();
  assert.equal(path.resolve((await scalar('show data_directory')).data_directory).toLowerCase(),cluster.toLowerCase());
  await admin.query('create database '+database);await admin.end();
  admin=new Client({...config,database});await admin.connect();
  await admin.query(`create role supabase_admin superuser nologin;create role anon nologin;create role authenticated nologin;
    create role service_role nologin bypassrls;set role supabase_admin;
    create table public.pages(id uuid primary key default gen_random_uuid(),merchant_id text,slug text,blocks jsonb,updated_at timestamptz default now());
    create table public.faolla_schema_migrations(version bigint primary key,name text not null);
    insert into public.faolla_schema_migrations select n,'synthetic-registry-'||n from generate_series(1,209) n;
    grant usage on schema public to anon,authenticated,service_role;
    grant select,insert,update,delete on public.pages to service_role;
    insert into public.pages(merchant_id,slug,blocks) values
      ('__faolla_booking_persistence__','__merchant_booking_records__:v1','{"version":1,"records":[]}'::jsonb),
      ('__faolla_booking_persistence__','__merchant_booking_rules__:v1','{"version":1,"snapshots":[]}'::jsonb),
      ('__faolla_booking_persistence__','__merchant_booking_workbench__:v1','{"version":1,"settingsBySiteId":{}}'::jsonb);`);
  for(const name of ['202610250211_booking_atomic_preparation.sql','202610250212_booking_atomic_runtime.sql']){
    const file='scripts/supabase-migrations/'+name,source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.equal(hash(source.replaceAll('\r\n','\n')),BOOKING_SCOPE.pins[file]);await admin.query(source);
  }
  const before=await snapshot(),saved=(await admin.query('select to_jsonb(p) row from public.pages p order by slug')).rows;
  const registry=(await admin.query('select * from public.faolla_schema_migrations order by version')).rows;
  assert.equal(before.active,false);assert.equal(before.revision,'0');assert.equal(before.protocol,2);assert.equal(before.commands,0);assert.equal(before.mailJobs,0);
  const sql=isolatedBookingActivationAcceptanceSql({before,databaseName:database});
  await check('the exact production identity guard rejects this isolated database without activation',async()=>{
    const productionBefore={...before,systemIdentifier:'7612049595342295079',databaseOid:'5',serverVersionNum:'150008'};
    await rejectTransaction(guardedProductionBookingActivationSql(productionBefore),/booking_activation_database_identity/);
    assert.equal((await snapshot()).active,false);
  });
  await check('stale row hashes and generation fail atomically before the authority flip',async()=>{
    for(const patch of [{savedBookingRowsSha256:'0'.repeat(64)},{generation:'00000000-0000-4000-8000-000000000001'}]){
      await rejectTransaction(isolatedBookingActivationAcceptanceSql({before:{...before,...patch},databaseName:database}),/booking_activation_snapshot_changed/);
      assert.deepEqual(await snapshot(),before);
    }
  });
  await check('private table and RPC privileges are rechecked inside the actual transaction',async()=>{
    await admin.query('grant select on public.faolla_booking_mail_jobs to anon');
    await rejectTransaction(sql,/booking_activation_private_tables/);await admin.query('revoke select on public.faolla_booking_mail_jobs from anon');
    await admin.query('grant execute on function public.faolla_booking_atomic_read_v2() to anon');
    await rejectTransaction(sql,/booking_activation_private_rpcs/);await admin.query('revoke execute on function public.faolla_booking_atomic_read_v2() from anon');
    assert.deepEqual(await snapshot(),before);
  });
  await check('registry drift cannot be mistaken for the approved migration frontier',async()=>{
    await admin.query("update public.faolla_schema_migrations set name='synthetic-wrong-name' where version=202610250212");
    await rejectTransaction(sql,/booking_activation_registry/);
    await admin.query("update public.faolla_schema_migrations set name='booking_atomic_runtime' where version=202610250212");
    assert.deepEqual(await snapshot(),before);
  });
  await check('a synthetic post-update side effect is detected and the control bit and saved rows both roll back',async()=>{
    await admin.query(`create function public.booking_activation_test_corrupt() returns trigger language plpgsql as $$begin
      perform set_config('faolla.booking_atomic_write','v1',true);update public.pages set blocks='{}'::jsonb where slug='__merchant_booking_records__:v1';return new;end;$$;
      create trigger booking_activation_test_corrupt after update on public.faolla_booking_atomic_control
      for each row execute function public.booking_activation_test_corrupt();`);
    await rejectTransaction(sql,/booking_activation_changed_saved_data/);
    assert.deepEqual(await snapshot(),before);
    await admin.query('drop trigger booking_activation_test_corrupt on public.faolla_booking_atomic_control;drop function public.booking_activation_test_corrupt()');
  });
  await check('success changes only active=false to true while preserving all saved rows and registry entries byte-equivalently',async()=>{
    const receipt=resultsRows(await admin.query(sql)).find(row=>row.value)?.value;
    assert.deepEqual(receipt.before,before);assert.deepEqual(receipt.after,{...before,active:true});
    assert.deepEqual(await snapshot(),{...before,active:true});
    assert.deepEqual((await admin.query('select to_jsonb(p) row from public.pages p order by slug')).rows,saved);
    assert.deepEqual((await admin.query('select * from public.faolla_schema_migrations order by version')).rows,registry);
  });
  await check('an already activated generation cannot execute the handoff again',async()=>{
    await rejectTransaction(sql,/booking_activation_not_inactive/);assert.deepEqual(await snapshot(),{...before,active:true});
  });
  service=new Client({...config,database});await service.connect();await service.query('set role service_role');
  await check('legacy booking writes are fenced while unrelated website rows remain writable',async()=>{
    await assert.rejects(service.query("update public.pages set blocks=blocks where slug='__merchant_booking_records__:v1'"),/booking_atomic_legacy_writer_fenced/);
    await service.query("insert into public.pages(merchant_id,slug,blocks) values('synthetic-other','ordinary-unrelated','[]'::jsonb)");
    assert.deepEqual(await snapshot(),{...before,active:true});
  });
  await repairAcceptance(config);
  completed=true;console.log(JSON.stringify({kind:'local-booking-handoff-postgres-acceptance',serverVersionNum:before.serverVersionNum,
    transactionBodySha256:BOOKING_ACTIVATION_BODY_SHA256,isolatedSqlSha256:hash(sql),checks:passed,productionTouched:false,evidence}));
}finally{
  await service?.end().catch(()=>{});await admin?.end().catch(()=>{});
  if(started){
    const pid=(await readFile(path.join(cluster,'postmaster.pid'),'utf8')).split(/\r?\n/);
    assert.equal(path.resolve(pid[1]).toLowerCase(),cluster.toLowerCase());
    await exec(binaries.pg_ctl,['-D',cluster,'-w','-t','30','-m','fast','stop'],{windowsHide:true,timeout:45000});
    console.log(JSON.stringify({kind:'local-booking-handoff-postgres-stopped',completed,checks:passed,evidence}));
  }
}
