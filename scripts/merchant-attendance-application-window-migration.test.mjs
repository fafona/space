//194 pure/static only; actual PostgreSQL verification is owned by the root runner.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const dir=new URL('./supabase-migrations/',import.meta.url);
const sql=readFileSync(new URL('202610080194_merchant_attendance_application_window.sql',dir),'utf8').replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(s).digest('hex');
const funcs=[...sql.matchAll(/^create or replace function public\.(\w+)\(([\s\S]*?)\)\nreturns ([^\n]+) as \$\$([\s\S]*?)\$\$;/gm)];
const body=name=>{const f=funcs.find(f=>f[1]===`faolla_attendance_${name}`);assert(f,name);return f[4];};
const includes=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const recipes=JSON.parse(sql.match(/\$window_recipes\$([\s\S]*?)\$window_recipes\$/)[1]);
const core=new Map();
const pre=sql.slice(sql.indexOf('do $window_preflight$'),sql.indexOf('$window_preflight$;'));
const post=sql.slice(sql.indexOf('do $window_postconditions$'),sql.indexOf('$window_postconditions$;'));
for(const r of recipes){
 const original=readFileSync(new URL(r.file,dir),'utf8').replaceAll('\r\n','\n').match(new RegExp('create(?: or replace)? function public\\.'+r.name+'\\s*\\([\\s\\S]*?\\)\\s*returns jsonb\\s*language plpgsql security definer set search_path=pg_catalog as \\$\\$([\\s\\S]*?)\\$\\$;','i'))?.[1];
 assert(original,r.name);assert.equal(sha(original),r.originalHash,r.name+' actual historical body pin');let transformed=original;
 for(const c of r.changes){assert.equal(transformed.split(c.from).length-1,c.count);transformed=transformed.replaceAll(c.from,c.to);}
 assert.equal(sha(transformed),r.coreHash);assert.equal(sha(r.wrapper),r.wrapperHash);core.set(r.core,transformed);
}
test('194 adds exactly two ledgers and four pinned original wrappers, no unrelated consumer',()=>{
 assert.equal((sql.match(/^create table if not exists /gm)||[]).length,2);assert.equal(funcs.length,12);assert.equal(recipes.length,4);
 assert.deepEqual(recipes.map(r=>r.name),['faolla_attendance_correction_self_v2','faolla_attendance_revision_self_v1','faolla_attendance_revision_self_v2','faolla_attendance_missing_v1']);
 assert(funcs.every(f=>/^faolla_attendance_(application_window|operational_consumer)_/.test(f[1])));
 includes(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080194,'merchant_attendance_application_window')");
 assert(sql.trim().endsWith('commit;'));assert.doesNotMatch(sql,/--194_|disable trigger|session_replication_role|set_config\(|current_setting\(|drop (?:table|function)|alter table public\.merchant_attendance_settings/i);
 assert.doesNotMatch(funcs.map(f=>f[4]).join('\n'),/update public\.|delete from public\.|truncate public\./i);
});
test('original source and signature metadata pins hold before install/reentry and after forward replacement',()=>{
 for(const r of recipes)for(const b of [pre,post])includes(b,r.originalHash,r.wrapperHash,r.name,'info.proargnames','info.pronargdefaults<>2');
 const extraction=sql.slice(sql.indexOf('do $window_extract$'),sql.indexOf('$window_extract$;'));
 includes(extraction,'pg_get_function_arguments(p.oid)',"r->>'coreHash'","r->>'originalHash'","r->>'wrapperHash'",'occurrences is distinct from',
  'p_managed boolean default false','create or replace function %I.%I(%s)','where version=202610080194) then return');
 assert.doesNotMatch(extraction,/alter function|grant |revoke |drop function/i);
});
test('all twelve own bodies plus four generated cores are pinned and private by default',()=>{
 for(const f of funcs)for(const b of [pre,post])includes(b,f[1],sha(f[4]));
 for(const r of recipes)for(const b of [pre,post])includes(b,r.core,r.coreHash);
 includes(pre,'when installed then 16 else 0','if not installed then return');includes(post,'<>16');
 for(const b of [pre,post])includes(b,'info.proowner is distinct from expected_owner','info.proconfig is distinct from',"has_function_privilege('anon'",'is distinct from expected.is_rpc');
 const grants=[...sql.matchAll(/^grant execute on function public\.(\w+)/gm)].map(m=>m[1]);
 assert.deepEqual(grants,['faolla_attendance_operational_consumer_activation_v1','faolla_attendance_application_window_v1']);
 includes(sql,'revoke all on function %s from public,anon,authenticated,service_role');
});
test('reentry checks table ACL/RLS/trigger/columns before any creation or security repair',()=>{
 assert(sql.indexOf('$window_preflight$;')<sql.indexOf('create or replace function'));
 for(const b of [pre,post])includes(b,'relrowsecurity and not relforcerowsecurity','from pg_policy where polrelid=t','attisdropped or not attnotnull',
  'application_window_immutable','tgtype=27','application_window_no_truncate','tgtype=34','tgdeferrable and tginitdeferred',
  "has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",'a.grantee<>expected_owner');
 includes(sql,"where version=202610080194) then return;end if;\n for f in",'create constraint trigger application_window_proof');
 assert(funcs.find(f=>f[1].endsWith('_guard_v1'))[3].includes('security definer'));
});
test('shared activation has consumer/actor/full-command binding and only implemented window can activate',()=>{
 const b=body('operational_consumer_activation_v1');
 includes(b,"kind<>'application_window' or not p_allow_activate or not s.enabled",'saved.consumer<>kind','saved.actor_auth_user_id<>p_auth_user_id','saved.command is distinct from p_command',
  "mode_name='recover'","'current',null","'canActivate',false,'canDeactivate',false");
 assert(b.indexOf("if mode_name='recover' then")<b.indexOf('from public.merchants'));
 includes(body('operational_consumer_command_v1'),"'attendance-operational-consumer-activation-command-v1',p_site,p_consumer,p_actor");
 assert.doesNotMatch(b,/application_window_core_|operational_source_v1/);
});
test('legacy gates are only inside fresh submit branches; withdrawal and existing operation remain original',()=>{
 for(const r of recipes){const b=core.get(r.core);assert.equal((b.match(/application_window_gate_v1/g)||[]).length,1);}
 const correction=core.get(recipes[0].core);includes(correction,"p_command->>'action'='submit' and not old_operation");
 for(const r of recipes.slice(1,3)){const b=core.get(r.core);assert(b.indexOf('receipt.revision is not null')<b.indexOf('application_window_gate_v1'));
  assert(b.lastIndexOf("p_command->>'action'='submit'",b.indexOf('application_window_gate_v1'))>=0);}
 const missing=core.get(recipes[3].core);assert(missing.indexOf('receipt.operation_id is not null')<missing.indexOf('application_window_gate_v1'));
 includes(body('application_window_gate_v1'),"h.action='activate'",'protocol_required');
});
test('prepare is bounded scalar GET; new commands retain strict old proposal and old-specific tuple',()=>{
 const q=body('application_window_query_v1'),c=body('application_window_command_v1');
 includes(q,'>4096',"'proposedStartAt'","'supersedesRequestId'",'not between 0 and 30');
 assert.doesNotMatch(q,/proposal|jsonb_array_elements/);
 includes(c,'>16384',"array['command','expectedWindowFingerprint']",'faolla_attendance_correction_proposal_v1',"'expectedEffectiveOperationId'",'proposal is distinct from');
 includes(c,"c->'proposal'->'startAt' is distinct from p_query->'proposedStartAt'", "'attendance-application-window-command-v1',p_actor,q,t");
 includes(c,"case when k='expectedRevision' then 9007199254740988 else 9007199254740989 end");
});

test('deactivation cannot extend a captured root deadline; legacy revision gates point-read fixed proof only',()=>{
 const b=body('application_window_gate_v1');
 includes(b,'x.merchant_id=p_site and x.operation_id=p_root','application_window_proof_v1(root_proof)',
  "p_at>=(root_proof.window_snapshot->>'effectiveDeadlineAt')::timestamptz","raise exception 'attendance_correction_window_expired'");
 assert(b.indexOf("p_at>=(root_proof.window_snapshot")<b.indexOf('if p_managed then return'));
 assert(b.indexOf('if p_managed then return')<b.indexOf('order by x.revision desc limit 1'));
 assert.doesNotMatch(b,/operational_source_v1\(|insert into|update |delete from/i);
 for(const r of recipes.slice(1,3)){
  const c=core.get(r.core),gate=c.indexOf('application_window_gate_v1');
  includes(c,'application_window_gate_v1(p_site_id,p_managed,base.request_id,now_at)');
  assert(c.lastIndexOf('now_at:=clock_timestamp()',gate)>=0);
  assert(gate<c.indexOf("if rules->'issues' ? 'window_expired'"));
 }
 const c=core.get(recipes[3].core),gate=c.indexOf('application_window_gate_v1');
 includes(c,'application_window_gate_v1(site,p_managed,target.root_request_id,now_at)');
 assert(c.lastIndexOf('now_at:=clock_timestamp()',gate)>=0);
 assert(gate<c.indexOf('if now_at>=target.deadline_at'));
 includes(core.get(recipes[0].core),'application_window_gate_v1(p_site_id,p_managed,null,null)');
});
test('real legacy read/write uses v3 correction decoration, v2 cycles and missing without owner spoof',()=>{
 const b=body('application_window_v1');includes(b,'faolla_attendance_decision_decorate_v1','application_window_core_correction_v1',
  'application_window_core_revision_v2','application_window_core_missing_v1',"'access','self'",'rev.actor_auth_user_id<>p_auth_user_id');
 assert.doesNotMatch(b,/owner_checked|user_id.*into.*p_auth|application_window_core_revision_v1\(/);
 includes(b,"app->'basis'->'events'->0->>'occurredAt'","app->'detail'->'lineage'->'canRevise'",'missing.submitted_at');
});
test('exact original operation is recovered before any current source or membership with no reauthorization masquerade',()=>{
 const b=body('application_window_v1');const early=b.slice(0,b.indexOf("wid:=(p_query->>'workerId')"));
 includes(early,'proof.family<>f','proof.actor_auth_user_id<>p_auth_user_id','proof.query is distinct from p_query','proof.command is distinct from p_command',
  "'application',null,'window',null,'receipt',receipt),'source',null)");
 assert.doesNotMatch(early,/from public\.merchants|operational_source_v1\(|settings|employee.*for share/);
 includes(b,'A legacy operation never gains a synthetic new proof','merchant_attendance_correction_entries','merchant_attendance_revision_requests','merchant_attendance_missing_entries');
});
test('new submission, authoritative source at actual submit time, and compact proof are one atomic scope',()=>{
 const b=body('application_window_v1');
 assert(b.indexOf('application_window_core_missing_v1')<b.indexOf('facts:=public.faolla_attendance_application_window_facts_v1'));
 assert(b.indexOf('facts:=public.faolla_attendance_application_window_facts_v1')<b.indexOf('src:=public.faolla_attendance_operational_source_v1'));
 assert(b.indexOf('src:=public.faolla_attendance_operational_source_v1')<b.indexOf('insert into public.merchant_attendance_application_window_proofs'));
 includes(b,"at_value:=(facts->>'recordedAt')",'attendance_application_window_changed','attendance_application_window_expired',"h.action is distinct from 'activate'",'operational_punch_source_ref_v1(src)');
 assert.doesNotMatch(b,/when others|exception when check_violation|return jsonb_build_object\('error'/);
});
test('window is min of old independent policy, selected days, and fixed root proof, not current proposal anchor',()=>{
 const b=body('application_window_value_v1');includes(b,"array['personal','group','enterprise']","choice_value->>'mode'='disabled'",'attendance_correction_policy_required',
  'effective:=least(deadline,extra,root_limit)',"baseline->>'timeZone'",'p_activation,t-3');
 assert.doesNotMatch(b,/interval '24 hours'|coalesce\(days,[1-9]|update|delete/i);
 includes(body('application_window_proof_v1'),'root_proof.family not in',"root_proof.window_snapshot->>'rootRequestId' is not null",'expected is distinct from p.window_snapshot',
  'x.revision=activation.revision+1 and x.recorded_at<=p.recorded_at');
 includes(body('application_window_facts_v1'),"c.basis->'events'->0->>'occurredAt'",'m.root_request_id','x.root_request_id is null');
});
test('proof validation restores immutable source points, full original command and actor; never today source',()=>{
 const b=body('application_window_proof_v1');includes(b,'operational_punch_saved_source_v1(p.source_ref)',"facts->'command' is distinct from p.command->'command'",'p.actor_auth_user_id<>p.employee_auth_user_id',
  'p.command_fingerprint is distinct from',"src->>'at' is distinct from facts->>'recordedAt'",'p.recorded_at>=');
 assert.doesNotMatch(b,/operational_source_v1\(|group_assignments|order by/);
 includes(body('application_window_v1'),'>524288','>262144');
});
test('PG expression regression guards cover CASE and JSON key deletion precedence',()=>{
 const text=funcs.map(f=>f[4]).join('\n');
 assert.doesNotMatch(text,/\bif\s+[^\n;]*(?:[><=]|is distinct from)\s*case\b/i);
 assert.doesNotMatch(text,/->\s*'(?:[^']|'')*'\s*-(?!>)/);
 assert.doesNotMatch(text,/\bwindow\s+jsonb\s+not null/i);
 const source=['p','site',['identity'],'at',['settings'],null,[null,null,null],['baseline']];
 assert.deepEqual([...source.slice(0,3),...source.slice(4)],['p','site',['identity'],['settings'],null,[null,null,null],['baseline']]);
 assert.notDeepEqual([...source.slice(0,3),...source.slice(4)],[...source.slice(0,3),null,...source.slice(4)]);
});
