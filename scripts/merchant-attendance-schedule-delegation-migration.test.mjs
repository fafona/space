//198 static contract checks only. This test never starts PostgreSQL or a browser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const directory=new URL('./supabase-migrations/',import.meta.url);
const read=name=>readFileSync(new URL(name,directory),'utf8').replaceAll('\r\n','\n');
const sql=read('202610060167_merchant_attendance_schedule_delegation.sql');
const body=(source,name)=>{const start=source.indexOf('create or replace function public.'+name+'('),end=source.indexOf('\n$$;',start);assert(start>=0&&end>start,name);return source.slice(start,end+4);};
const own=name=>body(sql,'faolla_attendance_schedule_delegation_'+name+'_v1');
const main=body(sql,'faolla_attendance_schedule_delegation_v1');
const has=(source,parts)=>parts.forEach(p=>assert(source.includes(p),p));

test('167 has guarded prerequisites/reentry and exactly three private append-only tables',()=>{
  has(sql,['202610060166','merchant_attendance_schedule_delegation_installation_conflict','set local lock_timeout=\'3s\'',
    "values(202610060167,'merchant_attendance_schedule_delegation') on conflict(version) do nothing",'notify pgrst, \'reload schema\';\ncommit;']);
  assert.equal((sql.match(/create table if not exists public\./g)||[]).length,3);
  has(sql,['attendance_schedule_delegation_immutable before update or delete','attendance_schedule_delegation_no_truncate before truncate',
    'alter table %s enable row level security','revoke all on %s from public,anon,authenticated,service_role']);
  assert.doesNotMatch(sql,/alter table public\.merchant_attendance_(?:delegation_epochs|events|schedule_slots)/i);
});

test('only the approved five existing functions are replaced; no original writer or template authority changes',()=>{
  const names=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map(x=>x[1]);
  const old=names.filter(n=>!n.startsWith('faolla_attendance_schedule_delegation_'));
  assert.deepEqual(old,['faolla_attendance_schedule_publication_guard_v1','faolla_attendance_self_schedule_slot_v1',
    'faolla_attendance_schedule_overview_v1','faolla_attendance_sources_schedule_v1','faolla_attendance_account_capture_v1']);
  assert.equal(names.length,14);
  assert.doesNotMatch(main,/faolla_attendance_schedule_v1\(|faolla_attendance_schedule_evidenced_v1\(|m\.user_id\s*,\s*(?:decision|p_command)/);
  assert.doesNotMatch(sql,/pg_get_functiondef[^;]+replace\(|execute\s+replace\(/i);
});

test('all old history readers differ only by mandatory saved authority proof, with original owner branches unchanged',()=>{
  for(const [file,name,aliases] of [
    ['202610050137_merchant_attendance_self_schedule.sql','faolla_attendance_self_schedule_slot_v1',['published','cancelled']],
    ['202610030120_merchant_attendance_schedule_overview.sql','faolla_attendance_schedule_overview_v1',['published','cancelled']],
    ['202610040128_merchant_attendance_sources.sql','faolla_attendance_sources_schedule_v1',['original','cancelled']],
  ]){
    let changed=body(sql,name);
    for(const a of aliases){const before=`${a}.query->>'access' is distinct from 'owner'`,after=`(${before} and public.faolla_attendance_schedule_delegation_proof_v1(${a}) is distinct from true)`;
      assert(changed.includes(after));changed=changed.replace(after,before);}
    assert.equal(changed,body(read(file),name),name);
  }
});

test('136 evidence insert binds delegate proof and every saved identity/version before original slot checking',()=>{
  let changed=body(sql,'faolla_attendance_schedule_publication_guard_v1');
  const added=changed.match(/  if original\.query->>'access'='delegate' and not exists[\s\S]+?then raise exception 'attendance_schedule_publication_evidence_invalid';end if;\n/);
  assert(added);has(added[0],['a.employee_auth_user_id','a.worker_version','a.location_version','a.settings_version','new.employee_auth_user_id']);
  changed=changed.replace(added[0],'').replace("(original.query->>'access' is distinct from 'owner' and public.faolla_attendance_schedule_delegation_proof_v1(original) is distinct from true)","original.query->>'access' is distinct from 'owner'");
  assert.equal(changed,body(read('202610050136_merchant_attendance_schedule_publication_evidence.sql'),'faolla_attendance_schedule_publication_guard_v1'));
});

test('164 capture changes only its two early exits and handles either new party even when rollout is off',()=>{
  let changed=body(sql,'faolla_attendance_account_capture_v1');
  const exists='and not exists(select 1 from public.merchant_attendance_schedule_delegations x where x.merchant_id=p_site and (x.delegate_employee_id=p_employee or x.employee_id=p_employee))';
  assert.equal(changed.split(exists).length-1,2);
  changed=changed.replace('if ep.employee_id is null and not coalesce(p_enabled,false)\n    '+exists+' then return null;end if;',
    'if ep.employee_id is null and not coalesce(p_enabled,false) then return null;end if;');
  changed=changed.replace('\n    '+exists,'');
  assert.equal(changed,body(read('202610060164_merchant_attendance_account_suspensions.sql'),'faolla_attendance_account_capture_v1'));
});

test('strict commands retain original8/6 decisions, ordered actions and full-grant identity',()=>{
  const c=own('command');
  has(c,["array['expectedGrantRevision','decision']","p->'expectedGrantRevision' is distinct from '1'::jsonb",
    "array['operationId','expectedRevision','expectedSettingsVersion','reason','action','locationId','timeZone','slots']",
    "array['operationId','expectedRevision','expectedSettingsVersion','reason','action','slotId']",
    "values('publish',1),('cancel',2)","d->>'delegateEmployeeId'=d->>'employeeId'","d->>'delegateAuthUserId'=d->>'employeeAuthUserId'",
    "jsonb_array_length(d->'slots') not between 1 and 32","date_trunc('minute',a)<>a","b-a>interval '24 hours'",'a<prior_end']);
});

test('hash matches frozen scalar-array wire and only slots get compact pair serialization',()=>{
  const h=own('hash');has(h,["jsonb_build_array('attendance-schedule-delegation-v1',p_query->>'siteId',p_query->>'access')",
    "to_jsonb(value->>0)::text||','||to_jsonb(value->>1)::text", "p_query->>'grantId',1,p_query->>'fromDate',p_query->>'throughDate'",
    "d->>'reason',d->>'locationId',d->>'timeZone',slots,d->>'slotId'","encode(sha256(convert_to(v::text,'UTF8')),'hex')"]);
  assert.doesNotMatch(h,/replace\(|regexp_replace/);
});

test('saved proof checks exact old/new command and query while ignoring current revocation/role/epoch',()=>{
  const p=own('proof');has(p,['a.original_query is distinct from p.query','a.original_command is distinct from p.command','a.recorded_at is distinct from p.recorded_at',
    'a.actor_employee_id is distinct from g.delegate_employee_id','a.authorized_at<g.valid_from','a.authorized_at>=g.valid_until',
    "a.command_fingerprint is distinct from public.faolla_attendance_schedule_delegation_hash_v1(a.query,a.command)",
    'pub.employee_auth_user_id is distinct from g.employee_auth_user_id','not g.include_existing_future and pub.published_at<g.recorded_at']);
  assert.doesNotMatch(p,/schedule_delegation_actions_v1|schedule_delegation_revocations|account_epochs|merchant_enterprise_roles|clock_timestamp\(/);
});

test('fresh role/identity/epoch checks use captured generations without old generation0 fallback',()=>{
  const a=own('actions');has(a,['e.auth_user_id=p.delegate_auth_user_id','target.auth_user_id=p.employee_auth_user_id',"dr.status='active'",
    'coalesce(de.paused,false)','coalesce(te.paused,false)','coalesce(de.generation,0)<>p.delegate_generation','coalesce(te.generation,0)<>p.employee_generation',
    "('attendance.schedule.'||a)=any(permissions)"]);
  assert.doesNotMatch(sql,/insert into public\.merchant_attendance_delegation_epochs|update public\.merchant_enterprise_roles/i);
});

test('writer ordering is settings then worker then stable member locks; current time is captured afterwards',()=>{
  has(main,['from public.merchant_attendance_settings where merchant_id=site for update',
    'x.id in(g.delegate_employee_id,g.employee_id) order by x.id for share',
    'stamp:=clock_timestamp();actions:=public.faolla_attendance_schedule_delegation_actions_v1(g,stamp)']);
  assert(main.indexOf('from public.merchant_attendance_settings where merchant_id=site for update')<main.indexOf('x.id=g.worker_id for update'));
  has(main,["if not p_allow_write then raise exception 'attendance_schedule_delegation_disabled'", "if not s.enabled then raise exception 'attendance_platform_paused'",
    "w.default_location_id is distinct from l.id",'first_at<g.valid_from or last_at>g.valid_until',"first_at>stamp+interval '180 days'",
    'starts_on<=day and (ends_on is null or ends_on>=last_work_day)',"raise exception 'attendance_schedule_overlap'",'slot.start_at<=stamp']);
});

test('original schedule plus authority plus136 evidence are one uncaught transaction in that exact order',()=>{
  const commands=main.indexOf('insert into public.merchant_attendance_schedule_commands'),slots=main.indexOf('insert into public.merchant_attendance_schedule_slots'),
    authority=main.indexOf('insert into public.merchant_attendance_schedule_delegation_operations'),evidence=main.indexOf('insert into public.merchant_attendance_schedule_publication_evidence');
  assert(commands>0&&commands<slots&&slots<authority&&authority<evidence);
  assert.doesNotMatch(main.slice(commands,evidence),/exception when|return result/);
  has(main,["'access','delegate','workerId',g.worker_id",'values(site,rev,op,p_auth_user_id,original_query,decision,stamp)',"'bound',w.version,l.id,l.version,s.version"]);
});

test('recovery is minimal, actor/member bound and precedes fresh flags/role/expiry checks',()=>{
  const r=own('receipt');has(r,['p_employee is distinct from a.actor_employee_id','actor is distinct from p_auth',"'commandFingerprint',fingerprint"]);
  assert.doesNotMatch(r,/'reason',|'command',|'workerName',|'startAt',/);
  assert(main.indexOf('receipt:=public.faolla_attendance_schedule_delegation_receipt_v1')<main.indexOf("if not p_allow_write then raise exception"));
  has(main,["if mode_name<>'recover' and receipt is null then","authority.query is distinct from p_query or authority.command is distinct from p_command",
    "if mode_name='recover' or p_command is not null then can_write:=false",'id=employee_uuid for share',
    "if de.id is null or de.auth_user_id is distinct from p_auth_user_id then raise exception 'attendance_access_denied'"]);
});

test('scoped bounded reads do not leak overlap details and do not return partial100 entry sets',()=>{
  const s=own('schedule');has(s,['x.worker_id=p.worker_id and x.location_id=p.location_id','e.employee_auth_user_id=p.employee_auth_user_id',
    'p.include_existing_future or e.published_at>=p.recorded_at','order by x.work_date,x.start_at,x.id limit 101',"if n>100 then entries:='[]';exit",
    "'rangeLimited',n>100"]);
  has(main,['last_day-first_day>30','order by x.grant_id limit 26','order by c.id limit 26',
    "octet_length(convert_to(result_json::text,'UTF8'))>131072", "if schedule->'rangeLimited'='true'::jsonb then raise exception 'attendance_schedule_range_limit'"]);
  assert.doesNotMatch(main,/from public\.merchant_attendance_workers w\b|from public\.merchant_attendance_locations l\b|x\.grant_id=grant_id\b/);
});

test('private ACL/RLS/trigger postconditions and sole new serviceRPC grant remain explicit',()=>{
  assert.equal((sql.match(/grant execute on function public\.faolla_attendance_schedule_delegation/g)||[]).length,1);
  has(sql,['has_function_privilege(r,f,\'EXECUTE\')','pg_has_role(r,c.relowner,\'USAGE\')','aclexplode(coalesce(c.relacl',
    "tgtype=27","tgtype=34","tgtype=5","tgenabled='O'",'attendance_schedule_delegation_authority after insert']);
});
