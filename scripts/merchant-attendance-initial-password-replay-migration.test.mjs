// Source contracts only; real PostgreSQL replay/ACL/idempotence is exercised by
// the separate ownership-checked runner, never by importing this test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=file=>readFileSync(new URL('./supabase-migrations/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const original=read('202608310043_merchant_employee_initial_password_setup.sql');
const sql=read('202610030114_merchant_employee_initial_password_replay.sql');
const name='faolla_claim_merchant_employee_initial_password_setup_v1',signature=`public.${name}(jsonb)`;
const functionText=source=>{
  const matches=[...source.matchAll(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,'g'))];
  assert.equal(matches.length,1,'one complete claim definition required');return matches[0][0];
};
const body=functionText(sql),previous=functionText(original);
const branch=body.match(/  -- BEGIN 114 exact completed receipt replay\.\n[\s\S]*?  -- END 114 exact completed receipt replay\.\n/)?.[0];
assert(branch,'exact completed replay branch required');
const code=source=>source.replace(/--[^\n]*/g,'');
const compact=source=>code(source).replace(/\s+/g,' ').trim();
const outside=code(sql.replace(body,'')),policyFence="  if v_employee.initial_password_policy <> 'required' then";
const ordered=(source,...parts)=>{
  let last=-1;for(const part of parts){const at=source.indexOf(part,last+1);assert(at>last,`SQL ordering mismatch: ${part}`);last=at;}
};

test('removing only the114 branch restores the entire043 function byte-for-byte after newline normalization',()=>{
  assert.equal(body.split(branch).length,2);assert.equal(body.replace(branch,''),previous);
  assert.equal((code(sql).match(/create or replace function/g)??[]).length,1);
  assert.equal(body.slice(0,body.indexOf('\nbegin\n')),previous.slice(0,previous.indexOf('\nbegin\n')));
  assert.match(body,/\(\n  p_input jsonb\n\)\nreturns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public/);
});

test('original input, subject advisory and employee invitation guards all precede the new recovery path',()=>{
  const prefix=body.slice(0,body.indexOf(branch));
  ordered(prefix,"if p_input is null or jsonb_typeof(p_input) <> 'object'",'v_operation_id::text !~',
    'perform pg_catalog.pg_advisory_xact_lock(',"'faolla:merchant-employee-initial-password:'",'202608310043',
    'into v_employee','where merchant_id = v_site_id','and auth_user_id = v_auth_user_id','for update;',
    "raise exception 'merchant_employee_not_invited'","v_employee.status <> 'invited' or v_employee.accepted_at is not null",
    'v_employee.invitation_revoked_at is not null','v_employee.invitation_expires_at <= v_now',
    'v_employee.invitation_version is distinct from v_invitation_version','v_employee.invitation_token_hash is distinct from v_token_hash');
  assert.match(prefix,/raise exception 'employee_invitation_superseded';\n  end if;\n$/);
  assert.equal(prefix,previous.slice(0,previous.indexOf(policyFence)));
});

test('completed recovery locks the current active role then requires every exact identity, generation and operation field on the completed setup',()=>{
  ordered(branch,"if v_employee.initial_password_policy = 'completed' then",'from public.merchant_enterprise_roles',
    'where merchant_id = v_site_id','and id = v_employee.role_id',"and status = 'active'",'for share;',
    "raise exception 'merchant_access_denied';",'into v_setup','from public.merchant_employee_initial_password_setups','for update;','if found then');
  const query=branch.match(/    select \*\n      into v_setup[\s\S]*?     for update;/)?.[0];assert(query);
  assert.equal(compact(query),compact(`select * into v_setup from public.merchant_employee_initial_password_setups
    where employee_id = v_employee.id and merchant_id = v_site_id and auth_user_id = v_auth_user_id
      and invitation_version = v_invitation_version and invitation_token_hash = v_token_hash
      and operation_id = v_operation_id and password_fingerprint = v_password_fingerprint
      and state = 'completed' and completed_at is not null and claim_expires_at is null for update;`));
  assert.doesNotMatch(query,/\bor\b|coalesce|limit|claimed_at|initial_password_policy/);
});

test('a lock wait cannot extend expiry: exact receipt locks precede fresh-clock denial and the original completed response shape',()=>{
  ordered(branch,'for share;','for update;','if found then','if v_employee.invitation_expires_at <= clock_timestamp() then',
    "raise exception 'employee_invitation_expired';",'return jsonb_build_object(');
  assert.equal((branch.match(/clock_timestamp\(\)/g)??[]).length,1);
  const response=branch.match(/return jsonb_build_object\([\s\S]*?\n      \);/)?.[0];assert(response);
  const priorCompleted=previous.slice(previous.indexOf("if v_setup.state = 'completed' then"));
  const priorResponse=priorCompleted.match(/return jsonb_build_object\([\s\S]*?\n        \);/)?.[0];assert(priorResponse);
  assert.equal(compact(response),compact(priorResponse));
  assert.equal(compact(response),compact(`return jsonb_build_object( 'state', v_setup.state, 'resumed', true,
    'employee_id', v_setup.employee_id, 'merchant_id', v_setup.merchant_id, 'auth_user_id', v_setup.auth_user_id,
    'invitation_version', v_setup.invitation_version, 'operation_id', v_setup.operation_id,
    'password_fingerprint', v_setup.password_fingerprint );`));
});

test('new recovery is business-read-only and cannot renew leases, delete other claims or accept membership',()=>{
  const readonly=code(branch).replace(/for update;/g,'');
  assert.doesNotMatch(readonly,/\b(?:insert|update|delete|truncate|merge|execute|call)\b/i);
  assert.doesNotMatch(branch,/v_other_setup|v_claim_expires_at|v_setup\s*:=|faolla_accept_|set_config|pg_advisory/);
  assert.equal((branch.match(/return jsonb_build_object/g)??[]).length,1);
  assert.equal((branch.match(/raise exception/g)??[]).length,2);
  assert(body.indexOf(branch)<body.indexOf('into v_other_setup'));
  assert(body.indexOf(branch)<body.indexOf('delete from public.merchant_employee_initial_password_setups'));
});

test('a missing or mismatched completed receipt falls through to the original not-required denial; required and waived semantics are unchanged',()=>{
  assert.match(branch,/      \);\n    end if;\n  end if;\n  -- END 114/);
  const suffix=body.slice(body.indexOf(branch)+branch.length);
  assert(suffix.startsWith(policyFence));assert.equal(suffix,previous.slice(previous.indexOf(policyFence)));
  assert.match(suffix,/^  if v_employee.initial_password_policy <> 'required' then\n    raise exception 'employee_initial_password_not_required';\n  end if;/);
  assert.doesNotMatch(branch,/policy\s*:?=\s*'required'|policy = 'waived'|exception when/);
  assert.equal((body.match(/insert into public\.merchant_employee_initial_password_setups/g)??[]).length,1);
});

test('migration requires the installed043 function, employee/role/setup tables and exact ledger before replacing the function',()=>{
  const pre=sql.slice(0,sql.indexOf(body));
  assert.match(pre,/^--[^\n]*\n--[^\n]*\n--[^\n]*\nbegin;\nset local lock_timeout='3s';/);
  for(const table of ['faolla_schema_migrations','merchant_enterprise_employees','merchant_enterprise_roles','merchant_employee_initial_password_setups'])
    assert(pre.includes(`to_regclass('public.${table}') is null`));
  assert(pre.includes(`to_regprocedure('${signature}') is null`));
  assert.match(pre,/where version = 202608310043\n       and name = 'merchant_employee_initial_password_setup'/);
  assert.equal((pre.match(/raise exception 'merchant_employee_initial_password_replay_prerequisite_required'/g)??[]).length,2);
  assert.doesNotMatch(pre,/insert into|update public|delete from|create table|grant/i);
});

test('only claim ACL and exact idempotent114 ledger change outside the function; owner, table rights and old facts are untouched',()=>{
  assert.deepEqual([...outside.matchAll(/revoke all on function ([\s\S]*?);/g)].map(match=>compact(match[1])),[`${signature} from public, anon, authenticated`]);
  assert.deepEqual([...outside.matchAll(/grant execute on function ([\s\S]*?);/g)].map(match=>compact(match[1])),[`${signature} to service_role`]);
  assert.doesNotMatch(outside,/\b(?:alter function|owner to|create role|alter role|create table|create index|create trigger|alter table|grant select|drop|truncate|update|delete|merge)\b/i);
  assert.deepEqual([...outside.matchAll(/insert into ([\w.]+)/g)].map(match=>match[1]),['public.faolla_schema_migrations']);
  assert.match(outside,/values \(202610030114, 'merchant_employee_initial_password_replay'\)\non conflict \(version\) do nothing;/);
  assert.match(outside,/where version = 202610030114\n       and name = 'merchant_employee_initial_password_replay'/);
  assert.match(outside,/raise exception 'merchant_employee_initial_password_replay_registry_postcondition_failed'/);
  ordered(outside,"on conflict (version) do nothing;",'do $registry_postcondition$',"notify pgrst, 'reload schema';",'commit;');
  assert.match(outside,/commit;\s*$/);
});
