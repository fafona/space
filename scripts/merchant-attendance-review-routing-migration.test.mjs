//198 bounded source/static tests. No PostgreSQL, browser or production execution.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import test from 'node:test';
const dir=new URL('./supabase-migrations/',import.meta.url);
const filename='202610080198_merchant_attendance_review_routing.sql';
const sql=readFileSync(new URL(filename,dir),'utf8').replaceAll('\r\n','\n');
const sha=s=>createHash('sha256').update(s).digest('hex');
const parse=s=>[...s.replaceAll('\r\n','\n').matchAll(/create(?: or replace)? function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([^\s]+)\s+([\s\S]*?)\bas\s+\$\$([\s\S]*?)\$\$;/gi)]
 .map(m=>({name:m[1],args:m[2],type:m[3],header:m[4],body:m[5]}));
const funcs=parse(sql),body=n=>{const f=funcs.find(f=>f.name===`faolla_attendance_review_routing_${n}`);assert(f,n);return f.body;};
const block=n=>{const m=sql.match(new RegExp(`do \\$${n}\\$([\\s\\S]*?)\\$${n}\\$;`));assert(m,n);return m[1];};
const stages=['routing_preflight','routing_index_ready','routing_postconditions'].map(block);
const includes=(s,...parts)=>parts.forEach(p=>assert(s.includes(p),p));
const history=new Map();
for(const file of readdirSync(dir).filter(f=>/^\d+_/.test(f)&&f<'202610080195').sort())for(const f of parse(readFileSync(new URL(file,dir),'utf8')))history.set(f.name,{...f,file});

test('198 is additive: two tables, sixteen isolated functions and one exact old-body recipe',()=>{
 assert.equal((sql.match(/^create table if not exists /gm)||[]).length,2);assert.equal(funcs.length,16);
 assert(funcs.every(f=>f.name.startsWith('faolla_attendance_review_routing_')));
 assert.equal((sql.match(/^create index concurrently if not exists /gm)||[]).length,3);
 assert.equal((sql.match(/^create index if not exists /gm)||[]).length,1);
 includes(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'","values(202610080198,'merchant_attendance_review_routing')");
 assert(sql.trim().endsWith('commit;'));
 assert.doesNotMatch(sql,/--198_|disable trigger|session_replication_role|set_config\(|current_setting\(|drop (?:table|function|trigger)|alter table public\.merchant_attendance_settings/i);
 assert.doesNotMatch(funcs.map(f=>f.body).join('\n'),/delete from public\.|truncate public\.|update public\.(?!merchant_attendance_review_responsibility_heads\b)/i);
});

test('all actual new function bodies and signatures are pinned at three installation boundaries',()=>{
 for(const f of funcs)for(const s of stages)includes(s,f.name,sha(f.body));
 for(const s of stages)includes(s,'when installed then 16 else 0','info.proargnames','info.pronargdefaults<>expected.defaults',
  'info.proowner is distinct from expected_owner','info.proconfig is distinct from',"ns||'.','pub'||'lic.'",'info.proretset or info.proisstrict or info.proleakproof');
 assert(sql.indexOf('$routing_preflight$;')<sql.indexOf('create index concurrently'));
 assert(sql.indexOf('$routing_index_ready$;')<sql.indexOf('create table'));
});

test('old dependency pins derive from frozen earlier source, not a new helper comparing itself',()=>{
 const own=new Set(funcs.map(f=>f.name));let count=0;
 for(const m of stages[0].matchAll(/\('public\.(faolla_\w+)\([^']*\)','([0-9a-f]{64})'/g)){
  if(own.has(m[1]))continue;const old=history.get(m[1]);assert(old,m[1]);assert.equal(sha(old.body),m[2],`${m[1]} from ${old.file}`);count++;
 }
 assert(count>=25);includes(stages[0],'faolla_attendance_account_grant_current_v1','faolla_attendance_missing_delegation_usable_pre164','faolla_attendance_application_delegation_usable_pre164');
 assert.doesNotMatch(stages[0],/20261008019[5-7]/);
});

test('all dependency headers match the actual earlier definitions, not just body hashes',()=>{
 let count=0;
 for(const m of stages[0].split(') dependency(signature,source_hash')[0].matchAll(/\('public\.(faolla_\w+)\([^']*\)','([0-9a-f]{64})','([^']+)','(.)','([^']+)',(true|false),(true|false),(\d+),array\[(.*?)\]::text\[\]/g)){
  const old=history.get(m[1]);assert(old,m[1]);count++;
  const expected={hash:m[2],type:m[3],volatility:m[4],language:m[5],definer:m[6]==='true',defaults:Number(m[8]),args:[...m[9].matchAll(/'([^']+)'/g)].map(x=>x[1])};
  const actual={hash:sha(old.body),type:old.type,volatility:/\bimmutable\b/i.test(old.header)?'i':/\bstable\b/i.test(old.header)?'s':'v',language:old.header.match(/\blanguage\s+(\w+)/i)?.[1],definer:/\bsecurity definer\b/i.test(old.header),defaults:(old.args.match(/\bdefault\b/gi)||[]).length,args:old.args.split(',').map(x=>x.trim().split(/\s+/)[0])};
  assert.deepEqual(expected,actual,`${m[1]} actual metadata from ${old.file}`);
 }
 assert.equal(count,29);
});

test('activation forward patch is exactly two implemented-consumer predicates; original recovery/CAS remains byte-identical',()=>{
 const original=history.get('faolla_attendance_operational_consumer_activation_v1').body,recipe=block('routing_activation_forward');
 const replacements=[
  ["kind<>'application_window' or not p_allow_activate or not s.enabled","kind not in('application_window','review_routing') or not p_allow_activate or not s.enabled"],
  ["kind='application_window' and p_allow_activate and s.enabled","kind in('application_window','review_routing') and p_allow_activate and s.enabled"],
 ];let changed=original;
 for(const [a,b] of replacements){assert.equal(changed.split(a).length,2);changed=changed.replace(a,b);includes(recipe,a.replaceAll("'","''"),b.replaceAll("'","''"));}
 includes(recipe,sha(original),sha(changed),'pg_get_function_arguments(p.oid)','where version=202610080198) then return');
 for(const s of stages)includes(s,sha(changed));includes(stages[0],sha(original));
 assert.equal((recipe.match(/body_value:=replace/g)||[]).length,2);
 assert.doesNotMatch(recipe,/alter function|revoke |grant |drop /i);
});

test('concurrent candidate indexes verify complete keys/opclasses/collation and never repair wrong orphan objects',()=>{
 for(const s of stages)includes(s,'attendance_review_routing_correction_idx','attendance_review_routing_missing_idx','attendance_review_routing_application_idx',
  "i.indisvalid and i.indisready and i.indislive",'i.indnatts=cardinality(expected.keys)','i.indnkeyatts=cardinality(expected.keys)',
  'i.indoption[z-1]<>0','i.indcollation[z-1] is distinct from','o.opcnamespace','o.opcdefault','o.opcintype=a.atttypid');
 assert(sql.indexOf('commit;')<sql.indexOf('create index concurrently'));
 includes(stages[1],'true and idx is null');assert.doesNotMatch(sql,/reindex|drop index|create unique index concurrently/i);
});

test('reentry refuses table/constraint/trigger/ACL drift before any CREATE or grant',()=>{
 for(const s of stages)includes(s,'relrowsecurity and not relforcerowsecurity','from pg_policy where polrelid=t','expected.nullable_columns',
  'con.contype::text is distinct from expected.kind','pg_get_expr(con.conbin,t)','con.confrelid is distinct from','con.confupdtype',
  'expected.keys','expected.referenced_keys','tgdeferrable=expected.is_deferred','tginitdeferred=expected.initially_deferred',
  'review_routing_capture','review_routing_proof','review_routing_immutable','review_routing_no_truncate',
  "has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')");
 includes(block('routing_security'),'where version=202610080198) then return','revoke all on function %s from public,anon,authenticated,service_role');
 const grants=[...sql.matchAll(/^grant execute on function public\.(\w+)/gm)].map(m=>m[1]);assert.deepEqual(grants,['faolla_attendance_review_routing_v1']);
 assert.deepEqual(funcs.filter(f=>/security definer/i.test(f.header)).map(f=>f.name),['faolla_attendance_review_routing_capture_v1','faolla_attendance_review_routing_guard_v1','faolla_attendance_review_routing_v1']);
});

test('PG15 bytes CHECK deparse permits only the proven scalar NAME cast at all three boundaries',()=>{
 const cast='::(text|bigint|integer)(\\[\\])?|::name(?![[:alnum:]_\\[])';
 assert.equal(sql.split("'"+cast+"'").length-1,6);
 const stripCast=s=>s.replace(new RegExp(cast.replace('[[:alnum:]_\\[]','[A-Za-z0-9_\\[]'),'g'),'');
 const normalize=s=>stripCast(s).replace(/[\s()[\]"]/g,'').replaceAll("'",'').toLowerCase();
 // Actual pg_get_expr from the owned PG15 TEMP/rollback diagnostic, not a guessed rendering.
 const actual="(octet_length(convert_to((jsonb_build_array(request_ref, entry, command, source_ref, authority))::text, 'UTF8'::name)) <= 32768)";
 const expected="octet_length(convert_to(jsonb_build_array(request_ref,entry,command,source_ref,authority)::text,'UTF8'))<=32768";
 assert.equal(normalize(actual),normalize(expected));
 for(const altered of [actual.replace('32768','32769'),actual.replace('UTF8','UTF16'),actual.replace('<=','>='),actual.replace('authority','authority||command')])assert.notEqual(normalize(altered),normalize(expected));
 assert.equal(stripCast('x::name[]'),'x::name[]');assert.equal(stripCast('x::name_suffix'),'x::name_suffix');
 assert.equal(stripCast('x::name)'), 'x)');
});

test('strict tuple rejects nullable enum/identity and binds every public command field',()=>{
 const t=body('tuple_v1');includes(t,"p->>'family' is null","p->>'kind' is null","p->>'grantId' is null",'is distinct from true',
  "'expectedResponsibilityRevision','expectedResponsibilityOperationId','expectedRequestRevision','expectedObservationFingerprint','grantId','reason'",
  'n>=9007199254740990',"(n=0)<>(p->'expectedResponsibilityOperationId'='null'::jsonb)","(p->>'action'='take_over')<>(p->'grantId'='null'::jsonb)");
 includes(body('make_v1'),"'attendance-review-routing-entry-v1',p_site",'p_previous','p_fingerprint','p_actor');
});

test('five original insert triggers capture six families, no original writer copy and no historical backfill',()=>{
 const c=body('capture_v1'),sec=block('routing_security');
 for(const n of ['correction_entries','revision_requests','missing_requests','leave_requests','work_arrangement_requests'])includes(sec,`merchant_attendance_${n}`);
 includes(c,"tg_when<>'AFTER' or tg_op<>'INSERT' or tg_level<>'ROW'","raw->>'supersedes_request_id'", "raw->>'action'<>'submit' then return new",
  "activation.action is distinct from 'activate' then return new",'stamp:=clock_timestamp()',"if stamp<(ref->>'submittedAt')::timestamptz",'faolla_attendance_operational_source_v1',
  'faolla_attendance_operational_punch_source_ref_v1');
 assert.doesNotMatch(c,/owner_checked|delegate_checked|set_config|select.*employee.*from.*merchants/i);
 assert.doesNotMatch(sql,/insert into public\.merchant_attendance_review_responsibility_(?:entries|heads)\s+select/i);
});

test('deferred proof validates old complete binding/entry/command while request AFTER INSERT uses explicitly incomplete facts',()=>{
 const f=body('fact_v1'),e=body('entry_v1'),g=body('guard_v1');
 includes(body('capture_v1'),'fact_v1(site,family_name,rid,false)');includes(body('request_v1'),'fact_v1(p_site,p_family,p_request,true)');
 assert.doesNotMatch(funcs.find(f=>f.name.endsWith('_fact_v1')).header,/stable|immutable/i);
 includes(f,"cb.command-'expectedPolicyRevision'",'cb.recorded_at<>submitted',"c.command->'expectedRevision' is distinct from to_jsonb(c.revision-1)",
  "c.command->>'startEventId' is distinct from c.start_event_id::text", "r.command->'expectedRevision' is distinct from to_jsonb(r.revision-1)",
  "r.command->>'expectedBaseOperationId' is distinct from r.base_operation_id::text",'me.actor_auth_user_id<>au','me.recorded_at<>submitted',
  "me.command->>'supersedesRequestId' is distinct from m.supersedes_request_id::text",'faolla_attendance_leave_summary_v1','faolla_attendance_work_arrangement_summary_v1');
 includes(f,'if cb.request_id is not null and');includes(e,"p.family='correction' and not exists(select 1 from public.merchant_attendance_correction_rule_bindings");
 includes(e,'fact->\'request\' is distinct from p.request_ref',"src->'workerIdentity'->>'employeeAuthUserId'",'activation.revision+1',
  "p.operation_id<>p.request_id or p.actor_auth_user_id<>p.employee_auth_user_id");
 includes(g,"if tg_when='AFTER' then",'faolla_attendance_review_routing_entry_v1(new)','latest.revision<new.revision');
 includes(secString(),'deferrable initially deferred');
});
function secString(){return block('routing_security');}

test('candidate bound is raw 26 before qualification, single winner only and revision remains owner-only',()=>{
 const c=body('candidates_v1'),choose=body('choose_v1'),origin=body('origin_v1');assert.equal((c.match(/limit 26/g)||[]).length,3);
 assert.doesNotMatch(c,/qualify|usable_v1|generate_series|offset /i);
 includes(c,'x.worker_id=wid and x.employee_id=eid and x.employee_auth_user_id=au','x.delegate_employee_id=de and x.delegate_auth_user_id=da');
 includes(choose,"jsonb_array_length(items)=26 then reason_name:='candidate_limit'",'if n=1 then return',"when n>1 then 'ambiguous_grant'",'source_scope_unavailable');
 assert(choose.indexOf('jsonb_array_length(items)=26')<choose.indexOf('for item in'));
 includes(origin,"array['personal','group','enterprise']","selection:='owner_only_revision'","selection text:='unconfigured'");
});

test('legacy manual registration preserves absence of085 binding without authorizing approvals; new capture and revision roots remain exact',()=>{
 const f=body('fact_v1'),e=body('entry_v1'),r=body('v1');
 includes(f,'if cb.request_id is not null and','Legacy pre085 requests remain observable/manual-registerable',
  'x.operation_id=r.base_operation_id and x.worker_id=r.worker_id','x.root_request_id=r.base_request_id',
  'root.request_id=m.root_request_id','approval.request_id=parent.request_id',"approval.action='approve'");
 const capture=e.slice(e.indexOf("if origin->>'kind'='rule_capture' then"),e.indexOf('src:=public.faolla_attendance_operational_punch_saved_source_v1'));
 includes(capture,"p.family='correction' and not exists",'merchant_attendance_correction_rule_bindings');
 includes(r,"jsonb_build_object('kind','manual_registration')","'register'");
 assert.doesNotMatch(r,/insert into public\.merchant_attendance_(?:correction_decisions|correction_effects|revision_decisions|missing_entries)|canApprove|canReject/);
 //This is a path/static assertion, not a claim that native legacy registration has run.
});

test('qualification uses true old grant rules, exact targets, expiry, epoch evidence and only known scope errors are contained',()=>{
 const q=body('qualify_v1'),grant=body('grant_v1');
 includes(q,'faolla_attendance_correction_delegation_usable_v1','faolla_attendance_missing_delegation_usable_v1','faolla_attendance_application_delegation_usable_v1',
  "g->>'delegate_auth_user_id'=ref->>'employeeAuthUserId'",'order by x.id for share',">c.recorded_at",'>=a.recorded_at',"clock_timestamp()<(g->>'valid_until')::timestamptz",
  "fact->'row'->'basis'", "basis->'currentBasis'", "if code not in(", 'then raise;end if;');
 assert.doesNotMatch(q,/when others|owner_review_v|p_auth_user_id.*owner_id/i);
 includes(grant,"epoch_kind:='embedded'","epoch_kind:='sidecar'","epoch_kind:='pre_epoch_zero'",'ep.delegate_generation','ep.employee_generation','command_fingerprint');
 includes(body('entry_v1'),'p.authority is distinct from authority_expected',"p.recorded_at<(g->'row'->>'recorded_at')::timestamptz");
});

test('current observation is read-only; revoked/rebound/owner-changed routes demand explicit handover',()=>{
 const o=body('observe_v1');includes(o,"route_state:='closed'","route_state:='unregistered'","reason_name:='owner_changed'","reason_name:='binding_changed'","reason_name:='grant_unavailable'",'ep.paused');
 assert.doesNotMatch(o,/insert into|update public|delete from|operational_source_v1\(/i);
 const fingerprint=o.slice(o.indexOf("'attendance-review-routing-observation-v1'"));assert.doesNotMatch(fingerprint,/p_at|checkedAt/);
 includes(fingerprint,'owner_id',"fact->'requestRevision'","fact->'requestHeadOperationId'",'binding,route_state,reason_name');
});

test('original actor full-command recovery precedes current owner, settings, flags and qualification',()=>{
 const r=body('v1');const recover=r.indexOf("if mode_name='recover' or saved.operation_id is not null then");assert(recover>=0);
 assert(recover<r.indexOf('from public.merchants'));assert(recover<r.indexOf('if p_command is not null and not p_allow_write'));
 includes(r,'saved.actor_auth_user_id<>p_auth_user_id or saved.command is null','saved.request_id<>rid or saved.command is distinct from p_command',
  "saved.entry->>'commandFingerprint' is distinct from fingerprint","jsonb_build_object('kind','receipt')");
 assert.doesNotMatch(body('receipt_v1'),/qualify|observe|operational_source_v1\(/);
 assert(r.indexOf('perform public.faolla_attendance_review_routing_query_v1')<r.indexOf("rid:=(p_query->>'requestId')::uuid"));
});

test('manual writer uses owner/settings serialization, exact responsibility/request/observation CAS and no approval capability',()=>{
 const r=body('v1');includes(r,'from public.merchants m where m.id=site for share','where s.merchant_id=site for update',
  'where h.merchant_id=site and h.family=family_name and h.request_id=rid for update','coalesce(head.revision,0)',
  "p_command->>'expectedResponsibilityOperationId' is distinct from head.operation_id::text","p_command->'expectedRequestRevision' is distinct from observation->'requestRevision'",
  "p_command->'expectedObservationFingerprint' is distinct from observation->'observationFingerprint'", "family_name<>'correction_revision'",
  "observation->>'status'<>'submitted'",'previous.source_ref');
 assert.doesNotMatch(r,/canApprove|canReject|correction_decide|delegated_missing_v1|leave_v1\(/);
 const g=body('guard_v1');includes(g,'owner_id is distinct from new.actor_auth_user_id',"observation->>'routeState' not in('needs_assignment','handover_needed')",
  'new.revision<>old.revision+1','saved.entry->>\'previousOperationId\' is distinct from old.operation_id::text');
});

test('list/history/grants use exclusive bounded pages; self exposes no grant or raw source',()=>{
 const r=body('v1');includes(r,'order by h.recorded_at desc,h.family collate "C",h.request_id desc limit 26',
  'h.family collate "C">','h.request_id<','order by e.revision desc limit 26','next_cursor:=items->24->\'revision\'',
  "n=26 then next_cursor:=cursor_item;exit;end if",'262144');
 const self=r.slice(r.indexOf("elsif mode_name='self' then"),r.indexOf("else data_value:=jsonb_build_object('kind','detail'"));
 includes(self,"'route'","'handoverNeeded'","'capturedAt'");assert.doesNotMatch(self,/grantId|delegateEmployeeId|source_ref|'assignment',/);
 assert.doesNotMatch(r,/offset |count\(\*\)|generate_series/i);
});

test('SQL source avoids known precedence/CASE pitfalls and finite installation markers are complete',()=>{
 assert.doesNotMatch(sql,/is distinct from case|if [^\n]*[<>]=?case|->'\w+'\s*-\s*'/i);
 assert.equal((sql.match(/^begin;$/gm)||[]).length,2);assert.equal((sql.match(/^commit;$/gm)||[]).length,2);
 assert.equal((sql.match(/^\$\$;$/gm)||[]).length,16);
 assert.doesNotMatch(sql,/TODO|FIXME|PLACEHOLDER/);
});
