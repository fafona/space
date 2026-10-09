//SOURCE-only equivalence checks: no SQL, process, network, clock or KDF work.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {independentFunctionManifest} from './merchant-attendance-independent-installation.mjs';
const migration=new URL('./supabase-migrations/202610080201_merchant_attendance_reminders.sql',import.meta.url);
const sql=readFileSync(migration,'utf8').replaceAll('\r\n','\n');
const functions=new Map(independentFunctionManifest(sql).filter(f=>/^faolla_attendance_reminders?_/.test(f.name)).map(f=>[f.name,f]));
const body=name=>{const f=functions.get('faolla_attendance_'+name+'_v1');assert(f,name);return f.body;};
const hash=value=>createHash('sha256').update(value).digest('hex');
//Actual19-function pre-change SOURCE snapshot, before adding the20th helper.
const originalHashes=Object.freeze({
 reminder_id:'addb44f8b3fbb33610adda8e583738966adb33f97ebb87795fdddfaccd5f44c2',
 reminder_config:'5d737b34f4bc38d6f68e43b2dd5cd91572782c0aa3a0daeefdff52880ebd2dd2',
 reminder_head:'0ad15d99b26b3ca7c5e0b16ee20696062c2746c0219be59be6897106e5f91dd7',
 reminder_eligible:'e098e5885e5dfaf2e53f074deb833a4ce7e99e984c6a93bade10c12aea3737e4',
 reminder_qualify:'473addf4892f0a776c9c63105466a482194c0b0b72b214336da9d98f96878e57',
 reminder_advance:'0a486f4b48d90948aa00b6e4555ab7c49ae9e41a5814c3014b3a60fe2b7fc287',
 reminder_capture:'00fad608f2832c3514f7820da71fea788b235d5ebf37ef023d59f89cfc113b3b',
 reminder_command:'dd544846a248bdbf2ca14456007a47b4700bf510109e87ffa722682e246d3040',
 reminder_receipt:'d0a7431e6000983a97b67adbf229d891b3aabfbba97804df446fdb5e2718106b',
 reminder_run:'1baec97572d30b305226ad6b1f9629ab878e8050359778bd27ed65a929f83e99',
 reminder_recipient:'9c5088bc85a0cea069a2273756e884e2682054534a02f41610ab6a917625274d',
 reminder_batch:'02e854dbb8876c1cc234ca4d4633d125ded82574875de588b9c074fad671b29f',
 reminders:'3d32b6b7c6f5eaef0b5aa7edb1262d52c04b53591c34debc4cafac4395d4e945',
 reminders_run:'c798f0fe940b0107ae8cfbc76d84af85821bd13437ea3e28fbe87a6a25529d70',
 reminder_plan_proof:'12df8088ec06f03e4d0e54de2d1cf7c5efe6dab51769be62b5efecd2b729e6da',
 reminder_batch_proof:'1e647e5feea6e0591201295a1d8a1a25ff892e0bde70578f182a77751724fec8',
 reminder_event_proof:'cf0a21575ca3e1552dd2325f21fee0edeb0b6dea387359375b50e1c5951a1008',
 reminder_guard:'1b229f813a30bb287b0600f4c30ecfcbed0945f83f098c9533f7d782ad5ab6d1',
 reminder_deferred:'1b6c37d226e746cab05ff29cad196d0d062f24bb5903d66ef5c76dd24cc7969a',
});
const substitutions=Object.freeze({
 reminder_capture:["public.faolla_attendance_reminder_config_layers_v1(source_value->'layers',category_name)",'public.faolla_attendance_reminder_config_v1(source_value,category_name)'],
 reminder_plan_proof:["public.faolla_attendance_reminder_config_layers_v1(s->'layers',p.category)",'public.faolla_attendance_reminder_config_v1(s,p.category)'],
 reminder_run:["public.faolla_attendance_reminder_config_layers_v1(current_source->'layers',plan_value.category)",'public.faolla_attendance_reminder_config_v1(current_source,plan_value.category)'],
});

test('201 private layers resolver is the exact old config tail, with the full independent config boundary retained',()=>{
 const original=body('reminder_config'),resolved=body('reminder_config_layers');
 const start=original.indexOf(' foreach k in array');assert(start>0);
 const transformedTail=original.slice(start).replaceAll("p_source->'layers'",'p_layers');
 assert.equal(resolved.slice(resolved.indexOf(' foreach k in array')),transformedTail);
 assert.equal(hash(original),originalHashes.reminder_config);
 assert.match(original,/p_source->>'sourceFingerprint' is distinct from public\.faolla_attendance_operational_rule_hash_v1\(public\.faolla_attendance_operational_source_tuple_v1\(p_source\)\)/);
 assert.match(resolved,/if p_category not in\('open_session','pending_review','period_due'\) then raise exception 'attendance_reminder_invalid'/);
 assert.doesNotMatch(resolved,/set_config|current_setting|trusted|skip|cache|operational_source_tuple|from public\./i);
});

test('201 only three validated-local call substitutions changed; all16 other old bodies are byte-for-byte unchanged',()=>{
 assert.equal(Object.keys(originalHashes).length,19);assert.equal(functions.size,20);
 for(const [name,expected]of Object.entries(originalHashes)){
  let actual=body(name);const replacement=substitutions[name];
  if(replacement){assert.equal(actual.split(replacement[0]).length-1,1,name);assert(!actual.includes(replacement[1]));actual=actual.replace(replacement[0],replacement[1]);}
  assert.equal(hash(actual),expected,name);
 }
 const callers=[...functions.values()].filter(f=>f.name!=='faolla_attendance_reminder_config_layers_v1'&&f.body.includes('faolla_attendance_reminder_config_layers_v1(')).map(f=>f.name).sort();
 assert.deepEqual(callers,Object.keys(substitutions).map(name=>'faolla_attendance_'+name+'_v1').sort());
});

test('201 local layers are dominated by real full source validation in every capture branch, deferred plan proof and runner miss',()=>{
 const capture=body('reminder_capture'),call=capture.indexOf(substitutions.reminder_capture[0]);
 for(const marker of ["source_value:=public.faolla_attendance_operational_punch_saved_source_v1(raw->'source_ref')",
  "source_value:=(case when rr.source_ref is null then public.faolla_attendance_operational_source_v1(site,wid,eid,auth,at_value) else public.faolla_attendance_operational_punch_saved_source_v1(rr.source_ref) end)",
  'source_value:=public.faolla_attendance_operational_punch_saved_source_v1(ci.source_ref)',
  'perform public.faolla_attendance_review_routing_entry_v1(rr)',"else raise exception 'attendance_reminder_invalid';end if;"]){assert(capture.indexOf(marker)>0);assert(capture.indexOf(marker)<call);}
 const proof=body('reminder_plan_proof');assert(proof.indexOf('s:=public.faolla_attendance_operational_punch_saved_source_v1(p.source_ref)')<proof.indexOf(substitutions.reminder_plan_proof[0]));
 for(const marker of ['workerIdentity','perform public.faolla_attendance_review_routing_entry_v1(rr)','perform public.faolla_attendance_cycle_intent_v1(ci)',
  'ps.source_ref is distinct from p.source_ref','ci.source_ref is distinct from p.source_ref','attendance-reminder-plan-proof-v1','a.recorded_at<=p.recorded_at'])assert(proof.includes(marker));
 const run=body('reminder_run'),live=run.indexOf('eligibility:=public.faolla_attendance_reminder_qualify_v1(plan_value,stamp)'),
  full=run.indexOf('current_source:=public.faolla_attendance_operational_source_v1(p_site,plan_value.worker_id,plan_value.employee_id,plan_value.employee_auth_user_id,stamp)'),
  resolve=run.indexOf(substitutions.reminder_run[0]);assert(live>0&&live<full&&full<resolve);
 assert(run.includes("current_key:=jsonb_build_array(p_site,plan_value.worker_id,plan_value.employee_id,plan_value.employee_auth_user_id,plan_value.category)::text"));
 assert(run.includes('if current_checks ? current_key then current_enabled:=(current_checks->>current_key)::boolean;\n    else'));
 assert.match(body('reminder_deferred'),/p:=new;perform public\.faolla_attendance_reminder_plan_proof_v1\(p\)/);
});

test('201 resolver has no external execute permission and old192/193/198 source files remain exact',()=>{
 const helper=functions.get('faolla_attendance_reminder_config_layers_v1');
 assert.equal(helper.types,'jsonb,text');assert.deepEqual(helper.argumentNames,['p_layers','p_category']);
 assert.equal(helper.securityDefiner,false);assert.equal(helper.volatility,'s');assert.equal(helper.defaults,0);assert.deepEqual(helper.config,['search_path=pg_catalog']);
 assert.match(sql,/revoke all on function public\.faolla_attendance_reminder_config_layers_v1\(jsonb,text\) from public,anon,authenticated,service_role;/);
 assert.doesNotMatch(sql,/grant execute on function public\.faolla_attendance_reminder_config_layers_v1/);
 for(const [name,expected]of [
  ['202610080192_merchant_attendance_operational_source.sql','f87f89ec27e9d2b81b501f03c1444b848b1829f3ab03dc5aa58b5a51f791b5a6'],
  ['202610080193_merchant_attendance_operational_punch.sql','00aace2e214bc493898e44662b232ba6df14bef66e263fca323b6a1de0724a9f'],
  ['202610080198_merchant_attendance_review_routing.sql','84a0fce6130c5b35f116e29fc56950549c9db459b3c1fe8408ec00a2f7f5e9be'],
 ])assert.equal(hash(readFileSync(new URL('./supabase-migrations/'+name,import.meta.url))),expected,name);
});
