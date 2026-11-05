import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const root=path.resolve(import.meta.dirname,'..');
const name='202611050213_booking_atomic_safeupdate_singleton.sql';
const read=file=>readFileSync(path.join(root,'scripts',file),'utf8').replaceAll('\r\n','\n');
const sql=read('supabase-migrations/'+name);
const previous=read('supabase-migrations/202610250212_booking_atomic_runtime.sql');
const extract=source=>source.match(/create or replace function public\.faolla_booking_atomic_commit_v1\([\s\S]*?\$commit_booking\$;/)?.[0];
const oldUpdate='update public.faolla_booking_atomic_control set revision = revision + 1;';
const newUpdate='update public.faolla_booking_atomic_control set revision = revision + 1\n    where singleton = v_control.singleton;';

test('online safeupdate correction passes migration checks without rewriting installed migrations',()=>{
  assert.deepEqual(validateMigrationSource(name,sql),[]);
  assert.ok(previous.includes(oldUpdate));
  assert.equal((sql.match(/create or replace function /g)||[]).length,1);
  assert.ok(sql.includes("values (202611050213, 'booking_atomic_safeupdate_singleton')"));
});

test('the complete transaction function changes only the singleton-key predicate',()=>{
  const before=extract(previous),after=extract(sql);
  assert.ok(before&&after);
  assert.equal(before.split(oldUpdate).length,2);
  assert.equal(after,before.replace(oldUpdate,newUpdate));
  assert.doesNotMatch(after,/where\s+(?:true|1\s*=\s*1)\s*;/i);
});

test('source guard pins the installed body and preserves private function configuration',()=>{
  const body=extract(previous).split('as $commit_booking$')[1].split('$commit_booking$;')[0];
  assert.equal(createHash('md5').update(body).digest('hex'),'310b382802e94af2997b1b9751fab0bc');
  assert.ok(sql.includes("md5(replace(prosrc, chr(13), '')) = '310b382802e94af2997b1b9751fab0bc'"));
  assert.ok(sql.includes("proconfig = array['search_path=pg_catalog, public']::text[]"));
  assert.ok(sql.indexOf('booking_atomic_safeupdate_source_mismatch')<sql.indexOf('create or replace function'));
  assert.doesNotMatch(sql,/\b(?:grant|revoke)\b|alter\s+(?:role|system|database)|safeupdate\.enabled|set\s+active\s*=/i);
  const outside=sql.replace(extract(sql),'');
  assert.doesNotMatch(outside,/\b(?:update|delete\s+from|insert\s+into)\s+public\.(?:pages|faolla_booking_atomic_control|faolla_booking_atomic_commands|faolla_booking_mail_jobs)\b/i);
});

test('real PostgreSQL acceptance applies the fix while active and verifies data and ACL invariants',()=>{
  const acceptance=read('booking-atomic-postgres-acceptance.mjs');
  assert.ok(acceptance.includes(name));
  assert.ok(acceptance.includes('safeupdate correction installs online without changing business data or function ACLs'));
  assert.ok(acceptance.includes('beforeCorrection'));
  assert.ok(acceptance.includes('proowner,proacl,proconfig,prosecdef'));
});
