import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {reminderInstallationManifest,reminderRenderSections,reminderForwardRecipe,reminderInstallationGuard,reminderSqlSha} from './merchant-attendance-reminder-installation.mjs';
import {independentFunctionManifest,independentCheckNormalize} from './merchant-attendance-independent-installation.mjs';
import {cycleApply,cycleForwardRecipes} from './merchant-attendance-cycle-forward.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=readFileSync(path.join(root,'scripts/supabase-migrations/202610080201_merchant_attendance_reminders.sql'),'utf8').replaceAll('\r\n','\n');
const manifest=reminderInstallationManifest(root,sql),functions=new Map(independentFunctionManifest(sql).map(f=>[f.name,f]));
const body=n=>{const f=functions.get('faolla_attendance_'+n+'_v1');assert(f,n);return f.body;};
const hash=s=>createHash('sha256').update(s).digest('hex');
test('201 exactly five private tables, twenty own functions, seven finite indexes and two service RPCs',()=>{
 assert.equal(hash(sql),reminderSqlSha);
 assert.equal(manifest.tables.length,5);assert.equal(manifest.functions.length,20);assert.equal(manifest.indexes.length,7);
 assert.deepEqual(manifest.functions.filter(f=>f.serviceExecute).map(f=>f.name),['faolla_attendance_reminders_v1','faolla_attendance_reminders_run_v1']);
 assert.equal(manifest.forward.length,1);assert.equal(manifest.forward[0].name,'faolla_attendance_operational_consumer_activation_v1');
 assert(manifest.functions.every(f=>f.hash===hash(functions.get(f.name).body)));
});
test('201 live qualifier is the exact old eligibility prefix; capture only substitutes the equivalent validated-layers resolver',()=>{
 const eligible=body('reminder_eligible'),cut=eligible.indexOf(' --Current source');
 assert(cut>0);assert.equal(eligible.split(' --Current source').length-1,1);
 assert.equal(body('reminder_qualify'),eligible.slice(0,cut)+" return 'active';\nend;\n");
 assert.equal(hash(eligible),'e098e5885e5dfaf2e53f074deb833a4ce7e99e984c6a93bade10c12aea3737e4');
 assert.equal(hash(body('reminder_capture').replace("public.faolla_attendance_reminder_config_layers_v1(source_value->'layers',category_name)",'public.faolla_attendance_reminder_config_v1(source_value,category_name)')),'00fad608f2832c3514f7820da71fea788b235d5ebf37ef023d59f89cfc113b3b');
 assert.equal(hash(body('reminder_config')),'5d737b34f4bc38d6f68e43b2dd5cd91572782c0aa3a0daeefdff52880ebd2dd2');
 const q=manifest.functions.find(f=>f.name==='faolla_attendance_reminder_qualify_v1');
 assert.equal(q.serviceExecute,false);assert.equal(q.defaults,0);
});
test('201 runner memoizes only fully validated same-run configuration after each live qualification and before head locking',()=>{
 const run=body('reminder_run');
 assert.match(run,/current_checks jsonb:='\{\}'/);
 assert.match(run,/current_key:=jsonb_build_array\(p_site,plan_value\.worker_id,plan_value\.employee_id,plan_value\.employee_auth_user_id,plan_value\.category\)::text/);
 const qualify=run.indexOf('eligibility:=public.faolla_attendance_reminder_qualify_v1(plan_value,stamp)'),active=run.indexOf("if eligibility='active' then",qualify),hit=run.indexOf('if current_checks ? current_key then',active),
  source=run.indexOf('current_source:=public.faolla_attendance_operational_source_v1',hit),check=run.indexOf('current_enabled:=public.faolla_attendance_reminder_config_layers_v1',source),save=run.indexOf('current_checks:=jsonb_set',check),head=run.indexOf('select * into h from public.merchant_attendance_reminder_heads',save);
 assert(qualify>0&&qualify<active&&active<hit&&hit<source&&source<check&&check<save&&save<head);
 assert.match(run,/current_checks \? current_key then current_enabled:=\(current_checks->>current_key\)::boolean;\n    else/);
 assert.match(run,/reminder_config_layers_v1\(current_source->'layers',plan_value\.category\) is not null/);
 assert.match(run,/if not current_enabled then eligibility:='stopped'/);
 assert.equal(run.split('current_source:=public.faolla_attendance_operational_source_v1').length-1,1);
 assert.doesNotMatch(run,/set_config|exception when/);
 assert.match(run,/ordinal_value>\(plan_value\.configuration->>'maxOccurrences'\)::integer/);
 assert.match(run,/plan_value\.recipient_key/);
});
test('201 generated preflight/finalize is deterministic and contains no unfilled placeholder',()=>{
 for(const [key,expected] of Object.entries(reminderRenderSections(root,sql))){const name=key.toUpperCase();const actual=sql.match(new RegExp(`-- BEGIN REMINDER ${name}\\n([\\s\\S]*?)\\n-- END REMINDER ${name}`))?.[1];assert.equal(actual,expected);}
 assert.doesNotMatch(sql,/populated by the SOURCE manifest/);
});

test('201 batch proof does not confuse its local item with the saved event item column',()=>{
 const proof=body('reminder_batch_proof');
 assert.match(proof,/declare batch_item jsonb/);assert.match(proof,/ordinal=\(batch_item->>'ordinal'\)::integer/);
 assert.match(proof,/ev\.item is distinct from batch_item/);
 assert.doesNotMatch(proof.replaceAll('ev.item','saved_event_item'),/\bitem\b/);
 assert.equal(hash(proof.replaceAll('batch_item','item')),'c4318a7d1167456896663b64314f0f2495073a0ad1ebd03cceca615392b61d10');
});

test('201 standalone migration wraps preflight, DDL, forward and postconditions in one transaction',()=>{
 assert.match(sql,/^begin;\n/);assert.match(sql,/\ncommit;\n?$/);
 assert.equal(sql.match(/^begin;$/gm)?.length,1);assert.equal(sql.match(/^commit;$/gm)?.length,1);
 for(const marker of ['-- BEGIN REMINDER PREFLIGHT','-- END REMINDER PREFLIGHT','-- BEGIN REMINDER FORWARD','-- END REMINDER FORWARD','-- BEGIN REMINDER FINALIZE','-- END REMINDER FINALIZE']){
  assert(sql.indexOf(marker)>sql.indexOf('begin;\n'));assert(sql.indexOf(marker)<sql.lastIndexOf('\ncommit;'));
 }
});
test('201 only two exact activation allowlist substitutions forward from latest 200; drift fails',()=>{
 const r=reminderForwardRecipe(root),old=cycleForwardRecipes(root).find(f=>f.name===r.name);assert.equal(r.oldHash,old.newHash);assert.equal(r.newHash,hash(r.wrapper));
 assert.equal(r.changes.length,2);assert.equal(cycleApply(old.wrapper,r.changes,r.name),r.wrapper);
 assert.throws(()=>cycleApply(old.wrapper.replace(r.changes[0].from,"kind='unknown'"),r.changes,r.name));
 assert.equal(r.core,null);assert.equal(r.wrapper.split("'reminders'").length-old.wrapper.split("'reminders'").length,2);
 assert.match(sql,/after_fn\.oid is distinct from before_fn\.oid/);assert.match(sql,/pg_get_expr\(after_fn\.proargdefaults,0\)/);
});
test('201 no old messages/Auth writer replacement, historic registration scan or cron',()=>{
 assert([...functions.keys()].every(n=>/^faolla_attendance_reminders?_/.test(n)));assert.doesNotMatch(sql,/create(?: or replace)? function public\.faolla_\w*(?:notification|message|auth|core_location|core_pin)\w*\s*\(/i);
 assert.doesNotMatch(sql,/pg_cron|cron\.schedule|insert into public\.merchant_(?:notifications|messages)/i);
 assert.deepEqual(manifest.captures,[{table:'merchant_attendance_operational_punch_sessions',type:5,deferred:false},{table:'merchant_attendance_review_responsibility_heads',type:21,deferred:true},{table:'merchant_attendance_cycle_operations',type:5,deferred:true}]);
 assert.match(body('reminder_capture'),/if a\.action is distinct from 'activate' then return new/);
 assert.match(body('reminder_capture'),/old_plan\.activation_revision<>a\.revision then return new/);
});

test('201 review capture waits for the real complete source ledger without changing old submit order or proof',()=>{
 const leave=readFileSync(path.join(root,'scripts/supabase-migrations/202610030122_merchant_attendance_leave_requests.sql'),'utf8');
 assert(leave.indexOf('insert into public.merchant_attendance_leave_requests select (target).*')<leave.indexOf('insert into public.merchant_attendance_leave_entries(merchant_id,operation_id'));
 assert.deepEqual(manifest.captures.find(c=>c.table==='merchant_attendance_review_responsibility_heads'),{table:'merchant_attendance_review_responsibility_heads',type:21,deferred:true});
 assert.match(body('reminder_capture'),/perform public\.faolla_attendance_review_routing_entry_v1\(rr\)/);
 assert.match(sql,/create %s trigger reminder_capture after insert %s on %s %s for each row/);
 assert.match(sql,/then 'deferrable initially deferred' else '' end/);
});

test('201 registration completes its paired event/head within the plan INSERT before immediate AFTER proof',()=>{
 const capture=body('reminder_capture'),eligible=body('reminder_eligible');
 const insert=capture.indexOf('insert into public.merchant_attendance_reminder_plans values(plan_value.*)');
 assert(insert>capture.indexOf('state_value:=public.faolla_attendance_reminder_eligible_v1(plan_value,at_value)'));
 assert(insert>capture.indexOf('due:=greatest(anchor+make_interval'));
 assert.match(capture.slice(insert),/^insert into public\.merchant_attendance_reminder_plans values\(plan_value\.\*\)\n returning public\.faolla_attendance_reminder_advance_v1\(merchant_attendance_reminder_plans,'register',at_value,state_value,\(case when state_value='active' then due else null end\),null,null\) is null into registered;/);
 assert.equal(capture.match(/reminder_advance_v1\([^;]*'register'/g)?.length,1);
 assert.doesNotMatch(capture.replace(/^\s*--.*$/gm,''),/\bset constraints\b/i);assert.doesNotMatch(eligible,/from public\.merchant_attendance_reminder_plans/);
 const deferred=body('reminder_deferred'),event=body('reminder_event_proof'),guard=body('reminder_guard');
 assert.match(deferred,/p:=new;perform public\.faolla_attendance_reminder_plan_proof_v1\(p\);/);
 assert.match(deferred,/ev\.plan_id is distinct from p\.plan_id or ev\.action is distinct from 'register'/);
 assert.match(event,/select \* into plan_value from public\.merchant_attendance_reminder_plans/);
 assert.match(guard,/ev\.current_head is distinct from public\.faolla_attendance_reminder_head_v1\(new\)/);
});
test('201 PK/FK/columns/RLS, trigger, unique index and CHECK literals are exact, not repaired',()=>{
 const guard=reminderInstallationGuard(manifest,'proof');assert.match(guard,/not in\('c','p','u','f'\)/);assert.match(guard,/con\.connoinherit is distinct from \(\(c->>'kind'\) in\('p','u','f'\)\)/);
 for(const field of ['con.confmatchtype','con.confupdtype','con.confdeltype','a.attnotnull','a.attidentity','a.attgenerated','idx.indnullsnotdistinct','tr.tgargs','tr.tgoldtable','tr.tgnewtable'])assert(guard.includes(field));
 assert.match(guard,/idx\.indisunique<>\(ix->>'unique'\)::boolean/);
 assert.match(guard,/jsonb_array_elements\(spec->'constraints'\) constraint_item where constraint_item->>'kind'/);
 assert.doesNotMatch(guard,/jsonb_array_elements\(spec->'constraints'\) c where c->>'kind'/);
 assert.match(guard,/::jsonb\) index_item where index_item->>'table'=spec->>'name'/);
 assert.doesNotMatch(guard,/::jsonb\) ix where ix->>/);
 assert.equal(independentCheckNormalize("convert_to(value::text,'UTF8'::name)"),independentCheckNormalize("convert_to(value,'UTF8')"));
 assert.notEqual(independentCheckNormalize("value~'^[0-9a-f]{64}$'"),independentCheckNormalize("value~'^[0-9a-f]{63}$'"));
});
test('201 original pure permissions helper has only registry-specific 185/190 hash and exact historical ACL alternatives',()=>{
 const f=manifest.dependencies.find(f=>f.name==='faolla_valid_merchant_enterprise_permissions_v1');assert.equal(f.source,'202610080190_merchant_attendance_correction_delegation_permission.sql');assert.match(f.legacyHash,/^[a-f0-9]{64}$/);assert.notEqual(f.hash,f.legacyHash);
 const guard=reminderInstallationGuard(manifest,'proof');assert.match(guard,/and not has190 then expected_hash:=spec->>'legacyHash'/);assert.match(guard,/a\.grantor,a\.grantee,a\.privilege_type,a\.is_grantable/);
 assert.doesNotMatch(sql,/grant execute on function public\.faolla_valid_merchant_enterprise_permissions/);
});
test('201 saved plans bind actual source identity, request/intent, activation and canonical full proof',()=>{
 const b=body('reminder_plan_proof');for(const marker of ['operational_punch_saved_source_v1','workerIdentity','review_routing_entry_v1','cycle_intent_v1','attendance-reminder-budget-v1','attendance-reminder-plan-proof-v1','a.recorded_at<=p.recorded_at'])assert(b.includes(marker));
 assert.match(b,/ps\.source_ref is distinct from p\.source_ref/);assert.match(b,/ci\.source_ref is distinct from p\.source_ref/);
 assert.match(body('reminder_capture'),/if recipient_value->>'kind'='needs_assignment' then return new/);
 assert.match(body('reminder_capture'),/config_value:=old_plan\.configuration/);assert.match(body('reminder_capture'),/anchor:=old_plan\.anchor_at/);
});
test('201 actual due scan bounded 25+1, stable cutoff, indexed exclusive cursor and no fake clock',()=>{
 const b=body('reminder_run');assert.match(b,/stamp:=clock_timestamp\(\);cutoff:=stamp/);assert.match(b,/order by x\.next_due_at,x\.plan_id limit 26/);assert.match(b,/if checked=25 then sentinel:=true;exit/);
 assert.match(b,/prior\.result->'nextCursor' is distinct from c/);assert.match(b,/cutoff:=\(c->>'cutoffAt'\)::timestamptz/);assert.match(b,/'runOperationId',opid,'afterDueAt'/);
 assert.equal(manifest.indexes.find(f=>f.name==='reminder_due_idx').predicate,"state='active'");assert.doesNotMatch(b,/set_config|pg_sleep|p_(?:now|due|recipient)/);
});
test('201 one actual UTC-hour summary; defer does not spend occurrence; same source takeover does not reset',()=>{
 const b=body('reminder_run');assert.match(b,/date_trunc\('hour',stamp at time zone 'UTC'\) at time zone 'UTC'/);assert.match(b,/reminder_advance_v1\(plan_value,'defer',stamp,'active',we/);assert.match(b,/jsonb_agg\(x-'recipientKey'-'category' order by x->>'planId'\)/);
 const advance=body('reminder_advance');assert.match(advance,/coalesce\(h\.delivered_count,0\)\+\(case when p_action='delivery' then 1 else 0 end\)/);assert.match(advance,/else h\.last_delivered_at end/);
 for(const name of ['reminder_delivery_budget_uq','reminder_delivery_plan_uq']){const i=manifest.indexes.find(f=>f.name===name);assert.equal(i.unique,true);assert.equal(i.predicate,"action='delivery'");}
});
test('201 original receipt recovery is before current gate; double-checked under settings serialization',()=>{
 const b=body('reminder_run');assert(b.indexOf('if op.operation_id is not null')<b.indexOf('for update'));assert.equal(b.split('if op.operation_id is not null').length-1,2);
 assert.match(b,/op\.actor_id is distinct from p_actor/);assert.match(b,/op\.command is distinct from p_command/);assert.match(b,/op\.command_fingerprint<>fingerprint/);
 assert.match(body('reminders'),/mode_name='recover' or op\.operation_id is not null/);assert.match(body('reminders_run'),/and actor_kind='system'/);
 assert.match(body('reminders_run'),/reminder_run_v1\(site,'system',null,c,p_allow_run\)/);
});

test('201 auth original mark commits during settings wait: exact receipt recheck precedes recipient/allow gates',()=>{
 const b=body('reminders'),locked=b.indexOf("if not found then raise exception 'attendance_settings_required'");
 const second=b.indexOf('select * into op from public.merchant_attendance_reminder_operations',locked);
 const gated=b.indexOf("elsif mode_name='check'",locked),recipient=b.indexOf('reminder_recipient_v1(b,p_auth_user_id)',locked),allow=b.indexOf("if not p_allow_write",locked);
 assert(locked>=0&&second>locked&&gated>second&&recipient>second&&allow>second);
 const recheck=b.slice(second,gated);for(const text of ["op.actor_kind<>'auth'",'op.actor_id<>p_auth_user_id','op.command is distinct from p_command','op.command_fingerprint<>fp',"jsonb_build_object('kind','receipt')",'reminder_receipt_v1(op)'])assert(recheck.includes(text));
 assert.match(recheck,/if data_value is not null then null/);
});
test('201 immutable head requires exact prior/current event; deferred proof rollback SQLSTATE23514',()=>{
 const guard=body('reminder_guard'),proof=body('reminder_deferred');assert.match(guard,/ev\.previous_head is distinct from public\.faolla_attendance_reminder_head_v1\(old\)/);assert.match(guard,/ev\.current_head is distinct from public\.faolla_attendance_reminder_head_v1\(new\)/);
 assert.match(guard,/tg_op in\('DELETE','TRUNCATE'\)/);assert.match(proof,/errcode='23514'/);assert.match(proof,/reminder_event_proof_v1/);assert.match(proof,/reminder_batch_proof_v1/);assert.match(proof,/run_operation_id=op\.operation_id/);
 assert.match(body('reminder_event_proof'),/old_plan\.configuration is distinct from plan_value\.configuration/);assert.match(body('reminder_event_proof'),/p\.previous_head is distinct from prior\.current_head/);
 assert.match(body('reminder_event_proof'),/x\.intent_id=plan_value\.source_id and x\.revision=2/);assert.doesNotMatch(body('reminder_event_proof'),/h\.last_operation_id/);
 assert.match(proof,/order by event_id limit 26\) bounded/);
});
test('201 reads revalidate real recipient without source body or approval right, mark-read is append-only first read',()=>{
 const b=body('reminder_recipient');for(const text of ['owner_id is distinct from p_actor','e.auth_user_id=p_actor','review_routing_qualify_v1','cycle_authority_v1'])assert(b.includes(text));
 assert.match(b,/qualified->'assignment' is distinct from p\.recipient/);assert.match(body('reminders'),/first_read:=coalesce\(first_read,stamp\)/);
 assert.doesNotMatch(body('reminders'),/update public\./);assert.doesNotMatch(body('reminder_batch'),/'source_ref'|'recipient'|'reason'/);
 assert.match(body('reminders'),/>131072/);assert.match(body('reminders'),/>8192/);
});
