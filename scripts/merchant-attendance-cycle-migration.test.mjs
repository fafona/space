// Finite SOURCE tests, not PostgreSQL execution or actual grant/clock evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cycleApply,cycleExtract,cycleForwardRecipes} from './merchant-attendance-cycle-forward.mjs';
import {cycleInstallationManifest,cycleRenderSections} from './merchant-attendance-cycle-installation.mjs';
import {qualifyAttendanceSandbox} from './merchant-attendance-concurrency-sandbox.mjs';
import {independentFunctionManifest} from './merchant-attendance-independent-installation.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file='scripts/supabase-migrations/202610080200_merchant_attendance_operational_cycle.sql';
const sql=readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
const manifest=cycleInstallationManifest(root,sql),recipes=cycleForwardRecipes(root),sections=cycleRenderSections(root,sql);
const body=n=>cycleExtract(sql,n),sha=s=>createHash('sha256').update(s).digest('hex');
test('200 finite inventory is four tables, twenty functions, three service RPCs and two indexes',()=>{
 assert.equal(manifest.tables.length,4);assert.equal(manifest.functions.length,20);assert.equal(manifest.indexes.length,2);
 assert.deepEqual(manifest.functions.filter(f=>f.serviceExecute).map(f=>f.name),['faolla_attendance_operational_cycle_v1','faolla_attendance_operational_cycle_send_v1','faolla_attendance_operational_cycle_send_recover_v1']);
 assert.equal(manifest.functions.filter(f=>f.securityDefiner).length,4);
});
test('200 deferred proof owns private reads after the public RPC returns without granting helper or table access',()=>{
 const proof=manifest.functions.find(f=>f.name==='faolla_attendance_cycle_deferred_v1');
 assert.equal(proof.securityDefiner,true);assert.equal(proof.serviceExecute,false);assert.deepEqual(proof.config,['search_path=pg_catalog']);
 assert(sql.includes('returns trigger language plpgsql security definer set search_path=pg_catalog as $$'));
 assert(!/grant\s+(?:select|all)[\s\S]{0,160}merchant_attendance_cycle_/i.test(sql));
 assert(body('faolla_attendance_cycle_deferred_v1').includes('public.faolla_attendance_cycle_operation_proof_v1(op)'));
});
test('all three embedded SOURCE guard/forward sections reproduce byte exactly',()=>{
 for(const value of Object.values(sections))assert(sql.includes(value));assert(!sql.includes('-- CYCLE_INSTALLATION_'));assert(!sql.includes('-- CYCLE_FORWARD_RECIPES'));
});

test('200 index guards do not shadow their declared constraint row variable',()=>{
 for(const section of [sections.preflight,sections.finalize]){
  assert.match(section,/jsonb_array_elements\(spec->'constraints'\) constraint_item where constraint_item->>'kind'/);
  assert.doesNotMatch(section,/jsonb_array_elements\(spec->'constraints'\) c where c->>'kind'/);
 }
});
test('three real first-send writers, current198 activation and exact184 private dependency profile are forwarded',()=>{
 assert.deepEqual(recipes.map(r=>r.name),['faolla_attendance_period_closure_v1','faolla_attendance_period_closure_v2','faolla_attendance_period_delegated_closure_v1','faolla_attendance_operational_consumer_activation_v1','faolla_attendance_period_delegated_source_v1']);
 assert.equal(recipes[3].oldHash,'3b621cc8c6271c100851413a88847da63e2e2c7b4b38a932e83d192a279aa144');
 assert.match(sections.forward,/after_fn\.oid is distinct from before_fn\.oid/);assert.match(sections.forward,/after_fn\.proacl/);assert.match(sections.forward,/pg_get_expr\(after_fn\.proargdefaults,0\)/);
});
test('exact substitutions reject parent drift and create only the two private intent cores',()=>{
 assert.equal(recipes.filter(r=>r.core).length,2);
 for(const r of recipes.slice(0,3)){
  const original=cycleExtract(readFileSync(path.join(root,'scripts/supabase-migrations',r.file),'utf8').replaceAll('\r\n','\n'),r.name);
  assert.equal(sha(original),r.oldHash);const modified=cycleApply(original,r.changes,r.name);assert.equal(sha(modified),r.coreHash??r.newHash);
  assert.throws(()=>cycleApply(original.replace(r.changes[0].from,'drift'),r.changes,r.name));
  for(const action of ['confirm','dispute','respond','seal','reopen'])assert.equal(modified.split(`action_name='${action}'`).length,original.split(`action_name='${action}'`).length);
 }
});
test('200 real sandbox qualification reproduces the recipe/source namespace mismatch before canonicalization',()=>{
 const ns='attendance_race_'+'a'.repeat(32),qualified=qualifyAttendanceSandbox(sections.forward,ns);
 const rewritten=JSON.parse(qualified.match(/\$cycle_recipes\$([\s\S]*?)\$cycle_recipes\$/)[1]);
 assert.equal(rewritten.length,5);
 for(let i=0;i<5;i++){
  const r=recipes[i],q=rewritten[i];
  assert.notEqual(sha(q.wrapper),r.newHash,r.name+':owned wrapper is not canonical hash input');
  if(i<3){
   const original=cycleExtract(readFileSync(path.join(root,'scripts/supabase-migrations',r.file),'utf8').replaceAll('\r\n','\n'),r.name);
   assert.equal(original.split(r.changes[0].from).length-1,1);
   assert.equal(original.split(q.changes[0].from).length-1,0,r.name+':canonical source cannot match owned recipe');
  }
 }
});
test('200 all five exact forward recipes retain canonical hashes and counts in public and owned schemas',()=>{
 const owned='attendance_race_'+'a'.repeat(32);
 for(const ns of ['public',owned]){
  const qualified=ns==='public'?sections.forward:qualifyAttendanceSandbox(sections.forward,ns);
  const rawRecipes=JSON.parse(qualified.match(/\$cycle_recipes\$([\s\S]*?)\$cycle_recipes\$/)[1]);
  // Mirrors the SQL loop-entry JSON canonicalization, not a changed recipe.
  const canonicalRecipes=rawRecipes.map(r=>JSON.parse(JSON.stringify(r).replaceAll(ns+'.','public.')));
  assert.deepEqual(canonicalRecipes,recipes,'no recipe hash, literal, count or wrapper changed');
  assert(qualified.includes("recipe:=replace(recipe::text,ns||'.','pub'||'lic.')::jsonb;"));
  assert.equal(qualified.split("replace(new_source,'pub'||'lic.',ns||'.')").length-1,2);
  assert(!qualified.includes("replace(new_source,'"+ns+".',ns||'.')"));
  for(const r of canonicalRecipes){
   let original=cycleExtract(readFileSync(path.join(root,'scripts/supabase-migrations',r.file),'utf8').replaceAll('\r\n','\n'),r.name);
   if(r.name==='faolla_attendance_operational_consumer_activation_v1')original=cycleApply(original,[
    {from:"kind<>'application_window' or not p_allow_activate or not s.enabled",to:"kind not in('application_window','review_routing') or not p_allow_activate or not s.enabled"},
    {from:"kind='application_window' and p_allow_activate and s.enabled",to:"kind in('application_window','review_routing') and p_allow_activate and s.enabled"}
   ],r.name+':actual198 predecessor');
   const savedBody=ns==='public'?original:qualifyAttendanceSandbox(original,ns);
   const canonicalSource=savedBody.replaceAll('\r\n','\n').replaceAll(ns+'.','public.');
   assert.equal(sha(canonicalSource),r.oldHash);
   const modified=cycleApply(canonicalSource,r.changes,r.name+':'+ns);
   assert.equal(sha(modified),r.coreHash??r.newHash);
   const wrapper=r.core?r.wrapper:modified;assert.equal(sha(wrapper),r.newHash);
   for(const canonical of r.core?[modified,wrapper]:[wrapper]){
    const installed=canonical.replaceAll('public.',ns+'.');
    assert(installed.includes(ns+'.'));assert.equal(installed.replaceAll(ns+'.','public.'),canonical);
    if(ns!=='public')assert(!installed.includes('public.'));
   }
   const drift=canonicalSource.replace(r.changes[0].from,'drift');
   assert.throws(()=>cycleApply(drift,r.changes,r.name+':drift still refused'));
  }
 }
});

test('184 runtime profile reproduces six stale195 pins, refreshes all17 exact dependencies and has no nested stale profile',()=>{
 const r=recipes[4],original=cycleExtract(readFileSync(path.join(root,'scripts/supabase-migrations',r.file),'utf8').replaceAll('\r\n','\n'),r.name);
 const administrative=JSON.parse(readFileSync(path.join(root,'scripts/supabase-migrations/202610080195_merchant_attendance_administrative_closure.sql'),'utf8').match(/\$administrative_recipes\$([\s\S]*?)\$administrative_recipes\$/)[1]);
 assert.equal(r.oldHash,'0108f90d9092d374ffd35265b0e82b88a6c24239cdd89a5eaf3dbb7586b97749');
 assert.equal(r.changes.length,6);assert.equal(cycleApply(original,r.changes,r.name),r.wrapper);
 const history=new Map(),dir=path.join(root,'scripts/supabase-migrations');
 for(const file of readdirSync(dir).filter(n=>/^\d+_/.test(n)&&n<'202610080200').sort())for(const f of independentFunctionManifest(readFileSync(path.join(dir,file),'utf8')))history.set(f.name,f);
 const profile=b=>[...b.matchAll(/\('public\.(\w+)\(([^']*)\)','([a-f0-9]{64})',(true|false),(true|false),(\d+),array\[([^\]]*)\]::text\[\]\)/g)];
 const before=profile(original),after=profile(r.wrapper);assert.equal(before.length,17);assert.equal(after.length,17);let changed=0;
 for(let i=0;i<17;i++){
  const [,name,types,pin,definer,service,defaults,args]=after[i],f=history.get(name),a=administrative.find(v=>v.name===name);assert(f,name);
  assert.equal(types,f.types);assert.equal(pin,a?a.newHash:f.hash,name+':one current exact body');
  assert.equal(definer,String(f.securityDefiner));assert.equal(defaults,String(f.defaults));assert.deepEqual([...args.matchAll(/'([^']+)'/g)].map(v=>v[1]),f.argumentNames);
  if(a){changed++;assert.equal(before[i][3],a.oldHash);assert.equal(service,String(a.serviceExecute));}
  else assert.deepEqual(after[i].slice(1),before[i].slice(1),name+':unchanged complete metadata');
 }
 assert.equal(changed,6);
 const mirrorSql=readFileSync(path.join(dir,r.file),'utf8').replaceAll('\r\n','\n'),mirrors=independentFunctionManifest(mirrorSql).filter(f=>f.name.startsWith('faolla_attendance_pd_'));
 assert.equal(mirrors.length,17);for(const mirror of mirrors)assert.doesNotMatch(mirror.body,/\bpg_proc\b|has_function_privilege\s*\(/,mirror.name+':no nested catalog profile');
 const forwarded=manifest.forward.find(f=>f.name===r.name);assert.equal(forwarded.serviceExecute,false);assert.equal(forwarded.defaults,1);assert.equal(forwarded.defaultExpression,'NULL::uuid');
 assert(!manifest.dependencies.some(f=>f.name===r.name),'one pre/post expectation through forward, not stale duplicate dependency');
 assert(!/or\s+.*[a-f0-9]{64}/.test(r.wrapper));
 assert.throws(()=>cycleApply(original.replace(r.changes[0].from,'0'.repeat(64)),r.changes,r.name));
});
test('default-off activation adds cycle only, never reminders or self plan rights',()=>{
 const activation=recipes[3].wrapper;assert(activation.includes("kind not in('application_window','review_routing','timesheet_cycle')"));
 assert(!activation.includes("kind in('application_window','review_routing','timesheet_cycle','reminders')"));
 assert.match(body('faolla_attendance_cycle_query_v1'),/access' not in\('owner','delegate'\)/);
 assert.match(body('faolla_attendance_operational_cycle_v1'),/not p_allow_accept or prep->>'state'<>'ready'/);
});
test('source codec excludes only observation time from preparation CAS and fixes compact historical source',()=>{
 const prep=body('faolla_attendance_cycle_preparation_v1');assert.match(prep,/x\.ordinality<>4/);assert.match(prep,/floor\(\(p_anchor-anchor\)::numeric\/14\)/);
 assert.match(prep,/make_date\(extract\(year from p_anchor\)/);assert.match(body('faolla_attendance_cycle_intent_v1'),/operational_punch_saved_source_v1\(p\.source_ref\)/);
 assert.match(body('faolla_attendance_cycle_intent_v1'),/'source',src,'preparation',prep/);
});
test('accept and cancel command hash is the root canonical query tuple and ordered command tuple',()=>{
 const command=body('faolla_attendance_cycle_command_v1');
 assert(command.includes("jsonb_build_array('attendance-cycle-command-v1',jsonb_build_array(p_query->'siteId',p_query->'access',p_query->'workerId',p_query->'grantId',p_query->'mode',p_query->'intentId'),p_actor,t)"));
 assert(command.indexOf("'expectedPreparationFingerprint','expectedFrameRevision','expectedFrameHeadOperationId','reason'")>0);
 assert.match(command,/expectedHeadOperationId' is distinct from p->'intentId'/);
});
test('frame heads are strictly derived with immutable lifecycle facts, not permanent one-frame prohibition',()=>{
 const heads=manifest.tables.find(t=>t.name==='merchant_attendance_cycle_frame_heads'),ops=manifest.tables.find(t=>t.name==='merchant_attendance_cycle_operations');
 assert(ops.constraints.some(c=>c.name.endsWith('frame_uq')&&c.keys.join(',')==='merchant_id,worker_id,frame_key,frame_revision'));
 assert(heads.constraints.some(c=>c.name.endsWith('operation_fk')&&c.deferred&&c.initiallyDeferred));
 assert.match(body('faolla_attendance_cycle_guard_v1'),/new\.revision<>old\.revision\+1/);
 assert.match(body('faolla_attendance_cycle_deferred_v1'),/h\.active_intent_id is distinct from \(case/);
 assert.match(body('faolla_attendance_operational_cycle_v1'),/if head\.frame_key is null then[\s\S]*else\s+update public\.merchant_attendance_cycle_frame_heads set revision=head\.revision\+1/);
 assert(!body('faolla_attendance_operational_cycle_v1').includes('on conflict(merchant_id,worker_id,frame_key)'));
});
test('all overlap checks use active managed heads and a single indexed predecessor',()=>{
 const gate=body('faolla_attendance_cycle_gate_v1');assert.match(gate,/active_intent_id is not null[\s\S]*order by x\.start_at desc limit 1/);
 assert.match(gate,/if p_intent is null then/);assert.match(gate,/attendance_operational_cycle_protocol_required/);
 assert.match(body('faolla_attendance_operational_cycle_v1'),/head\.active_intent_id is not null then raise exception 'attendance_operational_cycle_changed'/);
});
test('original recovery occurs before authority/current source and returns receipt only',()=>{
 const rpc=body('faolla_attendance_operational_cycle_v1');assert(rpc.indexOf('if opid is not null then')<rpc.indexOf('perform public.faolla_attendance_cycle_authority_v1'));
 const recovery=rpc.slice(rpc.indexOf('if opid is not null then'),rpc.indexOf('if iid is not null then'));
 assert.match(recovery,/op\.command is distinct from p_command/);assert.match(recovery,/op\.actor_auth_user_id<>p_auth_user_id/);assert.match(recovery,/'kind','receipt'/);
 assert(!recovery.includes('operational_source_v1('));assert(!recovery.includes('artifact_text'));
});
test('same original send is recovered minimally; old unlinked receipts cannot be retrofitted',()=>{
 const send=body('faolla_attendance_operational_cycle_send_v1');assert(send.indexOf('a.send_operation_id is not null')<send.indexOf('p_allow_write is distinct from true'));
 assert.match(send,/a\.query is distinct from p_query or a\.command is distinct from p_command or a\.intent is distinct from p_intent/);
 assert(send.indexOf("then raise exception 'attendance_operation_conflict'")<send.indexOf('cycle_core_owner_v2('));
 assert.match(send,/'periodOperation',public\.faolla_attendance_period_entry_v2\(ent\)/);assert(!send.includes('artifact_checked'));assert(!send.includes('artifact_text'));
});
test('explicit send GET recovery is own-actor, exact saved scope and full-SHA bound without command or reason input',()=>{
 const f=manifest.functions.find(f=>f.name==='faolla_attendance_operational_cycle_send_recover_v1'),s=body(f.name);
 assert.deepEqual(f.argumentNames,['p_query','p_auth_user_id','p_intent','p_expected_fingerprint']);assert.equal(f.defaults,0);
 for(const token of ["p_query->>'mode' is distinct from 'recover'",'a.actor_auth_user_id<>p_auth_user_id','a.query is distinct from detail_query','a.intent is distinct from p_intent',
  'a.command_fingerprint is distinct from p_expected_fingerprint','cycle_send_hash_v1(a.query,p_auth_user_id,a.command,a.intent)',
  "jsonb_set(jsonb_set(p_query,'{mode}','\"detail\"'::jsonb),'{operationId}','null'::jsonb)",
  "if a.send_operation_id is null then return common||jsonb_build_object('data',jsonb_build_object('kind','receipt'),'receipt',null)",
  'perform public.faolla_attendance_cycle_operation_proof_v1(op)',"'periodOperation',public.faolla_attendance_period_entry_v2(ent)"])assert(s.includes(token),token);
 assert(!/\b(?:insert|update|delete|perform public\.faolla_attendance_cycle_authority_v1)\b|p_allow|p_command|p_artifact|artifact_text|sourceCanonical|cycle_core_/.test(s));
});
test('link proof atomically binds the real original triple, actor, saved frame and complete request',()=>{
 const proof=body('faolla_attendance_cycle_operation_proof_v1');assert.match(proof,/v\.operation_id<>p\.operation_id or v\.artifact_id<>a\.artifact_id/);
 assert.match(proof,/ar\.source_fingerprint<>a\.source_fingerprint or ar\.artifact_sha256<>a\.artifact_sha256/);
 assert.match(proof,/ent\.revision,ent\.version,ent\.actor_auth_user_id/);
 assert.match(body('faolla_attendance_cycle_link_v1'),/perform public\.faolla_attendance_cycle_operation_proof_v1\(op\)/);
});
test('finite catalog guard preserves current197 capture,195 source and exact defaults/ACL',()=>{
 const capture=manifest.dependencies.find(f=>f.name==='faolla_attendance_disposal_artifact_capture_v1');assert.equal(capture.source,'202610080197_merchant_attendance_retention_disposal.sql');
 assert.equal(manifest.dependencies.find(f=>f.name==='faolla_attendance_period_closure_source_v1').hash,'f8e5831cc525021f0c26e833128bdcb2ec602bf7ad93289101440c3eb3061b3b');
 assert.equal(manifest.dependencies.find(f=>f.name==='faolla_attendance_period_closure_source_v1').serviceExecute,true);
 for(const s of [sections.preflight,sections.finalize]){assert.match(s,/pg_get_expr\(f\.proargdefaults,0\) is distinct from spec->>'defaultExpression'/);assert.match(s,/a\.grantor<>owner_id/);assert.match(s,/a\.is_grantable/);assert.match(s,/197_capture/);}
});
test('200 PG15 known constraint kinds have exact inheritance flags without relaxing keys or foreign metadata',()=>{
 assert.deepEqual([...new Set(manifest.tables.flatMap(t=>t.constraints.map(c=>c.kind)))].sort(),['c','f','p','u']);
 for(const s of [sections.preflight,sections.finalize])for(const token of ["coalesce(c->>'kind','') not in('c','p','u','f')", "con.connoinherit is distinct from ((c->>'kind') in('p','u','f'))",'not con.convalidated','not con.conislocal','con.coninhcount<>0','foreign_key:%','constraint_index:%'])assert(s.includes(token),token);
});
test('new SQL avoids the proven top-level IF CASE ambiguity',()=>{
 assert(!/\b(?:or|and)\s+case\b[^;]*end\s+then/i.test(sql));assert(!/is distinct from case\b/i.test(sql));
 assert.match(sections.preflight,/\+\(case when spec->>'name'/);
});
