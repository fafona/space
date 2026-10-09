//Static migration/compatibility proof only. No database or real account.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';
const directory=new URL('./supabase-migrations/',import.meta.url);
const file='202610080186_merchant_attendance_period_delegated_artifacts.sql';
const read=name=>readFileSync(new URL(name,directory),'utf8').replace(/\r/g,'');
const sql=read(file),old149=read('202610050149_merchant_attendance_period_closure.sql'),old183=read('202610080183_merchant_attendance_period_continuation.sql');
const hash=v=>createHash('sha256').update(v).digest('hex');
function fn(source,name) {const start=source.indexOf(`create or replace function public.${name}(`);assert(start>=0,name);
  const dollar=source.indexOf('$$',start),end=source.indexOf('$$;',dollar+2);assert(end>dollar,name);return {definition:source.slice(start,end+3),body:source.slice(dollar+2,end)};}
const checked='faolla_attendance_period_artifact_checked_v1',storage='faolla_attendance_period_storage_insert_v2',shape='faolla_attendance_period_artifact_shape_v2',authority='faolla_attendance_period_artifact_authority_v2';
const shapeBody=fn(sql,shape).body,checkedBody=fn(sql,checked).body;
const oldPins={[checked]:'72d9ea85c9fb0a300a96b2cd8c4a38ac75f4910de0ad402b9a17d1d09faafe79',[storage]:'596649f7edd6ec194e4047e4b0707eba9a6a8905208ddcb5981db0d1db2bd3dd'};

test('186 is an additive transaction with bounded installation lock and exact prerequisites',()=>{
  assert.deepEqual(validateMigrationSource(file,sql),[]);
  assert.match(sql,/begin;\nset local lock_timeout='3s';/);assert.match(sql,/version=202610080184 and name='merchant_attendance_period_delegated_source'/);
  assert.match(sql,/version=202610080185 and name='merchant_attendance_period_delegations'/);assert.match(sql,/values\(202610080186,'merchant_attendance_period_delegated_artifacts'\)/);
  assert.doesNotMatch(sql,/create table|drop\s|truncate\s|disable trigger|session_replication_role|set_config\(/i);
});

test('only two existing private helpers change; no public writer/source/entry/summary replacement',()=>{
  assert.deepEqual([...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(m=>m[1]),[shape,checked,storage,authority]);
  assert.doesNotMatch(sql,/create or replace function public\.faolla_attendance_(?:period_closure_v[12]|period_entry|period_summary|period_delegation_proof|period_delegated_source)/);
  assert.doesNotMatch(sql,/grant execute|insert into public\.merchant_attendance_period_(?:artifacts|entries|versions|delegation_operations)|update public\.merchant_attendance_period_closures/i);
});

test('149 saved v1 branch is byte-equivalent, with unchanged owner-only archive constraint',()=>{
  const marker='  if p.artifact_id is null',before=fn(old149,checked).body,after=checkedBody;
  assert.equal(after.slice(after.indexOf(marker)),before.slice(before.indexOf(marker)));
  assert.match(after.slice(after.indexOf(marker)),/report'->>'access' is distinct from 'owner'/);
  assert.match(after,/if a->>'protocol'='attendance-period-artifact-v2' then/);
});

test('183 storage charge is identical except the strict saved-v2 shape branch',()=>{
  const old=fn(old183,storage).body,replacement=`  if new.artifact_text::jsonb->>'protocol'='attendance-period-artifact-v2' then
    body:=public.faolla_attendance_period_artifact_shape_v2(new);
  else body:=public.faolla_attendance_period_artifact_checked_v1(new);end if;`;
  assert.equal(fn(sql,storage).body,old.replace('  body:=public.faolla_attendance_period_artifact_checked_v1(new);',replacement));
  assert.match(sql,/used_bytes<=67108864-new\.artifact_bytes/);assert.match(shapeBody,/artifact_bytes not between 1 and 2097152/);
  assert.match(shapeBody,/octet_length\(convert_to\(src::text,'UTF8'\)\)>1048576/);
});

test('upstream source pins are independent and reentry also pins all four resulting bodies',()=>{
  for(const [name,prior] of [[checked,old149],[storage,old183]]){assert.equal(hash(fn(prior,name).body),oldPins[name]);assert(sql.includes(oldPins[name]));}
  for(const name of [checked,storage,shape,authority]) assert(sql.includes(`'${hash(fn(sql,name).body)}'`),name);
  assert.match(sql,/expected_hash:=case when installed then spec\.new_hash else spec\.old_hash end/);
  assert.match(sql,/f\.proowner<>/);assert.match(sql,/f\.proconfig is distinct from array\['search_path=pg_catalog'\]/);
  assert.match(sql,/f\.prosecdef<>spec\.is_definer/);assert.match(sql,/f\.proargtypes\[0\]<>/);
});

test('same owned-schema transformation normalizes pins without accepting changed function bodies',()=>{
  const body=fn(sql,checked).body,owned='attendance_owned_186',normalize=(value,namespace)=>value.replaceAll('\r','').replaceAll(`${namespace}.`,'public.');
  const rewritten=body.replaceAll('public.',`${owned}.`).replaceAll('\n','\r\n');
  assert.equal(hash(normalize(rewritten,owned)),hash(body));
  assert.notEqual(hash(normalize(rewritten.replace("is distinct from 'send'","is distinct from 'seal'"),owned)),hash(body));
  assert.match(sql,/quote_ident\(\(select nspname from pg_namespace where oid=f\.pronamespace\)\)\|\|'\.','public'\|\|'\.'/);
  assert.match(sql,/tgfoid=to_regprocedure\('public\.faolla_attendance_period_artifact_authority_v2\(\)'\)/);
});

test('stored v2 requires exact nine fields and exact captured send authority, never a candidate/view authority',()=>{
  assert.match(shapeBody,/array\['protocol','sourceFingerprint','source','worker','period','report','dayBoundaries','calculationVersion','authority'\]/);
  assert.match(shapeBody,/array\['protocol','siteId','grantId','grantRevision','actorEmployeeId','actorAuthUserId','workerId','employeeId','employeeAuthUserId','delegateGeneration','employeeGeneration','fromDate','throughDate','action','includeExisting','grantedAt','authorizedAt','periodId'\]/);
  assert.match(shapeBody,/authority->>'action' is distinct from 'send'/);assert.match(shapeBody,/authority->'grantRevision' is distinct from '1'::jsonb/);
  assert.match(shapeBody,/report'->>'access' is distinct from 'delegate'/);assert.doesNotMatch(shapeBody,/owner_checked/);
});

test('shape rejects null authority, malformed generations/timestamps and mismatched saved identities',()=>{
  for(const token of ["p.merchant_id is null","p.period_id is null","p.artifact_id is null","p.artifact_bytes is null","p.recorded_at is null","not isfinite(p.recorded_at)",
    "'uuid') is distinct from true","(authority->>k)::numeric>9007199254740990","granted_stamp>authorized_stamp","authorized_stamp>p.recorded_at",
    "authority->>'actorEmployeeId'=authority->>'employeeId'","authority->>'actorAuthUserId'=authority->>'employeeAuthUserId'",
    "authority->>'workerId' is distinct from w->>'workerId'","authority->>'periodId' is distinct from p.period_id::text",
    "authority->>'fromDate' is distinct from frame->>'fromDate'","authority->>'throughDate' is distinct from frame->>'throughDate'"]) assert(shapeBody.includes(token),token);
  assert.match(shapeBody,/invalid_datetime_format or datetime_field_overflow/);
});

test('v2 bytes/SHA/source/frame remain exact; no timezone or report recomputation',()=>{
  for(const token of ["p.artifact_bytes is distinct from octet_length(convert_to(p.artifact_text,'UTF8'))","p.artifact_sha256 is distinct from encode(sha256(convert_to(p.artifact_text,'UTF8')),'hex')",
    "p.source_fingerprint is distinct from encode(sha256(convert_to(src::text,'UTF8')),'hex')","src->>'employeeAuthUserId' is distinct from w->>'employeeAuthUserId'",
    "src->>'fromAt' is distinct from frame->>'startAt'","src->>'toAt' is distinct from frame->>'endAt'","src->'dayBoundaries' is distinct from a->'dayBoundaries'"]) assert(shapeBody.includes(token),token);
  assert.doesNotMatch(checkedBody,/faolla_attendance_period_delegation_guard|clock_timestamp\(|pg_timezone_names|faolla_attendance_period_closure_source|faolla_attendance_period_delegated_source/);
});

test('complete checker point-binds the creation send sidecar, entry, version and timestamp',()=>{
  for(const token of ["x.operation_id=p.artifact_id","delegated.authority is distinct from a->'authority'","delegated.recorded_at is distinct from p.recorded_at",
    "faolla_attendance_period_delegation_proof_v1(delegated) is distinct from true","creation.action is distinct from 'send'",
    "creation.command->>'expectedFingerprint' is distinct from p.source_fingerprint","version_row.artifact_id is distinct from p.artifact_id",
    "version_row.version is distinct from creation.version","version_row.recorded_at is distinct from p.recorded_at",
    "faolla_attendance_period_entry_v2(creation)","faolla_attendance_period_summary_v1(head,a)"]) assert(checkedBody.includes(token),token);
  assert.doesNotMatch(checkedBody,/order by|limit 20|merchant_enterprise_employees|merchant_enterprise_roles/);
});

test('deferred insert constraint enforces full proof after artifact/version/entry/sidecar become available',()=>{
  assert.match(sql,/create constraint trigger attendance_period_artifact_authority after insert on public\.merchant_attendance_period_artifacts\n\s+deferrable initially deferred for each row/);
  const trigger=fn(sql,authority);assert.match(trigger.definition,/security definer set search_path=pg_catalog/);
  assert.match(trigger.body,/tg_op<>'INSERT'.*tg_when<>'AFTER'.*tg_level<>'ROW'/);assert.match(trigger.body,/perform public\.faolla_attendance_period_artifact_checked_v1\(new\)/);
  assert.match(sql,/tgdeferrable and tginitdeferred and tgconstraint<>0 and not tgisinternal/);
});

test('all four functions remain private, including inherited service-role privileges',()=>{
  for(const name of [shape,checked,storage,authority]) assert.match(sql,new RegExp(`revoke all on function public\\.${name}\\([^;]*from public,anon,authenticated,service_role;`));
  assert.match(sql,/has_function_privilege\(role_name,signature,'EXECUTE'\)/);assert.match(sql,/a\.grantee<>f\.proowner/);
  assert.doesNotMatch(sql,/grant\s+execute|security invoker.*service_role/i);
});
