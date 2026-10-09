import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {qualifyAttendanceSandbox,withAttendanceConcurrencySandbox,attendanceConcurrencyMigrations} from "./merchant-attendance-concurrency-sandbox.mjs";

const schema='attendance_race_0123456789abcdef0123456789abcdef';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('sandbox accepts only run-specific safe schema identifiers',()=>{
  for(const name of ['public','attendance_race_',schema+'; drop schema public cascade',schema.toUpperCase(),'pg_temp',null])
    assert.throws(()=>qualifyAttendanceSandbox('select public.x;',name));
  assert.equal(qualifyAttendanceSandbox('select public.x; revoke all on public.x from public,anon;',schema),`select ${schema}.x; revoke all on ${schema}.x from public,anon;`);
});
test('real migration semantics are unchanged apart from qualification and search_path',()=>{
  for(const name of attendanceConcurrencyMigrations) {
    const source=read(`supabase-migrations/${name}`),mapped=qualifyAttendanceSandbox(source,schema);
    assert.doesNotMatch(mapped,/\bpublic\./);
    assert.doesNotMatch(mapped,/search_path\s*=\s*pg_catalog,\s*public\b/);
    assert.equal(mapped.replaceAll(schema,'public'),source);
  }
});
function mock({mismatch=false,setupFailure=false}={}) {
  let name,marker,removed=false,owned;const queries=[];
  return {queries,get removed(){return removed;},context:{root,
    query(source) {
      queries.push(source);
      if(source.includes('select count(*) from pg_namespace')) return '0';
      if(source.includes('create schema')) {
        name=source.match(/create schema (attendance_race_[a-f0-9]{32})/)[1];
        marker=source.match(/is '(faolla-synthetic-concurrency:[a-f0-9-]+)'/)[1];
        owned={oid:12345,owner:'postgres',marker};return JSON.stringify(owned);
      }
      if(source.startsWith('select jsonb_build_object')) return JSON.stringify(mismatch?{...owned,oid:12346}:owned);
      if(source.startsWith('drop schema')) {assert.equal(source,`drop schema ${name} cascade;`);removed=true;return '';}
      throw Error('unexpected SQL');
    },async querySteps(sources) {
      for(const source of sources) assert.doesNotMatch(source,/\bpublic\./);
      assert.ok(sources[0].includes('begin;'));assert.equal(sources.at(-1),'commit;');
      if(setupFailure) throw Error('synthetic setup failure');
    },
  }};
}
test('run-specific namespace is cleaned on success and callback failure',async()=>{
  for(const failure of [false,true]) {
    const m=mock();
    const operation=withAttendanceConcurrencySandbox(m.context,async({schema:actual})=>{
      assert.match(actual,/^attendance_race_[a-f0-9]{32}$/);if(failure)throw Error('synthetic check failure');
    });
    if(failure)await assert.rejects(operation,/synthetic check failure/);else await operation;
    assert.equal(m.removed,true);
  }
});
test('failed migration setup still removes only this run-owned namespace',async()=>{
  const m=mock({setupFailure:true});
  await assert.rejects(withAttendanceConcurrencySandbox(m.context,async()=>assert.fail('must not execute')),/synthetic setup failure/);
  assert.equal(m.removed,true);
});
test('cleanup refuses changed ownership identity and leaves unknown namespace alone',async()=>{
  const m=mock({mismatch:true});
  await assert.rejects(withAttendanceConcurrencySandbox(m.context,async()=>{}),/attendance_concurrency_cleanup_identity_mismatch/);
  assert.equal(m.removed,false);
});
test('concurrency runner is opt-in and bounded, reuses the stopped local cluster only',()=>{
  const connections=read('merchant-attendance-native-connections.mjs'),runner=read('merchant-attendance-correction-decision-concurrency-native.mjs');
  const sandbox=read('merchant-attendance-concurrency-sandbox.mjs'),reuse=read('merchant-attendance-choice-labels-reuse-native.mjs');
  assert.doesNotMatch(connections+runner+sandbox,/\.\.\.process\.env|DATABASE_URL|SUPABASE_|dotenv|writeFile|mkdtemp|execSync|session_replication_role|disable trigger/);
  assert.match(connections,/--host=127\.0\.0\.1/);assert.match(connections,/windowsHide:true, shell:false/);
  for(const guard of ['active.size < 4','25000','12000','2000000','closeAll','--no-password','--no-psqlrc']) assert.ok(connections.includes(guard));
  assert.match(runner,/any\(pg_blocking_pids\(pid\)\)/);assert.match(runner,/attendance_concurrency_exact_blocker_not_witnessed/);
  assert.match(runner,/assert.equal\(witnessed,19\)/);assert.match(runner,/path.resolve\(fileURLToPath\(import.meta.url\)\)/);
  for(const guard of ['attendance_reuse_namespace_not_restored','attendance_reuse_table_inventory_not_restored','await connections.closeAll()'])assert.ok(reuse.includes(guard));
});
