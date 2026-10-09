import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=read('scripts/supabase-migrations/202610010094_merchant_attendance_revision_decision_core.sql');
const review=read('scripts/supabase-migrations/202610010092_merchant_attendance_revision_review.sql');
const versions=read('scripts/supabase-migrations/202610010093_merchant_attendance_versioned_reports.sql');
function definition(s,name){const start=s.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));assert(start>=0,name);const end=s.indexOf('$$;',start);assert(end>start);return s.slice(start,end+3);}
const normalize=s=>s.replace(/--[^\n]*/g,'').replace(/\s/g,'');
test('private review uses latest effective sources without altering original identity, employment, policy and overlap rules',()=>{
  const checks=definition(review,'faolla_attendance_revision_review_checks_v1').replaceAll('faolla_attendance_revision_review_checks_v1','faolla_attendance_revision_review_checks_v2').replaceAll('merchant_attendance_correction_effects','merchant_attendance_effect_current_v2');
  assert.equal(normalize(definition(migration,'faolla_attendance_revision_review_checks_v2')),normalize(checks));
  const owner=definition(review,'faolla_attendance_revision_owner_review_v1').replaceAll('faolla_attendance_revision_owner_review_v1','faolla_attendance_revision_owner_review_v2').replaceAll('faolla_attendance_revision_review_checks_v1','faolla_attendance_revision_review_checks_v2');
  assert.equal(normalize(definition(migration,'faolla_attendance_revision_owner_review_v2')),normalize(owner));
});
test('private decision core has no application grant, legacy HTTP executor, backfill or full snapshot',()=>{
  assert(!/grant execute|grant .* on .* to service_role/i.test(migration));
  assert.match(migration,/revoke all on function public\.faolla_attendance_revision_decide_v1\(text,uuid,uuid,jsonb,uuid,boolean\) from public,anon,authenticated,service_role/);
  assert.match(migration,/p_allow_write boolean default false/);
  const handler=read('src/app/api/merchant-enterprise/attendance/revision-decisions/route-handler.ts');
  assert(handler.includes('FAOLLA_ATTENDANCE_REVISION_DECISIONS_ENABLED==="1"'));assert(handler.includes('executeRevisionDecision'));
  const executor=read('src/lib/merchantAttendanceRevisionDecision.server.ts');assert(executor.includes('faolla_attendance_revision_decide_v2'));assert(!executor.includes('faolla_attendance_revision_decide_v1'));
  const table=migration.slice(migration.indexOf('create table'),migration.indexOf('create index'));
  assert(!/snapshot|proposal|basis|latitude|csv/i.test(table));assert.match(table,/octet_length\(command::text\)<=4096/);
  assert.match(migration,/attendance_revision_decision_requires_empty_candidate_journal/);
});
test('deferred constraints couple approvals and effects; rejected decisions cannot own effective versions',()=>{
  assert.match(migration,/foreign key\(merchant_id,operation_id\)[\s\S]*deferrable initially deferred/);
  assert.match(migration,/\(d.action='approve'\)<>\(n.operation_id is not null\)/);
  for(const column of ['root_request_id','request_id','worker_id','previous_operation_id','actor_auth_user_id','request_revision','evidence_token','reason','recorded_at'])assert(migration.includes('n.'+column+'<>d.'));
  assert.match(migration,/alter table public\.merchant_attendance_revision_decisions enable row level security/);
  assert.match(migration,/before update or delete[\s\S]*before truncate/);
  assert.equal([...migration.matchAll(/create constraint trigger/g)].length,2);
});
test('fresh decisions reauthorize and recheck under settings UPDATE lock, while exact receipt replay precedes pause checks',()=>{
  const body=definition(migration,'faolla_attendance_revision_decide_v1');
  assert(body.indexOf('where id=p_site_id and user_id=p_auth_user_id for share')<body.indexOf('r:=public.faolla_attendance_revision_owner_review_v2'));
  assert(body.indexOf('for update;end if;')<body.indexOf('r:=public.faolla_attendance_revision_owner_review_v2'));
  assert(body.indexOf('if receipt.command<>p_command')<body.indexOf('attendance_platform_paused'));
  for(const code of ['attendance_access_denied','attendance_operation_conflict','attendance_revision_base_changed','attendance_version_conflict','attendance_correction_evidence_changed','attendance_correction_decision_blocked'])assert(body.includes(code));
  assert.match(body,/if receipt.action='approve' then\s+insert into public\.merchant_attendance_effect_versions/);
  assert(body.indexOf('insert into public.merchant_attendance_revision_decisions')<body.indexOf('insert into public.merchant_attendance_effect_versions'));
  assert(!/exception when others|dblink|http_|pg_sleep|commit;/.test(body));
});
test('legacy paths only gain post-authorization terminal-state refusal, preserving their existing behavior otherwise',()=>{
  for(const name of ['faolla_attendance_revision_self_v1','faolla_attendance_revision_owner_review_v1']){
    const actual=definition(migration,name),before=definition(versions,name);
    const clean=actual.replace(/^.*if exists\(select 1 from public\.merchant_attendance_revision_decisions.*\n/m,'');
    assert.equal(normalize(clean),normalize(before));
    assert(actual.indexOf('attendance_access_denied')<actual.indexOf('if exists(select 1 from public.merchant_attendance_revision_decisions'));
  }
});
