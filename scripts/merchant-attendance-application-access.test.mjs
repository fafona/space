import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('scripts/supabase-migrations/202610010098_merchant_attendance_revision_application_access.sql');
const exposed=['faolla_attendance_revision_self_v2(text,uuid,jsonb,jsonb,boolean)','faolla_attendance_revision_owner_review_v3(text,uuid,uuid)',
  'faolla_attendance_revision_decide_v2(text,uuid,uuid,jsonb,uuid,boolean)','faolla_attendance_correction_decide_v2(text,uuid,uuid,jsonb,uuid,boolean)','faolla_attendance_revision_history_v1(text,uuid,jsonb)'];
test('application access grants exactly five consumed RPC signatures to server role only',()=>{
  assert.deepEqual([...sql.matchAll(/grant execute on function public\.([^;]+) to service_role;/g)].map(m=>m[1]),exposed);
  assert.equal((sql.match(/\bgrant\s/gi)||[]).length,5);
  for(const signature of exposed)assert(sql.includes(`revoke all on function public.${signature} from public,anon,authenticated;`));
  assert(!/all functions|all tables|alter default privileges|grant.*(?:anon|authenticated)/i.test(sql));
});
test('access migration is atomic, requires completed protocol migrations and changes no business data or table ACLs',()=>{
  assert(sql.indexOf('begin;')<sql.indexOf('do $access$'));assert(sql.indexOf('attendance_application_prerequisite_required')<sql.indexOf('grant execute'));
  for(const v of [95,96,97])assert(sql.includes('version=2026100100'+v));
  assert.match(sql,/commit;\s*$/);assert(!/create table|create index|update public\.|delete from|truncate|alter table|grant .* on table/i.test(sql));
  assert.deepEqual([...sql.matchAll(/insert into public\.(\w+)/g)].map(m=>m[1]),['faolla_schema_migrations']);
});
test('all five exposed functions keep current identity validation and fixed security-definer search path',()=>{
  const bodies=['202610010095_merchant_attendance_revision_cycles.sql','202610010096_merchant_attendance_current_correction_decisions.sql','202610010097_merchant_attendance_revision_history.sql'].map(n=>read('scripts/supabase-migrations/'+n)).join('\n');
  for(const signature of exposed){const name=signature.split('(')[0],start=bodies.indexOf('create function public.'+name+'('),end=bodies.indexOf('end; $$;',start),body=bodies.slice(start,end);
    assert(start>=0&&end>start,name);assert(/security definer/i.test(body),name);assert(/search_path\s*=\s*pg_catalog/i.test(body),name);
    assert(body.includes('p_auth_user_id'),name);assert(/attendance_access_denied|faolla_attendance_revision_owner_review_v3|faolla_attendance_correction_owner_review/.test(body),name);
  }
});
test('deferred decision-effect validator runs under its trusted owner but remains uncallable by application roles',()=>{
  assert(sql.includes('alter function public.faolla_attendance_revision_decision_link_v1() security definer set search_path=pg_catalog;'));
  assert(sql.includes('revoke all on function public.faolla_attendance_revision_decision_link_v1() from public,anon,authenticated,service_role;'));
  assert.equal((sql.match(/alter function/g)||[]).length,1);assert(!/disable trigger|drop trigger|set constraints|grant select/i.test(sql));
  const native=read('scripts/merchant-attendance-application-access-native.mjs');assert(native.includes('assert.equal(journalCount(),beforeCommit)'));
});
