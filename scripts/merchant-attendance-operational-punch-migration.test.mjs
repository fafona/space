//242 static/pure only. No database, server, browser or dependency installation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const directory=new URL('./supabase-migrations/',import.meta.url);
const sql=readFileSync(new URL('202610080193_merchant_attendance_operational_punch.sql',directory),'utf8').replaceAll('\r\n','\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const funcs=[...sql.matchAll(/^create or replace function public\.([a-z0-9_]+)\(([\s\S]*?)\)\nreturns ([^\n]+) as \$\$([\s\S]*?)\$\$;/gm)];
const body=suffix=>{const f=funcs.find(x=>x[1]==='faolla_attendance_operational_punch_'+suffix);assert(f,suffix);return f[4];};
const includes=(s,...parts)=>parts.forEach(part=>assert(s.includes(part),part));
const pre=sql.slice(sql.indexOf('do $punch_preflight$'),sql.indexOf('$punch_preflight$;'));
const post=sql.slice(sql.indexOf('do $punch_postconditions$'),sql.indexOf('$punch_postconditions$;'));
const recipes=JSON.parse(sql.match(/\$punch_recipes\$([\s\S]*?)\$punch_recipes\$/)[1]);
const cores=new Map();
for(const r of recipes){
 const source=readFileSync(new URL(r.file,directory),'utf8').replaceAll('\r\n','\n');
 const re=new RegExp('create(?: or replace)? function public\\.'+r.name+'\\s*\\([\\s\\S]*?\\)\\s*returns [\\s\\S]*? as \\$\\$([\\s\\S]*?)\\$\\$;','i');
 const original=source.match(re)?.[1];assert(original,r.name);assert.equal(hash(original),r.originalHash,r.name+' reviewed legacy source pin');
 let changed=original;
 for(const replacement of r.changes){assert(replacement.from);assert.equal(changed.split(replacement.from).length-1,replacement.count,r.name+' exact replacement cardinality');changed=changed.split(replacement.from).join(replacement.to);}
 if(r.core){assert.equal(hash(changed),r.coreHash,r.name+' transformed shared core');assert.equal(hash(r.wrapper),r.wrapperHash);cores.set(r.core,changed);}
 else {assert.equal(changed,r.wrapper);assert.equal(hash(changed),r.wrapperHash);cores.set(r.name,changed);}
}
const core=suffix=>{const v=cores.get('faolla_attendance_operational_punch_core_'+suffix);assert(v,suffix);return v;};

test('193 is one additive transaction: three proof tables and exactly six approved old signatures',()=>{
 assert.equal(funcs.length,34);assert.equal(recipes.length,6);
 assert.deepEqual(recipes.map(r=>r.name),['faolla_attendance_self_v1','faolla_attendance_pin_clock_v1','faolla_attendance_onsite_clock_v1','faolla_attendance_location_clock_v1','faolla_attendance_location_clock_v2','faolla_attendance_pin_schedule_v1']);
 assert.equal((sql.match(/^create table if not exists public\.merchant_attendance_operational_punch_/gm)||[]).length,3);
 assert(funcs.every(f=>f[1].startsWith('faolla_attendance_operational_punch_')));
 includes(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080193,'merchant_attendance_operational_punch')");
 assert(sql.trim().endsWith('commit;'));
 assert.doesNotMatch(sql,/--PUNCH_|create (?:extension|index)|drop (?:table|function|index)|set_config\(|current_setting\(|disable trigger|session_replication_role|alter table public\.merchant_attendance_settings/i);
 assert.doesNotMatch(funcs.map(f=>f[4]).join('\n'),/update public\.|delete from public\.|truncate public\./i);
});

test('original pins, exact replacements and transformed pins preserve old defaults/OID/ACL without arbitrary future copying',()=>{
 const extraction=sql.slice(sql.indexOf('do $punch_extract$'),sql.indexOf('$punch_extract$;'));
 includes(extraction,"pg_get_function_arguments(p.oid)","old_hash is distinct from r->>'originalHash'","actual_count is distinct from (c->>'count')::integer",
  "r->>'coreHash'","r->>'wrapperHash'","create or replace function %I.%I(%s)","p_intent jsonb default null",'if exists(select 1 from public.faolla_schema_migrations where version=202610080193) then return');
 for(const r of recipes.filter(x=>x.core))assert.equal(r.wrapper.trim().split('\n').length,3);
 for(const r of recipes){includes(pre,r.originalHash,r.wrapperHash);includes(post,r.originalHash,r.wrapperHash);}
 assert.doesNotMatch(extraction,/drop function|alter function|revoke |grant /i);
});

test('own and shared-core source hashes are checked both before reentry and after installation',()=>{
 for(const f of funcs)for(const block of [pre,post])assert(block.includes("('public."+f[1]+"(")&&block.includes("'"+hash(f[4])+"'"),f[1]);
 for(const r of recipes.filter(x=>x.core))for(const block of [pre,post])includes(block,r.core,r.coreHash);
 for(const block of [pre,post])includes(block,'info.proowner is distinct from expected_owner','info.proconfig is distinct from',
  'info.proretset or info.proisstrict or info.proleakproof','info.pronargdefaults<>expected.defaults','info.proargnames',
  "has_function_privilege('anon',f,'EXECUTE')","has_function_privilege('authenticated',f,'EXECUTE')",'is distinct from expected.is_rpc');
 includes(pre,'when installed then 39 else 0','if not installed then return');includes(post,"operational_punch_%')<>39");
 assert(sql.indexOf('$punch_preflight$;')<sql.indexOf('create or replace function'));
 assert.doesNotMatch(pre,/E'\\\\r\\\\n'/);
 for(const f of funcs){const scoped=f[4].replaceAll('public.','attendance_native_242.');assert.equal(hash(scoped.replaceAll('attendance_native_242.','public.')),hash(f[4]));}
});

test('five actual private source dependencies are pinned and the existing reverse clock-in index is checked',()=>{
 const dependencySql=readFileSync(new URL('202610080192_merchant_attendance_operational_source.sql',directory),'utf8').replaceAll('\r\n','\n');
 const dependencies=[...dependencySql.matchAll(/^create or replace function public\.(\w+)\(([\s\S]*?)\)\nreturns ([^\n]+) as \$\$([\s\S]*?)\$\$;/gm)];
 assert.equal(dependencies.length,5);for(const f of dependencies)includes(pre,f[1],hash(f[4]));
 includes(pre,'attendance_report_clock_in_idx','idx.indisvalid','idx.indisready','idx.indislive',"array['merchant_id','worker_id','occurred_at','sequence']",
  "(action = ''clock_in''::text)","has_function_privilege('service_role',f,'EXECUTE')");
 assert.doesNotMatch(pre,/20261008018[89]|202610080190/);
});

test('five public service RPCs only; private cores/helpers and proof tables have no client-role authority',()=>{
 const grants=[...sql.matchAll(/^grant execute on function public\.(\w+)\([^\n]* to service_role;/gm)].map(x=>x[1]);
 assert.deepEqual(grants,['faolla_attendance_operational_punch_activation_v1','faolla_attendance_operational_punch_self_v1','faolla_attendance_operational_punch_location_v1','faolla_attendance_operational_punch_pin_v1','faolla_attendance_operational_punch_onsite_v1']);
 includes(sql,'revoke all on function %s from public,anon,authenticated,service_role','revoke all on %s from public,anon,authenticated,service_role');
 for(const block of [pre,post])includes(block,'relrowsecurity and not relforcerowsecurity','from pg_policy where polrelid=t',
  'operational_punch_immutable','operational_punch_no_truncate','operational_punch_proof','tgdeferrable and tginitdeferred',
  "has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",'acl.grantee<>expected_owner');
 assert(funcs.find(f=>f[1].endsWith('_guard_v1'))[3].includes('security definer'));
});

test('activation defaults off, locks current owner then settings, and recovers original actor without fresh ownership',()=>{
 const b=body('activation_v1');
 includes(b,"mode_name='recover'",'x.actor_auth_user_id=p_auth_user_id',"'current',null",'owner_id is distinct from p_auth_user_id',
  "p_command->>'action'='activate' and (not p_allow_activate or not s.enabled)","coalesce(head.action,'deactivate')",'saved.command is distinct from p_command');
 assert(b.indexOf("if mode_name='recover' then\n  select")<b.indexOf('from public.merchants'));
 assert(b.indexOf('from public.merchants')<b.indexOf('for update'));
 includes(b,'can_activate boolean:=false;can_deactivate boolean:=false','else can_activate:=p_allow_activate',"stamp:=date_trunc('milliseconds',clock_timestamp())");
 assert.doesNotMatch(b,/update |delete |set_config|member.*permission/i);
});

test('four actual channel credential bodies remain shared; new intent does not impersonate owner',()=>{
 includes(core('self_v1'),"'attendance.self.clock'",'p_auth_user_id');
 includes(core('pin_v1'),'faolla_attendance_pin_finish_v1(p_site,p_terminal,p_secret_hash,p_no,p_lease,p_verified,true)');
 includes(core('onsite_v1'),'w.default_location_id is distinct from loc_now');
 includes(core('location_v2'),'faolla_attendance_operational_punch_core_location_v1');includes(core('location_v1'),'internalFence','internalPolicyFingerprint');
 includes(body('before_v1'),"p_channel='pin' and p_actor is not null","p_channel<>'pin' and p_actor is distinct from e.auth_user_id");
 assert.doesNotMatch(funcs.map(f=>f[4]).join('\n'),/owner_checked|set_config|current_setting|auth\.uid\(/);
});

test('legacy fresh start and managed break are gated but old finish/read receipts remain original',()=>{
 const b=body('legacy_gate_v1');includes(b,"if p_action='clock_in'", "h.action='activate'", "elsif p_action='break_start'",'merchant_attendance_operational_punch_sessions');
 assert.doesNotMatch(b,/clock_out|break_end|source_v1\(/);
 includes(b,'if p_receipt is not null',"raise exception 'attendance_operational_punch_protocol_required'");
 for(const k of ['self_v1','pin_v1','onsite_v1','location_v1'])includes(core(k),'operational_punch_before_v1','operational_punch_replay_v1');
 const bypass=cores.get('faolla_attendance_pin_schedule_v1');includes(bypass,'operational_punch_legacy_gate_v1(p_site,w.id,action_now,null)','operational_punch_legacy_gate_v1(p_site,w.id,action_now,receipt.id)',"if sqlerrm in ('attendance_operational_punch_protocol_required'");
});

test('PIN finish is consumed once before business; new proof AND full output validation remain within business rollback',()=>{
 const b=core('pin_v1');assert.equal((b.match(/:=public\.faolla_attendance_pin_finish_v1\(/g)||[]).length,1);
 const finish=b.indexOf('checked:=public.faolla_attendance_pin_finish_v1'),business=b.indexOf('\n  begin\n',finish),caught=b.indexOf('exception when raise_exception then');
 assert(finish>=0&&business>finish&&caught>business);
 for(const call of ['operational_punch_before_v1','operational_punch_record_v1','operational_punch_result_v1']){const at=b.indexOf(call);assert(at>business&&at<caught,call);}
 for(const code of ['changed','disabled','channel_denied','location_denied','break_type_denied'])includes(b.slice(caught),"'attendance_operational_punch_"+code+"'");
 assert.doesNotMatch(b.slice(caught),/when others|check_violation|foreign_key_violation|query_canceled|lock_not_available/);
 includes(b.slice(caught),'end if;raise;');
 assert.doesNotMatch(body('pin_v1'),/pin_finish_v1|exception when|operational_punch_result_v1/);
});

test('breakPaid is decided before the event INSERT, never patched after the immutable fact',()=>{
 for(const k of ['self_v1','pin_v1','onsite_v1','location_v1']){const b=core(k);assert(b.indexOf('op_decision:=public.faolla_attendance_operational_punch_before_v1')<b.indexOf('insert into public.merchant_attendance_events'));
  includes(b,"(op_decision->>'breakPaid')::boolean");assert.doesNotMatch(b,/update public\.merchant_attendance_events/);}
 const b=body('before_v1');includes(b,"b->'value'->>'selection'='explicit'","q->'breakType'='null'::jsonb","q->'breakType'<>'null'::jsonb", "(sess->'legacy'->>'webBreakPaid')::boolean", "q->>'kind'<>'legacy_break'");
 const breaks=b.slice(b.indexOf(' else\n  sid:='));assert.doesNotMatch(breaks,/operational_source_v1|operational_punch_policy_v1|allowOperationalStart/);
});

test('start computes source after channel locks and binds policy CAS, actual location, and declared optional slot',()=>{
 const b=body('before_v1');includes(b,"p_intent->'allowOperationalStart' is distinct from 'true'",'operational_punch_policy_v1(p_site,p_channel,p_worker,p_employee,e.auth_user_id,p_location,p_at',
  "q->'expectedPolicyFingerprint' is distinct from policy_value->'policyFingerprint'",'attendance_operational_punch_channel_denied','attendance_operational_punch_location_denied',
  "b->>'state'='disabled'","b->'value'='\"unplanned\"'::jsonb");
 const b2=body('policy_hash_v1');includes(b2,'t->2,t->4,t->5,t->6,t->7');assert.doesNotMatch(b2,/t->3/);
 for(const k of ['self_v1','location_v1','pin_v1','onsite_v1'])assert(body(k).indexOf('operational_punch_lock_v1')<body(k).indexOf('operational_punch_core_'));
});

test('saved source reconstructs only three immutable publication points and one baseline point,never current selector',()=>{
 const b=body('saved_source_v1');includes(b,"array['enterprise','group','personal']",'x.operation_id=(v->>\'operationId\')::uuid',"o.action<>'publish'",'operational_rule_item_v1(o)',
  "baseline.action<>'set_policy'",'operational_source_tuple_v1(r)','sourceFingerprint');
 assert.doesNotMatch(b,/operational_source_v1\(|operational_source_layer_v1|group_assignments|operational_rule_publications|order by|limit |current_setting/);
 includes(body('source_ref_v1'),"jsonb_build_object('operationId',v->'operationId','revision',v->'revision')");
});

test('sidecar proof is tied to full actual command,actor,target,origin,latest bounded session and INSERT-time type',()=>{
 const b=body('operation_v1');includes(b,'latest_start is distinct from p.start_event_id','row(x.occurred_at,x.sequence)<=row(ev.occurred_at,ev.sequence)',
  'order by x.occurred_at desc,x.sequence desc limit 1','p.origin_ref is distinct from','origin_command is distinct from',
  "(c->'clock')-'expectedWorkerId'", "'attendance-operational-punch-command-v1'",'ev.break_paid is distinct from paid');
 includes(body('replay_v1'),"saved.command is distinct from p_intent->'command'","v->>'employeeAuthUserId' is distinct from current_auth::text");
 includes(body('session_v1'),"src->>'at' is distinct from v->>'occurredAt'", "h.action is distinct from 'activate'",'operational_punch_session_hash_v1',"v->'fields' is distinct from");
});

test('read prepares one own-current snapshot,GET recover remains minimal,and location private assertion evidence stays internal',()=>{
 const b=body('result_v1');const recover=b.slice(b.indexOf("if p_query->>'mode'='recover' then"),b.indexOf('\n else\n  select * into s'));
 assert.doesNotMatch(recover,/operational_source_v1|operational_punch_policy_v1|can_start:=true|can_break:=true|can_finish:=true/);
 includes(recover,'if p_command is not null and operation_value',"p_channel='pin' and op.origin_ref->>'terminalId'",'merchant_attendance_schedule_cancellations');
 includes(b,"'clock',p_clock-'_operationalDecision'",'can_start boolean:=false;can_break boolean:=false;can_finish boolean:=false',"bundle:=jsonb_build_object('result',result_value,'source',source_value)",'>262144');
 assert.doesNotMatch(b,/-'internalFence'|-'internalPolicyFingerprint'|select cancelled from/);
});

test('bounded schedule selection shares old actual publication and adoption validators,without choosing a nearest slot',()=>{
 includes(body('record_selection_v1'),'faolla_attendance_self_schedule_slot_v1(slot)','faolla_attendance_shift_plan_adoption_v1(rel,p_auth,null,true,p_channel)',
  'slot.employee_id is distinct from p.actor_employee_id',"employeeAuthUserId",'outside_window','publication_missing');
 includes(body('choices_v1'),'limit 101','limited:=cardinality(candidates)>100','if not limited then','>48000',"'{entries}','[]'");
 assert.doesNotMatch(body('record_selection_v1'),/order by|limit 1|update |delete /i);
});

test('finite compact proof bounds include worst-shaped four-fields and three origins without raising older budgets',()=>{
 const id=n=>`24200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const locations=Array.from({length:25},(_,i)=>id(i+1));
 const values={allowedChannels:['self','location','pin','onsite'],locationScope:locations,shiftSource:'published_selection',breakTypes:{allowed:['paid','unpaid'],selection:'explicit'}};
 const fields=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{state:'value',value,sources:['personal','group','enterprise'],trace:['personal','group','enterprise'].map(layer=>({layer,choice:{mode:'value',value}}))}]));
 const origins=['enterprise','group','personal'].map(layer=>({layer,operationId:id(100),revision:9007199254740990,effectiveAt:'2026-10-08T00:00:00.000000Z',endsAt:'2099-12-31T00:00:00.000000Z',rulesFingerprint:'f'.repeat(64),referenceFingerprint:'e'.repeat(64)}));
 const session={startEventId:id(200),operationId:id(201),startSequence:9007199254740990,occurredAt:'2026-10-08T00:00:00.000000Z',workerId:id(1),employeeId:id(2),employeeAuthUserId:id(3),actorAuthUserId:id(3),channel:'location',locationId:id(4),locationVersion:9007199254740990,activationRevision:9007199254740990,sourceFingerprint:'a'.repeat(64),policyFingerprint:'b'.repeat(64),sessionFingerprint:'c'.repeat(64),fields,origins,legacy:{settingsVersion:9007199254740990,webBreakPaid:true,scheduleEnabled:true},selection:{slotId:id(5),revision:9007199254740990}};
 const conservativeBytes=Buffer.byteLength(JSON.stringify(session))+JSON.stringify(session).split(/[,:]/).length;assert(conservativeBytes+16384<32768);
 includes(sql,'<=16384','<=32768');assert.doesNotMatch(sql,/67108864|8388608|update public\.merchant_attendance_period|alter table public\.merchant_attendance_period/i);
});

test('JSON extraction is grouped before key deletion, including the otherwise unselected channel CASE arm',()=>{
 const unsafe=/->\s*'(?:[^']|'')*'\s*-(?!>)/;
 assert.match("c->'clock'-'expectedWorkerId'",unsafe);
 assert.doesNotMatch("(c->'clock')-'expectedWorkerId'",unsafe);
 for(const f of funcs)assert.doesNotMatch(f[4],unsafe,f[1]);
 for(const [name,b]of cores)assert.doesNotMatch(b,unsafe,name);
 includes(body('operation_v1'),"case when p.channel='location' then (c->'clock')-'expectedWorkerId' else c->'clock' end");
});

test('PLpgSQL CASE comparisons stay parenthesized and no unknown error is relabeled as a definite refusal',()=>{
 assert.doesNotMatch(funcs.map(f=>f[4]).join('\n'),/\bif\s+[^\n;]*(?:[><=]|is distinct from)\s*case\b/i);
 assert.doesNotMatch(funcs.map(f=>f[4]).join('\n'),/when others|when check_violation|when foreign_key_violation|when query_canceled|when lock_not_available/i);
 includes(body('policy_v1'),"sqlerrm='attendance_operational_source_too_large'", "sqlerrm='attendance_operational_source_invalid'",'end if;raise;');
 const contract=readFileSync(new URL('../docs/employee-attendance-operational-punch-consumer-boundary-20261008.md',import.meta.url),'utf8');
 includes(contract,'本次实际 POST','原槽精确字节','不自动清除','GET 均不能重获','未知约束/连接错误');
});
