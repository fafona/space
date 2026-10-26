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
