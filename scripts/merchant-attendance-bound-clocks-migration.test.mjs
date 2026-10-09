// Static opt-in wrapper contracts. Four-channel PostgreSQL behavior is tested
// by the separate owner-controlled native acceptance, never by importing here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {validateMigrationSource} from './check-supabase-migrations.mjs';

const filename='202610040134_merchant_attendance_bound_clocks.sql';
const source=readFileSync(new URL(`./supabase-migrations/${filename}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
const clean=source.replace(/--[^\n]*/g,'');
const contracts=[
  {channel:'self',name:'faolla_attendance_self_bound_v1',old:'faolla_attendance_self_v1',types:'text,uuid,jsonb,uuid',auth:'p_auth_user_id',
    migration:'202610020111_merchant_attendance_self_clock_identity.sql',args:'p_site_id,p_auth_user_id,p_command,p_operation_id'},
  {channel:'location',name:'faolla_attendance_location_clock_bound_v1',old:'faolla_attendance_location_clock_v2',types:'text,uuid,uuid,jsonb,uuid,jsonb,boolean,boolean',auth:'p_auth_user_id',
    migration:'202610020113_merchant_attendance_location_receipt_identity.sql',args:'p_site_id,p_auth_user_id,p_expected_worker_id,p_command,p_operation_id,p_assertion,p_allow_new_sessions,p_require_clock'},
  {channel:'pin',name:'faolla_attendance_pin_clock_bound_v1',old:'faolla_attendance_pin_clock_v1',types:'text,uuid,text,text,uuid,boolean,jsonb,boolean',auth:'null',
    migration:'202610020112_merchant_attendance_pin_clock_identity.sql',args:'p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,p_request,p_allow_new'},
  {channel:'onsite',name:'faolla_attendance_onsite_clock_bound_v1',old:'faolla_attendance_onsite_clock_v1',types:'text,uuid,jsonb,jsonb,uuid,boolean',auth:'p_auth',
    migration:'202610010108_merchant_attendance_onsite_qr.sql',args:'p_site,p_auth,p_claims,p_command,p_operation,p_allow_new'},
];
const fn=name=>{const start=clean.indexOf(`create or replace function public.${name}(`);assert(start>=0);return clean.slice(start,clean.indexOf('$$;',start)+3);};
const signature=(text,name)=>{const match=text.match(new RegExp(`create (?:or replace )?function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns jsonb`));assert(match,name);return match[1].replace(/\s+/g,'');};
const ordered=(text,...parts)=>{let position=-1;for(const part of parts){const next=text.indexOf(part,position+1);assert(next>position,part);position=next;}};

test('134 adds exactly four wrappers and registry only; no table trigger or old SQL/function rewrites',()=>{
  assert.deepEqual(validateMigrationSource(filename,source),[]);
  assert.deepEqual([...clean.matchAll(/create or replace function public\.(\w+)/g)].map(match=>match[1]),contracts.map(c=>c.name));
  assert.deepEqual([...clean.matchAll(/insert into public\.(\w+)/g)].map(match=>match[1]),['faolla_schema_migrations']);
  assert.doesNotMatch(clean,/\b(?:create\s+(?:table|index|trigger)|alter\s+table|update\s+public\.|delete\s+from|truncate|drop|lock\s+table)\b/i);
});

test('134 prerequisites require latest identity-aware clocks and133; reject partially installed wrappers',()=>{
  for(const fragment of ["202610010108::bigint,'merchant_attendance_onsite_qr'","202610020111::bigint,'merchant_attendance_self_clock_identity'",
    "202610020112::bigint,'merchant_attendance_pin_clock_identity'","202610020113::bigint,'merchant_attendance_location_receipt_identity'",
    "202610040133::bigint,'merchant_attendance_shift_rule_bindings'",'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)',
    'installed<>(to_regprocedure(p) is not null)','merchant_attendance_bound_clocks_installation_conflict',
    "values(202610040134,'merchant_attendance_bound_clocks') on conflict(version) do nothing"])assert(clean.includes(fragment));
  for(const c of contracts)assert(clean.includes(`public.${c.old}(${c.types})`));
});

for(const c of contracts)test(`${c.channel} wrapper retains original parameters/defaults and forwards every argument exactly once`,()=>{
  const original=readFileSync(new URL(`./supabase-migrations/${c.migration}`,import.meta.url),'utf8');
  assert.equal(signature(clean,c.name),signature(original,c.old));
  const rpc=fn(c.name);assert.equal((rpc.match(new RegExp(`public\\.${c.old}\\(`,'g'))||[]).length,1);
  assert(rpc.includes(`result:=public.${c.old}(${c.args});`));
  assert(rpc.includes(`perform public.faolla_attendance_bind_shift_rules_v1((result->'receipt'->>'id')::uuid,'${c.channel}',${c.auth});`));
  assert.equal((rpc.match(/result\s*:=/g)||[]).length,1);assert.doesNotMatch(rpc,/return\s+(?!result;)|jsonb_build_object|jsonb_set|result\s*\|\|/i);
});

test('all channels bind only fresh successful clock_in, never receipt-only reads replay breaks or closing events',()=>{
  for(const c of contracts){const rpc=fn(c.name),command=c.channel==='pin'?'command':'p_command';
    ordered(rpc,`result:=public.${c.old}(`,`if ${command} is not null and ${command}->>'action'='clock_in' then`,
      "if result->'replayed'='false'::jsonb then", "result->'receipt'->>'action' is distinct from 'clock_in'",
      'perform public.faolla_attendance_bind_shift_rules_v1(', 'return result;');
    assert(rpc.includes("result->'replayed' is distinct from 'true'::jsonb and result->'replayed' is distinct from 'false'::jsonb"));
    assert.doesNotMatch(rpc,/clock_out|break_start|break_end|current_timestamp|clock_timestamp|select\s+.*from/i);
    assert.equal((rpc.match(/perform public\.faolla_attendance_bind_shift_rules_v1\(/g)||[]).length,1);
  }
});

test('fresh receipt binds actual event id with exact site operation and action; malformed internal results fail closed',()=>{
  for(const c of contracts){const rpc=fn(c.name),command=c.channel==='pin'?'command':'p_command',site=['self','location'].includes(c.channel)?'p_site_id':'p_site';
    for(const fragment of ["result->'receipt'->>'action' is distinct from 'clock_in'",`result->'receipt'->>'operationId' is distinct from ${command}->>'operationId'`,
      `result->'receipt'->>'siteId' is distinct from ${site}`,"jsonb_typeof(result->'receipt'->'id') is distinct from 'string'",
      "raise exception 'attendance_shift_rule_binding_invalid'"])assert(rpc.includes(fragment));
  }
});

test('PIN preserves old error object and lease subtransaction: no wrapper catches old RPC or binder exceptions',()=>{
  const pin=fn('faolla_attendance_pin_clock_bound_v1');ordered(pin,'result:=public.faolla_attendance_pin_clock_v1(',"if result ? 'error' then return result;end if;",
    "command:=nullif(p_request->'command','null'::jsonb)",'perform public.faolla_attendance_bind_shift_rules_v1(');
  for(const c of contracts)assert.doesNotMatch(fn(c.name),/\bexception\s+when\b/i);
  assert.doesNotMatch(pin,/faolla_attendance_pin_finish_v1|faolla_attendance_pin_begin_v1|p_lease\s*:=/);
  assert.doesNotMatch(fn('faolla_attendance_location_clock_bound_v1'),/faolla_attendance_location_clock_v1\(|safeFinish|noticeRevision/);
});

test('four service-only grants target only wrappers;133 binder stays inaccessible directly',()=>{
  assert.equal((clean.match(/grant execute/g)||[]).length,4);assert.equal((clean.match(/revoke all/g)||[]).length,4);
  for(const c of contracts){assert(clean.includes(`revoke all on function public.${c.name}(${c.types}) from public,anon,authenticated,service_role`));
    assert(clean.includes(`grant execute on function public.${c.name}(${c.types}) to service_role`));}
  assert(clean.includes("has_function_privilege(r,'public.faolla_attendance_bind_shift_rules_v1(uuid,text,uuid)','EXECUTE')"));
  assert(clean.includes("a.grantee=0 and a.privilege_type='EXECUTE'"));assert(clean.includes('merchant_attendance_bound_clocks_acl_postcondition_failed'));
  assert.doesNotMatch(clean,/grant execute on function public\.faolla_attendance_bind_shift_rules_v1/);
});

test('wrappers contain no owner impersonation source lookup settings upgrade backfill or client-supplied binding payload',()=>{
  for(const c of contracts){const rpc=fn(c.name);assert(rpc.includes('security definer set search_path=pg_catalog'));
    assert.doesNotMatch(rpc,/faolla_attendance_rule_sources_v1|faolla_attendance_rule_captures_v1|merchants|for update|for share|employee_auth|sourceText|snapshot|on conflict|\bexecute\b/i);}
});
