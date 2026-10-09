import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const migration=read('scripts/supabase-migrations/202610010092_merchant_attendance_revision_review.sql');
test('revision review migration creates read functions only, without new data copies or replacing old paths',()=>{
  assert(!/create or replace|create table|create index|drop (?:table|function)|(?:update|delete from) public\./i.test(migration));
  assert.deepEqual([...migration.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
  assert.equal([...migration.matchAll(/create function public\./g)].length,3);
  assert.equal([...migration.matchAll(/grant execute on function/g)].length,1);
  assert.match(migration,/where id=p_site_id and user_id=p_auth_user_id for share/);
  assert.match(migration,/octet_length\(result::text\)>393216/);
});
test('revision checks use their own namespace and retain raw, other-approved, employment and current-lock safeguards',()=>{
  const checks=migration.slice(migration.indexOf('create function public.faolla_attendance_revision_review_checks_v1'),migration.indexOf('create function public.faolla_attendance_revision_owner_review_v1'));
  assert(!/faolla_attendance_decision_checks_v1|merchant_attendance_correction_decisions|already_decided|already_effective/.test(checks));
  assert.match(checks,/start_event_id<>p_base_start/);assert.match(checks,/effective_overlap/);
  for(const name of ['overlap_previous','overlap_next','employment_gap','employment_ambiguous','self_review','binding_changed','basis_unavailable'])assert(checks.includes("'"+name+"'"));
  assert.match(migration,/revision=p_request\.policy_revision and action='set_policy'/);
  assert.match(migration,/p_request\.recorded_at>=deadline/);
  assert.match(migration,/start_at<original_end and end_at>original_start/);
  for(const v of ['p_base','proposal'])assert(migration.includes(`start_at<(${v}->>'endAt')::timestamptz and end_at>(${v}->>'startAt')::timestamptz`));
});
test('evidence covers new request, base approval and current head; preparation is never a decision or authorization grant',()=>{
  for(const field of ['sourceToken','base','command','headOperation','headRevision','blockers','controlsRevision','tailId','effectId'])assert(migration.includes("'"+field+"'"));
  assert.match(migration,/'reviewOnly',true,'approvalAvailable',false,'effectiveChanged',false/);
  const server=read('src/lib/merchantAttendanceRevisionReview.server.ts');assert.match(server,/parseAttendanceRevisionReviewResult/);assert(!/p_command|p_allow_write|decide_v1/.test(server));
});
test('shared raw-basis, neighbor, bound-rule and employment checks stay aligned with first approval checks',()=>{
  const old=read('scripts/supabase-migrations/202609300086_merchant_attendance_correction_decisions.sql');
  const begin="  if e->'currentBasis'='null'::jsonb then";
  const extract=(s,end)=>{const from=s.indexOf(begin);assert(from>=0);const to=s.indexOf(end,from);assert(to>from);return s.slice(from,to).replace(/--[^\n]*/g,'').replace(/\s/g,'');};
  assert.equal(extract(migration,'  -- Current v1 effects'),extract(old,'  if exists(select 1 from public.merchant_attendance_correction_effects'));
});
test('dedicated GET endpoint is separately gated, same-origin, no cache and no automatic background fetch',()=>{
  const route=read('src/app/api/merchant-enterprise/attendance/revision-reviews/route-handler.ts');
  for(const k of ['ADMIN','CORRECTION_REVIEW','REVISION_REVIEW'])assert(route.includes(`process.env.FAOLLA_ATTENDANCE_${k}_ENABLED==="1"`));
  assert.match(route,/request\.method!=="GET"/);assert.match(route,/sec-fetch-site/);assert.match(route,/await deps\.entitlement/);assert.match(route,/private, no-store/);
  assert(!/setInterval|localStorage|sessionStorage/.test(route));
});
