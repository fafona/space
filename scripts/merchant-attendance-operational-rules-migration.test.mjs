//240 static/pure only: this module never starts PostgreSQL or a browser.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const url=new URL('./supabase-migrations/202610080191_merchant_attendance_operational_rules.sql',import.meta.url);
const sql=readFileSync(url,'utf8').replaceAll('\r\n','\n');
const parts=[...sql.matchAll(/create or replace function public\.([a-z0-9_]+)\(([^\n]*)\)\nreturns ([^\n]+) as \$\$([\s\S]*?)\n\$\$;/g)];
const fn=name=>{const match=parts.find(m=>m[1]==='faolla_attendance_operational_rule_'+name+'_v1');assert(match,name);return match[4];};
const rpc=parts.find(m=>m[1]==='faolla_attendance_operational_rules_v1')[4];
const has=(s,...fragments)=>fragments.forEach(f=>assert(s.includes(f),f));
const reentry=sql.slice(sql.indexOf('do $operational_reentry$'),sql.indexOf('$operational_reentry$;'));
const post=sql.slice(sql.indexOf('do $operational_postconditions$'),sql.indexOf('$operational_postconditions$;'));
const sha=s=>createHash('sha256').update(s).digest('hex');

test('191 is additive: three new tables,16 new functions,one service RPC and unchanged old writers',()=>{
 assert.equal((sql.match(/^create table if not exists public\./gm)||[]).length,3);
 assert.equal(parts.length,16);
 assert(parts.every(m=>m[1].startsWith('faolla_attendance_operational_rule')));
 assert.equal((sql.match(/^grant execute on function /gm)||[]).length,1);
 assert(sql.trim().endsWith('commit;'));
 has(sql,"set local lock_timeout='3s'","set local statement_timeout='10s'");
 assert.doesNotMatch(sql,/disable trigger|session_replication_role|create extension|delete from public\.|attendance_operational_rule_source_v1/);
 const mutations=[...sql.matchAll(/(?:insert into|update) public\.([a-z0-9_]+)/gi)].map(m=>m[1]);
 assert(mutations.every(n=>n==='faolla_schema_migrations'||n.startsWith('merchant_attendance_operational_rule_')));
});

test('registered reentry refuses changed source/owner/ACL/config/triggers before any replacement',()=>{
 assert(sql.indexOf('do $operational_reentry$')<sql.indexOf('create or replace function'));
 for(const block of [reentry,post])has(block,'metadata.proowner is distinct from expected_owner',"metadata.prosecdef is distinct from (entry_value.is_rpc or f='public.faolla_attendance_operational_rule_guard_v1()'::regprocedure)",
  "metadata.proconfig is distinct from array['search_path=pg_catalog']",'metadata.proretset or metadata.proisstrict or metadata.proleakproof',
  'aclexplode(coalesce(metadata.proacl','a.grantee<>expected_owner','pg_policy','tgdeferrable and tginitdeferred','tgenabled=\'O\'',
  "has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')");
});

test('both pinned manifests equal actual16 prosrc bodies,including owned namespace normalization',()=>{
 for(const m of parts){
  const hash=sha(m[4]+'\n');
  assert(reentry.includes(hash),m[1]+' reentry source pin');assert(post.includes(hash),m[1]+' post source pin');
  const scoped=(m[4]+'\n').replace(/\bpublic\./g,'attendance_native_owned.');
  assert.equal(sha(scoped.replaceAll('attendance_native_owned.','public.')),hash,m[1]);
 }
 has(reentry,"ns||'.','pub'||'lic.'");
 assert.doesNotMatch(sql,/--REENTRY_GUARD|--POSTCONDITIONS|--BODY_HELPERS|--GUARDS_AND_RPC/);
});

test('scope and scalar validation are exact and personal keys include both saved identities',()=>{
 has(fn('scope'),"array['kind','workerId','employeeId','employeeAuthUserId']","jsonb_build_array('personal',p->>'workerId',p->>'employeeId',p->>'employeeAuthUserId')");
 has(fn('scalar'),"char_length(p#>>'{}')=36","char_length(p#>>'{}')=64",'9007199254740990');
 has(fn('command'),"char_length(p->>'siteId')<>8","public.faolla_attendance_group_text_v1(p->>'reason',1,200)","p->>'expectedRevision')::bigint>=9007199254740990");
 assert.doesNotMatch(fn('command'),/btrim|trim\(/);
});

test('all eight values produce only canonical tuples,including full reminders and four routing categories',()=>{
 const values=fn('values');
 has(values,"array['allowedChannels','locationScope','shiftSource','breakTypes','correctionWindow','reviewRouting','timesheetCycle','reminders']",
  "array['self','location','pin','onsite']","jsonb_array_length(v) not between 1 and (case when k='allowedChannels' then 4 else 25 end)",
  "array['correction','missing','leave','work_arrangement']","array['open_session','pending_review','period_due']",
  "array['mode','afterMinutes','repeatMinutes','maxOccurrences']","m='repeatMinutes' and n<60","then 10 else 44640",
  "left(v->>'anchorDate',4)='0000'","jsonb_build_array('fortnightly',v->>'anchorDate')");
 assert.doesNotMatch(values,/2000-01-01|2100-12-31|jsonb_build_object/);
});

test('canonical command hash includes actor and complete scope/body without object ordering',()=>{
 has(fn('command'),"jsonb_build_array(p->>'siteId',s,a,p->>'operationId',(p->>'expectedRevision')::bigint,p->>'reason')",
  "jsonb_build_array(public.faolla_attendance_operational_rule_context_tuple_v1(p->'expectedContext',p->'scope'),public.faolla_attendance_operational_rule_values_v1(p->'rules'))",
  "jsonb_build_array((p->>'sourceDraftRevision')::bigint,p->>'effectiveOn',p->>'endsOn',p->>'previewFingerprint')");
 has(rpc,"jsonb_build_array('attendance-operational-rule-command-v1',p_auth_user_id::text,tuple_value)");
 has(fn('hash'),"encode(sha256(convert_to(p::text,'UTF8')),'hex')");
});

test('PLpgSQL IF scalar CASE is parenthesized rather than mistaken for the procedural branch',()=>{
 has(fn('values'),"if n>(case when m='maxOccurrences' then 10 else 44640 end) or m='repeatMinutes' and n<60 then");
 assert.doesNotMatch(sql,/\bif\s+[^\n;]*(?:[><=]|is distinct from)\s*case\b/i);
});

test('fresh subject validates current triple,active account and pause while old detail can have null context',()=>{
 has(fn('context'),'w.employee_id is distinct from e.id',"e.auth_user_id is distinct from (p_scope->>'employeeAuthUserId')::uuid",
  "jsonb_build_object('context',null,'subject',null,'usable',false)","e.status='active'",'x.paused','active_value:=active_value and w.active');
 has(rpc,"info->'usable' is distinct from 'true'::jsonb","action_name in('save_draft','publish')");
});

test('reference acquisition is at most25locations and4members with same-merchant locks,no grant or GPS collection',()=>{
 const refs=fn('references');
 has(refs,"array['correction','missing','leave','work_arrangement']",'x.merchant_id=p_site and x.id=id_value for share',
  "x.merchant_id=p_site and x.id=(z#>>'{}')::uuid for share",'array_agg(distinct',"is distinct from z->>'delegateAuthUserId'");
 assert.doesNotMatch(refs,/latitude|longitude|radius_meters|secret|delegate_generation|grant_id|from public\.merchant_attendance_workers/);
 has(fn('references_tuple'),"jsonb_array_length(p->'locations')>25","jsonb_array_length(p->'routes')>4","r->'locationScope'->'value'->i is distinct from v->'locationId'");
});

test('preview preserves saved full draft references and uses real locked clock/date helpers',()=>{
 const preview=fn('preview');
 has(preview,"info->'context' is distinct from p_draft->'context'","refs is distinct from p_draft->'references'",'faolla_attendance_rule_day_start_v1','faolla_attendance_personal_rule_end_v1',
  'stamp:=clock_timestamp()',"p_day::date<=(stamp at time zone (p_draft->'context'->>'timeZone'))::date",'b<=stamp');
 has(rpc,"preview_value->>'previewFingerprint' is distinct from p_command->>'previewFingerprint'",'stamp>=idx.effective_at');
 assert.doesNotMatch(sql,/set_config|current_setting|pg_sleep/);
});

test('future-only projection changes require exact immutable same-transaction operations and final deferred proof',()=>{
 assert(parts.find(m=>m[1]==='faolla_attendance_operational_rule_guard_v1')[3].includes('security definer'));
 has(fn('guard'),"(to_jsonb(new)-'withdrawn_revision') is distinct from (to_jsonb(old)-'withdrawn_revision')",'old.withdrawn_revision is not null or new.withdrawn_revision is null',
  "o.action<>'withdraw'","o.recorded_at>=new.effective_at",'head','faolla_attendance_operational_rule_check_v1');
 has(sql,'create constraint trigger operational_rule_proof after insert on %s deferrable initially deferred',
  'create constraint trigger operational_rule_proof after insert or update on %s deferrable initially deferred','before update or delete','before truncate');
 has(fn('check'),"prev.draft_revision_after is distinct from (v->>'sourceDraftRevision')::bigint",'src.item-array',
  'idx.withdrawn_revision is distinct from o.revision','first_op.recorded_at is distinct from h.created_at');
});

test('personal overlap and current/next publication use indexed adjacent point reads,no complete historical scan',()=>{
 for(const body of [fn('guard'),rpc]){
  has(body,'withdrawn_revision is null','order by x.effective_at desc,x.published_revision desc limit 1','order by x.effective_at,x.published_revision limit 1');
 }
 has(sql,'attendance_operational_rule_effective_idx','where withdrawn_revision is null','attendance_operational_rule_unique_time_idx');
 assert.doesNotMatch(rpc,/for .+from public\.merchant_attendance_operational_rule_publications/);
});

test('recovery minimal original actor does not reread settings/current binding/owner roles',()=>{
 const recovery=rpc.slice(rpc.indexOf("if mode_name='recover' then\n  select * into o"),rpc.indexOf(" else\n  if p_command is null then select * into s"));
 has(recovery,'o.actor_auth_user_id<>p_auth_user_id','faolla_attendance_operational_rule_receipt_v1(o)',"jsonb_build_object('kind','receipt')");
 assert.doesNotMatch(recovery,/context_v1|references_v1|settings|roles|permissions|rules_v1/);
 assert(rpc.indexOf('o.command is distinct from p_command')<rpc.indexOf("if not p_allow_write then raise exception 'attendance_operational_rule_disabled'"));
 const receipt=fn('receipt');assert.doesNotMatch(receipt,/'rules'|'references'|'command'|'workerName'|'employeeName'/);
});

test('history is25+1 stable revision snapshot and withdrawal annotation never exceeds that snapshot',()=>{
 has(rpc,'x.revision<=at_rev','x.revision<before_rev','order by x.revision desc limit 26','count_seen:=count_seen+1;exit when count_seen=26',
  'if withdrawn>at_rev then withdrawn:=null',"'atRevision',at_rev,'beforeRevision',last_rev",'last_rev is distinct from 1');
 assert.doesNotMatch(rpc,/offset /i);
});

test('catalog has current-owner check,real dual identities and indexed saved historical personal scope',()=>{
 has(rpc,"mode_name<>'recover' and m.user_id is distinct from p_auth_user_id",'e2.auth_user_id is not null',"'employeeAuthUserId',w.auth_user_id",
  "x.stream_key collate \"C\">after_scope_key collate \"C\"",'order by x.stream_key collate "C" limit 26',"'nextScope'","'nextId'");
 has(sql,"(scope->>'kind'),stream_key collate \"C\"");
 assert.doesNotMatch(rpc,/FAOLLA.*DELEGATION|workerName.*btrim|employeeName.*btrim/);
});

test('bounds and errors remain frozen and response never truncates a body',()=>{
 has(rpc,'>262144',"raise exception 'attendance_operational_rule_too_large'", "'canWrite',can_write,'data',data_value,'receipt',receipt_value");
 has(fn('command'),'>40960');has(fn('values'),'>32768');
 const errors=new Set([...sql.matchAll(/raise exception '(attendance_[a-z_]+)'/g)].map(m=>m[1]));
 assert.deepEqual([...errors].sort(),['attendance_access_denied','attendance_invalid_request','attendance_operation_conflict','attendance_operational_rule_changed',
  'attendance_operational_rule_disabled','attendance_operational_rule_future_required','attendance_operational_rule_invalid','attendance_operational_rule_limit',
  'attendance_operational_rule_not_found','attendance_operational_rule_overlap','attendance_operational_rule_too_large','attendance_settings_required'].sort());
 assert.doesNotMatch(sql,/is distinct from case/);
});
