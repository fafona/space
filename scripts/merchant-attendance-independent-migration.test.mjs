//196 finite SOURCE tests. No PostgreSQL, process, browser, KDF or production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {independentFunctionManifest,independentInstallationManifest,independentInstallationGuard,independentForwardSql,independentSplit,independentCheckNormalize,
 independentPermissionHelperName,independentPermissionAclMatches,independentPermissionAclConflictSql} from './merchant-attendance-independent-installation.mjs';
import {independentWorkerForwardRecipes} from './merchant-attendance-independent-forward.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sql=readFileSync(new URL('./supabase-migrations/202610080196_merchant_attendance_independent_workers.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const manifest=independentInstallationManifest(root,sql),functions=independentFunctionManifest(sql);
const body=n=>{const f=functions.find(f=>f.name==='faolla_attendance_independent_'+n);assert(f,n);return f.body;};
const block=tag=>{const s=sql.match(new RegExp(`do \\$${tag}\\$[\\s\\S]*?\\$${tag}\\$;`))?.[0];assert(s,tag);return s;};
const includes=(s,...tokens)=>tokens.forEach(t=>assert(s.includes(t),t));

test('196 is additive six-table/twenty-function source, no fabricated membership or historical rewrite',()=>{
 assert.equal(manifest.tables.length,6);assert.equal(manifest.functions.length,20);assert.equal(manifest.forward.length,7);assert.equal(manifest.indexes.length,2);
 assert.deepEqual(manifest.functions.filter(f=>f.securityDefiner).map(f=>f.name),['faolla_attendance_independent_admin_v1','faolla_attendance_independent_begin_v1','faolla_attendance_independent_finish_v1']);
 assert.deepEqual([...sql.matchAll(/^grant execute on function public\.(\w+)/gm)].map(m=>m[1]),manifest.functions.filter(f=>f.serviceExecute).map(f=>f.name));
 assert(!/insert into public\.(?:merchant_enterprise_employees|merchant_enterprise_roles|auth)|update public\.merchant_attendance_events|alter table public\.merchant_(?:enterprise_employees|attendance_pin_credentials)|disable trigger|session_replication_role|set_config\(|drop (?:table|function|index)/i.test(sql));
 assert(sql.trimEnd().endsWith('commit;'));assert.equal((sql.match(/^begin;$/gm)||[]).length,1);assert.equal((sql.match(/^commit;$/gm)||[]).length,1);
 includes(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080196,'merchant_attendance_independent_workers')");
});

test('196 owner choices are explicit bounded read branches, not parallel old configuration writers',()=>{
 const s=body('admin_v1');includes(s,"mode_name in('members','locations')", "ks:=ks||array['cursor','search']", "mode_name in('list','members','locations')",
  "elsif not owner_now then raise exception 'attendance_access_denied'", "if p_command is null then select * into config", "mode_name<>'detail'", "elsif mode_name='members'", "elsif mode_name='locations'");
 const choices=s.slice(s.indexOf("elsif mode_name='members'"),s.indexOf("elsif mode_name='list' then",s.indexOf("elsif mode_name='members'")));
 assert.equal((choices.match(/limit 26 loop/g)||[]).length,2);assert.equal((choices.match(/seen=26 then next_id:=last_id;exit/g)||[]).length,2);
 assert(!/insert into|update |delete from|for update|accepted_at|p_allow_new/.test(choices));
});
test('196 candidate members mirror actual bind eligibility; locations use current merchant active rows and literal search',()=>{
 const s=body('admin_v1');includes(s,"z.merchant_id=p_site and z.status='active' and z.auth_user_id is not null and role.status='active'",
  'public.faolla_valid_merchant_enterprise_permissions_v1(role.permissions) is true', "array['enterprise.view','attendance.self.view','attendance.self.clock']::text[]<@role.permissions",
  'used.merchant_id=p_site and used.employee_id=z.id', "'employeeId',e.id,'authUserId',e.auth_user_id,'displayName',e.display_name",
  'where z.merchant_id=p_site and z.active', "'locationId',l.id,'name',l.name,'timeZone',l.time_zone", 'order by z.id limit 26 loop', "position(lower(p_query->>'search') in lower(z.name))>0");
});
test('196 installation manifests pin every own body and prior dependency at both boundaries',()=>{
 assert.equal(block('independent_preflight'),independentInstallationGuard(manifest,'independent_preflight'));
 assert.equal(block('independent_postconditions'),independentInstallationGuard(manifest,'independent_postconditions',true));
 assert(sql.indexOf('$independent_preflight$;')<sql.indexOf('create table'));
 for(const f of manifest.functions)for(const tag of ['independent_preflight','independent_postconditions'])includes(block(tag),f.hash,f.name);
 for(const tag of ['independent_preflight','independent_postconditions'])includes(block(tag),'f.proargnames','f.pronargdefaults','f.proconfig','f.proparallel',"a.privilege_type='EXECUTE'",'function_inventory',"a.grantor<>expected_owner");
});

test('196 both PLpgSQL inventory IF conditions parenthesize CASE without altering scope rewrite or thresholds',()=>{
 const expression="+(case when spec->>'name' in('merchant_attendance_independent_leases','merchant_attendance_independent_event_sources') then 1 else 0 end) then raise exception";
 const schema='attendance_race_'+'a'.repeat(32);
 for(const tag of ['independent_preflight','independent_postconditions']){
  const guard=block(tag),mapped=qualifyAttendanceSandbox(guard,schema);
  includes(guard,expression,"from jsonb_array_elements(spec->'constraints') v where v->>'kind' in('p','u')");
  assert(!guard.includes('+case when spec->'));
  assert.equal(mapped.replaceAll(schema,'public'),guard);
  assert.deepEqual([...mapped.matchAll(/\$[a-z_]+\$/g)].map(m=>m[0]),[...guard.matchAll(/\$[a-z_]+\$/g)].map(m=>m[0]));
 }
});
test('196 pure clock validator parenthesizes the top-level IF CASE and keeps command semantics',()=>{
 const s=body('clock_command_v1'),schema='attendance_race_'+'b'.repeat(32);
 includes(s,"or (case when p->>'action'='break_start' then jsonb_typeof(p->'breakPaid') is distinct from 'boolean' else p->'breakPaid' is distinct from 'null'::jsonb end) then raise exception",
  "p->>'action' not in('clock_in','break_start','break_end','clock_out')",'return jsonb_build_array(');
 assert(!/\bor\s+case\b/.test(s));assert.equal(qualifyAttendanceSandbox(s,schema).replaceAll(schema,'public'),s);
});

test('196 accepts exactly185 or190 official permission helper according to exact registry, never arbitrary same-capability code',()=>{
 const helper=manifest.dependencies.find(f=>f.name==='faolla_valid_merchant_enterprise_permissions_v1');
 assert.equal(helper.source,'202610080190_merchant_attendance_correction_delegation_permission.sql');assert.notEqual(helper.hash,helper.legacyHash);
 assert.deepEqual(helper.config,['search_path=pg_catalog, public']);
 for(const tag of ['independent_preflight','independent_postconditions'])includes(block(tag),"version=202610080190 and name<>'merchant_attendance_correction_delegation_permission'","version=202610080185 and name='merchant_attendance_period_delegations'","and not has190 then expected_hash:=spec->>'legacyHash'",helper.hash,helper.legacyHash);
 includes(body('admin_v1'),"r.status is distinct from 'active'",'faolla_valid_merchant_enterprise_permissions_v1(r.permissions)',"array['enterprise.view','attendance.self.view','attendance.self.clock']");
 assert(!body('admin_v1').includes('faolla_attendance_pin_member_v1'));
});
test('196 only the exact pure permission helper accepts the two inherited ACL shapes; no ACL is changed',()=>{
 const owner=42,row=(grantee,patch={})=>({grantor:owner,grantee,privilege_type:'EXECUTE',is_grantable:false,...patch}),accept=rows=>independentPermissionAclMatches(rows,owner,true);
 assert(accept([row(owner)]));assert(accept([row(owner),row(0)]));assert(accept([row(0),row(owner)]));
 for(const acl of [[],[row(0)],[row(owner),row(owner)],[row(owner),row(50)],[row(owner),row(51)],[row(owner),row(52)],
  [row(owner),row(0),row(53)],[row(owner,{grantor:99})],[row(owner,{is_grantable:true})],[row(owner),row(0,{is_grantable:true})],
  [row(owner,{privilege_type:'SELECT'})],[row(owner,{extra:true})]])assert(!accept(acl),JSON.stringify(acl));
 assert(!independentPermissionAclMatches([row(owner)],owner,false));assert(!independentPermissionAclMatches([row(owner)],0,true));
 const guard=block('independent_preflight'),acl=independentPermissionAclConflictSql();
 includes(guard,"if spec->>'name'='"+independentPermissionHelperName+"' then",acl,"else\n   if has_function_privilege('anon',f.oid,'EXECUTE')");
 assert(guard.indexOf("'merchant_attendance_independent_installation_conflict:function:%'")<guard.indexOf("if spec->>'name'='"+independentPermissionHelperName+"' then"));
 for(const tag of ['independent_preflight','independent_postconditions']){
  includes(block(tag),'a.grantor,a.grantee,a.privilege_type,a.is_grantable',"0::oid,'EXECUTE',false", "has_function_privilege(expected_owner,f.oid,'EXECUTE') is distinct from true");
  assert(!/\b(?:grant|revoke)\b/i.test(block(tag)));
 }
});
test('196 table metadata/constraints/indexes/ACL/RLS and immutable triggers refuse drift before any repair',()=>{
 for(const t of manifest.tables){assert(t.columns.length>0);assert(t.constraints.length>0);assert.equal(new Set(t.constraints.map(c=>c.name)).size,t.constraints.length);assert(t.constraints.every(c=>c.name.length<=63));}
 for(const tag of ['independent_preflight','independent_postconditions'])includes(block(tag),"relrowsecurity and not relforcerowsecurity","from pg_policy where polrelid=t",'column:%.%','check:%.%','foreign_key:%','idx.indkey[z-1]<>a.attnum','idx.indoption[z-1]<>0','o.opcdefault','o.opcintype<>a.atttypid','trigger:%','tr.tgargs','index_inventory:%');
 includes(block('independent_storage'),"where version=202610080196) then return;end if",'independent_immutable before insert or update or delete','independent_no_truncate before truncate');
 //String and regexp literals stay exact, including character-class brackets.
 includes(block('independent_preflight'),"left(z.token[1],1)=chr(39) then z.token[1]",'regexp_matches(regexp_replace(');
});
test('196 PG15 inheritance metadata is exact per known constraint kind, never a blanket exception',()=>{
 const kinds=new Set(manifest.tables.flatMap(t=>t.constraints.map(c=>c.kind)));assert.deepEqual([...kinds].sort(),['c','f','p','u']);
 for(const tag of ['independent_preflight','independent_postconditions'])includes(block(tag),
  "coalesce(c->>'kind','') not in('c','p','u','f')", "con.connoinherit is distinct from ((c->>'kind') in('p','u','f'))",
  'not con.convalidated','con.conislocal is distinct from true','con.coninhcount<>0',
  "con.condeferrable<>coalesce((c->>'deferred')::boolean,false)","con.condeferred<>coalesce((c->>'initiallyDeferred')::boolean,false)",
  'constraint_keys:%','foreign_key:%','constraint_index:%');
});
test('196 exact forward recipes reconstruct only six195 cores and one head, preserving all unmentioned bytes',()=>{
 assert.deepEqual(manifest.forward.map(({argumentNames,defaults,resultType,volatility,language,securityDefiner,serviceExecute,config,...r})=>{assert(argumentNames&&config&&language&&resultType&&volatility);assert(Number.isInteger(defaults));assert.equal(securityDefiner,serviceExecute);return r;}),independentWorkerForwardRecipes(root));
 assert.equal(block('independent_forward'),independentForwardSql(manifest));
 const forward=block('independent_forward');includes(forward,'pg_get_functiondef(f.oid)','after_fn.oid is distinct from f.oid','after_fn.proacl is distinct from f.proacl',"to_jsonb(after_fn)-array['prosrc','proargdefaults']",'recipe_metadata','recipe_hash');
 for(const r of manifest.forward){assert(r.changes.every(c=>c.count===1&&c.from.length>0));assert(r.changes.every(c=>!c.from.includes('receipt.actor')&&!c.to.includes('actor_employee_id is null then')));}
 assert(!/receipt gate|update public|insert into public|revoke |grant /i.test(manifest.forward.flatMap(r=>r.changes.map(c=>c.to)).join('\n')));
});
test('196 bootstrap is closed exact saved boundary; state or absent fresh-operation pre-read only, never old original receipt',()=>{
 includes(body('bootstrap_v1'),"s.state<>'bound'",'w.employee_id is distinct from p_employee','w.version<b.worker_version',"i.action is distinct from 'bind_member'",'i.command_fingerprint is distinct from b.command_fingerprint','b.last_independent_event_id,b.last_sequence',"e.action<>'clock_out'",'faolla_attendance_independent_clock_receipt_v1(x)');
 includes(body('bootstrap_intent_v1'),"p_command->>'action' is distinct from 'clock_in'",'if p_operation is not null and exists(select 1 from public.merchant_attendance_events\n   where merchant_id=p_site and worker_id=p_worker and operation_id=p_operation) then return false;end if;',"public.merchant_attendance_events where merchant_id=p_site and worker_id=p_worker and operation_id=op");
 assert.equal((body('bootstrap_intent_v1').match(/operation_id=/g)||[]).length,2);
 includes(body('current_boundary_v1'),'faolla_attendance_independent_bootstrap_v1','faolla_attendance_independent_boundary_v1');
});
test('196 owner writes use actual owner, exact source CAS and target member/role before worker',()=>{
 const a=body('admin_v1');includes(a,'from public.merchants where id=p_site for share','owner_now:=','if not owner_now then raise exception','where merchant_id=p_site for update','expectedSettingsVersion','expectedSubjectRevision','expectedGeneration','expectedWorkerVersion','expectedCredentialRevision');
 assert(a.indexOf('if a=\'bind_member\' then')<a.indexOf('id=s.worker_id for update'));
 assert(a.indexOf('id=e.role_id for share')<a.indexOf('id=s.worker_id for update'));
 includes(a,'e.auth_user_id is distinct from',"r.status is distinct from 'active'",'where merchant_id=p_site and employee_id=e.id',"tail.action<>'clock_out'",'tail.id,coalesce(tail.sequence,0)','attendance_open_sessions');
 assert(!/role_id=|permissions=|insert into public\.merchant_enterprise/.test(a));
});
test('196 original owner recovery is minimal, full-command replay is actor bound and private material committed',()=>{
 const a=body('admin_v1');includes(a,"if not owner_now and (i.operation_id is null or i.actor_auth_user_id<>p_auth)","data_value:=jsonb_build_object('kind','receipt')",'i.command is distinct from p_command','i.command_fingerprint<>fp','commitment is distinct from i.material_commitment','commitment is distinct from p_material');
 assert(a.indexOf('i.operation_id is not null then')<a.indexOf("p_allow_new is distinct from true"));
 assert(!/salt|verifier|material_commitment/.test(body('receipt_v1')));
 includes(body('material_hash_v1'),"'attendance-independent-pin-material-v1'",'p_site,p_worker::text,p_subject::text,p_generation,p_revision,p_operation::text,p_salt,p_verifier');
});
test('196 credentials revoke advance generation/revision, retain issue identity and enable never revives PIN',()=>{
 const a=body('admin_v1');includes(a,"if a in('disable','revoke_pin','bind_member') and c.subject_id is not null",'set enabled=false,salt=null,verifier=null,revision=v_credential_revision,changed_at=stamp',"when a in('disable','revoke_pin','bind_member') then 1 else 0 end",'v_credential_revision:=v_credential_revision+1','generation=excluded.generation','v_credential_id:=coalesce(c.credential_id,gen_random_uuid())');
 const revoke=a.slice(a.indexOf("if a in('disable','revoke_pin','bind_member') and c.subject_id is not null"),a.indexOf('delete from public.merchant_attendance_independent_leases'));
 assert(!/set.*generation=|credential_id=/.test(revoke));
 includes(a,"null,p_command->>'workerNo',p_command->>'displayName',false", "'independent','independent',false,0,1");
});
test('196 new and old terminal endpoints share106 budget with cross-invalidating leases, no extra guesses',()=>{
 const b=body('begin_v1');includes(b,'faolla_attendance_terminal_device_v1','merchant_attendance_pin_attempts','for update',"stamp>=d.window_at+interval '1 minute'",'d.attempts>=60','budget_window=d.window_at and q.budget_ordinal=d.attempts','attempts=d.attempts+1,window_at=d.window_at,lease_id=null,lease_expires=null,worker_id=null,employee_id=null,credential_revision=null',"stamp>=c.window_at+interval '15 minutes'",'c.attempts>=10',"stamp+interval '30 seconds'");
 assert(b.indexOf('merchant_attendance_pin_attempts where')<b.indexOf('lower(btrim(worker_no))=lower(p_no) for update'));
 includes(body('finish_v1'),'row(q.budget_window,q.budget_ordinal) is distinct from row(d.window_at,d.attempts)','d.lease_id is not null','delete from public.merchant_attendance_independent_leases','if p_verified is distinct from true');
});
test('196 terminal auth never treats disabled/revoked/bound/geofenced subjects as safe finish',()=>{
 for(const name of ['begin_v1','finish_v1'])includes(body(name),'w.employee_id is not null',"s.state is distinct from 'independent'",'coalesce(s.enabled,false)','coalesce(c.enabled,false)','l.radius_meters is not null','deviceExpiresAt','merchant_attendance_employment_periods');
 const f=body('finish_v1');assert(f.indexOf('not coalesce(c.enabled,false)')<f.indexOf("action_name in('clock_in','break_start')"));
 includes(f,"action_name in('clock_in','break_start') and (p_allow_new is distinct from true or not config.enabled)","status_name='break'",'attendance_invalid_transition');
});
test('196 terminal clock command strictly binds public tuple and rejects null action',()=>{
 const c=body('clock_command_v1');includes(c,"p->>'action' is null",'operationId','subjectId','workerId','generation','credentialId','credentialRevision','expectedWorkerVersion','expectedSettingsVersion','locationId','expectedLocationVersion','expectedSequence','breakPaid');
 includes(body('clock_hash_v1'),"'attendance-independent-clock-command-v1',p_site,p_terminal::text");
 const f=body('finish_v1');includes(f,'x.command is distinct from command_value','row(x.subject_id,x.terminal_id,x.command_fingerprint)','expectedSequence','seq+1',"action_name,'kiosk'",'l.time_zone,null','merchant_attendance_independent_event_sources values');
 assert(f.indexOf('insert into public.merchant_attendance_events')<f.indexOf('insert into public.merchant_attendance_independent_event_sources'));
 includes(body('clock_receipt_v1'),"null::uuid,'kiosk'::text",'e.sequence is distinct from','p.command_fingerprint is distinct from','i.material_commitment is null');
});
test('196 raw report uses complete source-verified sessions, overlap dates and explicit pagination, never formal period',()=>{
 const r=body('report_v1');includes(r,'p_through-p_from not between 0 and 30',"to_at-from_at>interval '33 days'",'occurred_at<from_at','limit 27','seen=26','next_id:=last_start','limit 2003','event_count>2002 or total_events>4000','e.sequence<>previous_sequence+1','e.occurred_at<previous_at','status_name=\'completed\'',"'rangeComplete',p_cursor is null and next_id is null","'rulesAssessment','unassessed','fixedPeriodEligible',false",'1048576');
 assert(!/period_collect|period_session|verified|sum\(|generate_series|offset /i.test(r));
 includes(r,'cursor_sequence is null','e.occurred_at>=to_at','coalesce(tail.occurred_at,read_at)<=from_at','subject_id=p_subject');
 includes(body('admin_v1'),"when data_value->>'kind'='history' then data_value->'report'->>'readAt'");
 includes(body('finish_v1'),"when kind='personal' then data_value->'report'->>'readAt'");
});
test('196 storage proof verifies source/command/entry and append-only fact tables cannot mutate',()=>{
 const g=body('guard_v1');includes(g,"if tg_op<>'INSERT'",'faolla_attendance_independent_clock_receipt_v1(new)','faolla_attendance_independent_admin_hash_v1','new.subject_revision,new.generation,new.worker_version','new.command->>\'expectedSubjectRevision\'',"new.action='create'",'i.command->>\'targetAuthUserId\'',"e.actor_employee_id is not null");
 assert(!/update public|delete from public/.test(g));
});
test('196 manifest parser understands exact named checks and quoted comma without flattening expressions',()=>{
 assert.deepEqual(independentSplit("a,check(x in('a,b','c')),z"),['a',"check(x in('a,b','c'))",'z']);assert.deepEqual(independentSplit(''),[]);
 assert.throws(()=>independentSplit('check(a, b'));
 assert(manifest.tables.every(t=>t.constraints.every(c=>c.kind==='c'?typeof c.expression==='string':Array.isArray(c.keys))));
});
test('196 CHECK canonicalization preserves literal/regexp contents and only known deparse syntax',()=>{
 const n=independentCheckNormalize;
 assert.equal(n("(state = ANY (ARRAY['independent'::text, 'bound'::text]))"),n("state=any(array['independent','bound'])"));
 assert.equal(n("((revision >= (1)::bigint) AND (revision <= '9007199254740990'::bigint))"),n('revision>=1 and revision<=9007199254740990'));
 const expression="salt~'^[0-9a-f]{32}$'";
 for(const changed of ["salt~'^0-9a-f{32}$'","salt~'^[0-9A-F]{32}$'","salt~'^[0-9a-f]{31}$'","salt~'^[0-9a-f]{32}$::text'","salt!~'^[0-9a-f]{32}$'"])assert.notEqual(n(expression),n(changed));
 assert.notEqual(n("state='bound'"),n("state='BOUND'"));assert.notEqual(n("x::name[]"),n('x'));
 assert.equal(n("convert_to(v::text,'UTF8'::name)"),n("convert_to(v,'UTF8')"));
 assert.equal(n(null),null);
});
