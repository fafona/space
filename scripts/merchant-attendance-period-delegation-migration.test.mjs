//Static migration contracts only: no database, service, browser or role writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const directory=new URL('./supabase-migrations/',import.meta.url);
const read=name=>readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n');
const sql=read('202610080185_merchant_attendance_period_delegations.sql');
const body=(source,name)=>{
  const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('\n$$;',start);
  assert(start>=0&&end>start,name);return source.slice(start,end+4);
};
const sourceOf=definition=>definition.slice(definition.indexOf('as $$')+5,definition.lastIndexOf('$$;'));
const own=name=>body(sql,'faolla_attendance_period_delegation_'+name+'_v1');
const main=body(sql,'faolla_attendance_period_delegation_v1');
const has=(source,parts)=>parts.forEach(part=>assert(source.includes(part),part));
const oldPermissions=body(read('202610060168_merchant_attendance_schedule_delegation_permissions.sql'),'faolla_valid_merchant_enterprise_permissions_v1');
const oldCapture=body(read('202610060167_merchant_attendance_schedule_delegation.sql'),'faolla_attendance_account_capture_v1');
const permissionRows=['view','send','respond','seal','reopen'].map(action=>`      ('attendance.period.${action}', array['enterprise.view'${action==='view'?'':", 'attendance.period.view'"}]::text[]),`).join('\n')+'\n';
const capturePredicate='\n    and not exists(select 1 from public.merchant_attendance_period_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))';

test('185 is additive with exactly three append-only ledgers, guarded re-entry and short installation locks',()=>{
  assert.equal((sql.match(/create table if not exists public\./g)||[]).length,3);
  has(sql,["set local lock_timeout='3s'",'202610060167','202610060168','202610080183',
    'merchant_attendance_period_delegation_installation_conflict','item.proconfig is distinct from',
    'attendance_period_delegation_immutable before update or delete','attendance_period_delegation_no_truncate before truncate',
    'alter table %s enable row level security','revoke all on %s from public,anon,authenticated,service_role',
    'attendance_period_delegation_authority after insert',"values(202610080185,'merchant_attendance_period_delegations') on conflict(version) do nothing"]);
  assert(sql.endsWith("notify pgrst, 'reload schema';\ncommit;\n"));
  assert.doesNotMatch(sql,/update public\.merchant_enterprise_roles|insert into public\.merchant_attendance_period_(?:entries|versions|artifacts|closures)\(/i);
});

test('the sole two existing replacements are the approved permissions and account capture functions',()=>{
  const names=[...sql.matchAll(/^create or replace function public\.([a-z0-9_]+)\(/gm)].map(match=>match[1]);
  const old=names.filter(name=>!name.startsWith('faolla_attendance_period_delegation_')&&!name.includes('_pre_period_'));
  assert.deepEqual(old,['faolla_valid_merchant_enterprise_permissions_v1','faolla_attendance_account_capture_v1']);
  assert.equal(names.length,13);
  assert.doesNotMatch(sql,/execute\s+(?:replace|regexp_replace)\(|pg_get_functiondef/i);
});

test('preflight encloses scalar CASE so PLpgSQL IF does not stop at its inner THEN',()=>{
  const preflight=sql.split('do $period_delegation_preflight$')[1].split('$period_delegation_preflight$;')[0];
  has(preflight,['select count(*) from pg_proc p','p.proname=object_name)',
    "<>(case when installed then 1 else 0 end) then raise exception 'merchant_attendance_period_delegation_installation_conflict';end if;"]);
  assert.doesNotMatch(preflight,/(?:<>|=|is distinct from)\s*case\b/i);
});

test('private permission baseline is exact168, and the public validator adds only the five approved dependency rows',()=>{
  const preserved=body(sql,'faolla_valid_merchant_enterprise_permissions_pre_period_v1').replace('_pre_period_v1(','_v1(');
  assert.equal(preserved,oldPermissions);
  const changed=body(sql,'faolla_valid_merchant_enterprise_permissions_v1');
  assert.equal(changed.split(permissionRows).length-1,1);
  assert.equal(changed.replace(permissionRows,''),oldPermissions);
  assert.doesNotMatch(permissionRows,/attendance\.self\.view|attendance\.records\.view/);
});

test('private account baseline is exact167 and only two early exits learn either party of a period grant',()=>{
  assert.equal(body(sql,'faolla_attendance_account_capture_pre_period_v1').replace('_pre_period_v1(','_v1('),oldCapture);
  const changed=body(sql,'faolla_attendance_account_capture_v1');
  assert.equal(changed.split(capturePredicate).length-1,2);
  assert.equal(changed.replaceAll(capturePredicate,''),oldCapture);
});

test('forward body guard contains exact originals and exact normalization, no dynamically rewritten function execution',()=>{
  const literal=tag=>sql.split('$'+tag+'$')[1];
  assert.equal(literal('permissions_original'),sourceOf(oldPermissions));
  assert.equal(literal('capture_original'),sourceOf(oldCapture));
  assert.equal(literal('period_permission_rows'),permissionRows);
  assert.equal(literal('period_capture_predicate'),capturePredicate);
  has(sql,["replace(prosrc,E'\\r\\n',E'\\n')",'actual_permissions is distinct from expected_permissions','actual_capture is distinct from expected_capture',
    'length(removed_permissions)<>1','length(removed_capture)<>2','function_row.prosrc',"raise exception 'merchant_attendance_period_delegation_forward_conflict'"]);
  assert.doesNotMatch(sql,/E'\\\\r\\\\n'/);
});

test('commands reject NULL/unknown fields, self management, noncanonical actions and over366-day intervals',()=>{
  const command=own('command');
  has(command,["p_access is distinct from 'owner'","jsonb_typeof(p) is distinct from 'object'",'8192',
    "array['action','operationId','delegateEmployeeId','delegateAuthUserId','workerId','employeeId','employeeAuthUserId','fromDate','throughDate','actions','includeExisting','validFrom','validUntil','reason']",
    "jsonb_typeof(p->'includeExisting') is distinct from 'boolean'","values('view',1),('send',2),('respond',3),('seal',4),('reopen',5)",
    "canonical_actions is distinct from p->'actions'","not(canonical_actions ? 'view')","p->>'delegateEmployeeId'=p->>'employeeId'","p->>'delegateAuthUserId'=p->>'employeeAuthUserId'",
    'last_day-first_day not between 0 and 365',"last_at-first_at>interval '366 days'","p->'expectedRevision' is distinct from '1'::jsonb",
    "char_length(p->>'reason') between 1 and 200"]);
});

test('management hash preserves JSONB scalar tuple including civil dates, canonical action text and boolean',()=>{
  has(own('hash'),["jsonb_build_array('attendance-period-delegation-v1',p_query->>'siteId',p_query->>'access')",
    "p->>'fromDate',p->>'throughDate',action_text,(p->>'includeExisting')::boolean,p->>'validFrom',p->>'validUntil',p->>'reason'",
    "jsonb_build_array('revoke',p->>'operationId',p->>'grantId',1,p->>'reason')","encode(sha256(convert_to(tuple_value::text,'UTF8')),'hex')"]);
  assert.doesNotMatch(own('hash'),/replace\(|regexp_replace/);
});

test('private fresh gate locks settings then worker then sorted memberships and role before current authority and clock',()=>{
  const guard=own('guard');
  const ordered=['from public.merchants x where x.id=p_site for share','from public.merchant_attendance_settings x where x.merchant_id=p_site for update',
    'x.id=p_worker for update','order by x.id for share','x.id=member.role_id for share','authorized_stamp:=clock_timestamp()'];
  let prior=-1;for(const part of ordered){const index=guard.indexOf(part);assert(index>prior,part);prior=index;}
  has(guard,['p_action is null',"p_action not in('view','send','respond','seal','reopen')",'p_allow_write is distinct from true',
    'merchant.user_id is distinct from saved_grant.actor_auth_user_id','p_from<saved_grant.from_date','p_through>saved_grant.through_date',
    'period_head.from_date<>p_from or period_head.through_date<>p_through','period_head.opened_at<saved_grant.recorded_at',
    "if p_action not in('view','send')", "not(usable ? 'view') or not(usable ? p_action)"]);
});

test('usable actions require present roles, both exact active identities, current owner and both suspension generations',()=>{
  const actions=own('actions');
  has(actions,["array['enterprise.view','attendance.period.view']",'member.auth_user_id=p.delegate_auth_user_id',
    'target.auth_user_id=p.employee_auth_user_id','member.id<>target.id','member.auth_user_id<>target.auth_user_id',
    'merchant.user_id=p.actor_auth_user_id','coalesce(delegate_epoch.paused,false)','coalesce(target_epoch.paused,false)',
    'coalesce(delegate_epoch.generation,0)<>p.delegate_generation','coalesce(target_epoch.generation,0)<>p.employee_generation']);
  assert.doesNotMatch(actions,/attendance\.self|attendance\.records|default_location/);
  has(main,['order by x.id for share',"(p_command->>'validUntil')::timestamptz<=stamp"]);
});

test('authority proof compares actual period entry and exact18-field authority without consulting current roles or epochs',()=>{
  const proof=own('proof');
  has(proof,['entry_value.period_id<>p.period_id','entry_value.revision<>p.period_revision','entry_value.version<>p.period_version',
    'entry_value.actor_auth_user_id<>p.actor_auth_user_id','p.command is distinct from entry_value.command','entry_value.recorded_at<>p.recorded_at',
    'public.faolla_attendance_period_closure_command_v2(entry_value.command) is distinct from true','p.authority is not distinct from expected_authority',
    "'grantRevision',1",'p.authorized_at>=saved_grant.valid_until','x.recorded_at<=p.authorized_at']);
  assert.doesNotMatch(proof,/account_epochs|merchant_enterprise_roles|clock_timestamp\(|delegation_actions_v1/);
  assert.doesNotMatch(proof,/action not in\('send','confirm'|action not in\('send','dispute'/);
});

test('disabled gate is NULL-safe and permits only explicit recovery, owner metadata and owner revocation',()=>{
  has(main,["p_allow_write is distinct from true and (p_command is null and (mode_name='recover' or access_name='owner' and mode_name in('list','detail'))",
    "or p_command is not null and access_name='owner' and action_name='revoke') is distinct from true",
    "mode_name<>'recover' and merchant.user_id is distinct from p_auth_user_id"]);
  assert(main.indexOf('attendance_period_delegation_disabled')<main.indexOf('receipt_value:=public.faolla_attendance_period_delegation_receipt_v1'));
  has(main,["if mode_name='recover' or p_command is not null then can_write:=false",'can_write:=p_allow_write and settings.enabled']);
});

test('receipt is actor and original-member bound, contains no command/source, and runs before fresh roles',()=>{
  const receipt=own('receipt');
  has(receipt,['delegated.actor_employee_id is distinct from p_employee','actor_uuid is distinct from p_auth',
    "(p_access='delegate') is distinct from (delegated.operation_id is not null)","'periodId',null,'periodRevision',null",'if matches=0 then return null']);
  assert.doesNotMatch(receipt,/'command',|'reason',|'worker',|account_epochs|merchant_enterprise_roles|clock_timestamp\(/);
  assert(main.indexOf('receipt_value:=public.faolla_attendance_period_delegation_receipt_v1')<main.indexOf('if mode_name<>\'recover\' and receipt_value is null'));
  has(main,['saved_grant.command is distinct from p_command or saved_grant.query is distinct from p_query',
    'revoked.command is distinct from p_command or revoked.query is distinct from p_query','from public.merchant_attendance_period_entries x where x.merchant_id=site and x.operation_id=op']);
});

test('identity-index pagination is bounded before usability; detail and catalog cannot disclose other delegates or sources',()=>{
  const list=main.slice(main.indexOf("elsif mode_name='list'"),main.indexOf("elsif mode_name='detail'"));
  has(list,['x.delegate_employee_id=employee_uuid and x.delegate_auth_user_id=p_auth_user_id','order by x.grant_id limit 26',
    'seen:=seen+1;exit when seen=26','public.faolla_attendance_period_delegation_actions_v1(saved_grant,stamp)']);
  assert(list.indexOf('limit 26')<list.indexOf('delegation_actions_v1'));
  has(main,["access_name='delegate' and mode_name='catalog'",'saved_grant.delegate_employee_id<>employee_uuid or saved_grant.delegate_auth_user_id<>p_auth_user_id',
    "'actions',candidate.allowed_actions",'directory order by directory.id limit 26','>131072']);
  assert.doesNotMatch(main,/period_source|delegated_source|artifact_text|timeZone|locationId|latitude|longitude/);
});

test('only the management RPC is executable by service_role; all authority and baseline functions stay private',()=>{
  const grants=[...sql.matchAll(/grant execute on function ([^;]+);/g)].map(match=>match[1]);
  assert.deepEqual(grants,['public.faolla_attendance_period_delegation_v1(jsonb,uuid,jsonb,boolean) to service_role']);
  for(const name of ['guard','proof','authority','receipt'])assert.match(sql,new RegExp(`revoke all on function public\\.faolla_attendance_period_delegation_${name}_v1\\([^;]+from public,anon,authenticated,service_role;`));
  has(sql,['faolla_valid_merchant_enterprise_permissions_pre_period_v1(text[]) from public,anon,authenticated,service_role',
    'faolla_attendance_account_capture_pre_period_v1(text,uuid,uuid,uuid,boolean) from public,anon,authenticated,service_role',
    'cross join lateral aclexplode(attr.attacl)','merchant_attendance_period_delegation_index_conflict']);
});
