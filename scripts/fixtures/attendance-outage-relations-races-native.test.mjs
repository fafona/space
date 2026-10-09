//Pure plan construction and static guards, not proof that native SQL ran.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageRelationRacePlan,outageRelationRaceGroups,outageRelationRaceWriteTables,
 outageRelationRaceProtectedSql,outageRelationRaceAllowances} from './attendance-outage-relations-races-native.mjs';
const source=readFileSync(new URL('./attendance-outage-relations-races-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:id(20),employee:id(21),auth:id(22),location:id(23),workerVersion:8,employeeVersion:4,generation:2,
 startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',now:'2026-10-07T12:00:00.000000Z',
 sealedStart:'2026-10-04T00:00:00.000000Z',sealedEnd:'2026-10-05T00:00:00.000000Z'};
const plans=outageRelationRaceGroups.map(group=>createOutageRelationRacePlan(input,group));
const has=(...tokens)=>tokens.forEach(token=>assert(source.includes(token),token));

test('five disjoint223 plans retain current identity and keep declarations outside existing sealed frame',()=>{
 assert.deepEqual(outageRelationRaceGroups,['apply_apply','apply_revoke','revoke_apply','same_operation','holder_rollback']);
 assert.equal(new Set(plans.flatMap(p=>p.operationIds)).size,26);
 for(const p of plans){
  assert.equal(p.incident.interval.startAt,input.startAt);assert.equal(p.incident.interval.endAt,input.endAt);
  assert.notEqual(p.left.declarationId,p.right.declarationId);
  for(const c of [p.left,p.right]){
   assert.deepEqual(c.interval,p.incident.interval);assert.equal(c.employeeId,input.employee);assert.equal(c.employeeAuthUserId,input.auth);
   assert.equal(c.workerId,input.worker);assert.equal(c.expectedWorkerVersion,8);assert.equal(c.expectedEmployeeVersion,4);assert.equal(c.expectedGeneration,2);
   assert.equal(c.originalOperationId,null);assert.equal(c.originalChannel,null);assert.equal(c.paperReference,null);
  }
  assert.equal(p.seed,['apply_revoke','revoke_apply'].includes(p.group));
  assert.deepEqual(p.q('recover','owner',true,p.fresh(12)),{siteId:input.site,access:'owner',mode:'recover',
   declarationId:p.right.declarationId,relatedDeclarationId:p.left.declarationId,operationId:p.fresh(12)});
  assert.deepEqual(p.q('list','self'),{siteId:input.site,access:'self',mode:'list',declarationId:p.left.declarationId});
 }
});
test('plans reject unsafe time, identity counter, group and operation range assumptions',()=>{
 for(const change of [{startAt:input.endAt},{now:input.endAt},{sealedEnd:'2026-10-06T00:00:00Z'},
  {sealedStart:'invalid'},{workerVersion:0},{employeeVersion:1.5},{generation:-1},{endAt:'2027-01-01T00:00:00Z'}])
  assert.throws(()=>createOutageRelationRacePlan({...input,...change},'apply_apply'));
 assert.throws(()=>createOutageRelationRacePlan(input,'other'));
 for(const n of [0,1000,-1,0.5])assert.throws(()=>plans[0].fresh(n));
});
test('allowances distinguish exact176 two-table append from181 append and deduplicate exact replay',()=>{
 const p=plans[0],apply={kind:'relations',c:{action:'apply',operationId:p.fresh(11)}};
 assert.deepEqual(outageRelationRaceAllowances(apply,apply),{merchant_attendance_outage_relation_operations:[p.fresh(11)]});
 assert.deepEqual(outageRelationRaceAllowances({kind:'outage',c:p.incident},{kind:'outage',c:p.left}),{
  merchant_attendance_outage_operations:[p.incident.operationId,p.left.operationId],
  merchant_attendance_outage_incidents:[p.incident.operationId],merchant_attendance_outage_declarations:[p.left.operationId]});
 assert.throws(()=>outageRelationRaceAllowances({kind:'links',c:apply.c}));
 assert.throws(()=>outageRelationRaceAllowances({kind:'relations',c:{action:'apply',operationId:id(204710)}}));
 assert.throws(()=>outageRelationRaceAllowances());
});
test('protection excludes only exact table, merchant and operation IDs; earlier rows remain hashed',()=>{
 const p=plans[0],names=['merchants','merchant_attendance_events',...outageRelationRaceWriteTables],allowed={merchant_attendance_outage_relation_operations:[p.fresh(11)]};
 const sql=outageRelationRaceProtectedSql(names,input.site,allowed);
 assert(sql.includes("relation_row.merchant_id='99990001'"));assert(sql.includes("'"+p.fresh(11)+"'::uuid"));
 assert(sql.includes('from public.merchant_attendance_events relation_row) relation_rows'));
 assert(sql.includes('from public.merchant_attendance_outage_operations relation_row) relation_rows'));
 assert(sql.includes('from public.merchant_attendance_outage_relation_operations relation_row where not'));
 assert(!outageRelationRaceProtectedSql(names,input.site).includes(' where not'));
 for(const bad of [{merchant_attendance_events:[p.fresh(11)]},{merchant_attendance_outage_relation_operations:[id(204710)]},
  {merchant_attendance_outage_relation_operations:[p.fresh(11),p.fresh(11)]}])assert.throws(()=>outageRelationRaceProtectedSql(names,input.site,bad));
 assert.throws(()=>outageRelationRaceProtectedSql(['unsafe;drop'],input.site));
 assert.throws(()=>outageRelationRaceProtectedSql(names,'production'));
});
test('runtime is inert, guarded and uses actual176181 service-role RPC plus real raw-source projectors',()=>{
 has('assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)','outageRelationsFoundation?.phase,222',
  'outageRelationsFoundation.rollbackRestored,true','d.guard',"t.tgenabled<>'O'",'not c.convalidated','c.relrowsecurity',
  'public.faolla_attendance_period_session_v1(',"[[startId,3,'clock_in'],[endId,4,'clock_out']]",
  'profile.session.ruleBinding.employeeAuthUserId,h.employeeAuthUserId','JSON.parse(savedArchive.artifactText).period',
  "outage:'faolla_attendance_outage_v1',relations:'faolla_attendance_outage_relations_v1'",'projectOutageResult','projectOutageRelationsResult',
  'set constraints all immediate;set constraints all deferred;reset role');
 for(const forbidden of ['spawn(','listen(','process.argv','pg_ctl','initdb','create database','disable trigger','session_replication_role',
  'set lock_timeout','set statement_timeout','insert into public.merchant_','update public.merchant_','delete from','merchant_attendance_outage_reviews_v1'])
  assert(!source.includes(forbidden),forbidden);
});
test('all commands are prepared before exact backend PID witness, with both same-pair revision orderings',()=>{
 has("holderAction=p.group==='revoke_apply'?'revoke':'apply'","waiterAction=p.group==='apply_revoke'?'revoke':'apply'",
  "p.q('detail','owner',true),command(p,12,waiterAction,reverse,'complementary')",
  'assert.equal(holder.c.expectedRevision,waiter.c.expectedRevision)','assert.equal(holder.c.expectedFingerprint,waiter.c.expectedFingerprint)',
  'lifecycleRace({connect:()=>native.connect(),query:sql=>native.query(sql),sql:scope.sql}',
  'statement(holder,outageRelationRaceAllowances(holder),true),statement(waiter,outageRelationRaceAllowances(waiter)),{rollback}',
  'assert.equal(raced.witnessed,true,p.group)','attendance_outage_relations_changed',
  "assert.equal(all(),holderHash,'outage_relation_failed_waiter_zero_writes')",'assertNoRow(waiter.c.operationId)');
 assert(!source.includes('setTimeout('));
});
test('same original command replay adds zero rows even gate-off; holder rollback leaves no original receipt',()=>{
 has("same=p.group==='same_operation',rollback=p.group==='holder_rollback'",'waiter=same?{...holder,allow:false}',
  'assert.deepEqual(replayed.receipt,holderValue.receipt)',"assert.equal(all(),holderHash,'outage_relation_concurrent_replay_zero_writes')",
  'rolledBackSuccessfulCommands++;assert.equal(raced.right.error,null);assertNoRow(holder.c.operationId)',
  "p.q('recover','owner',false,holder.c.operationId),null,false",'attendance_outage_relations_not_found',
  "assert.equal(all(),before,'outage_relation_rolled_back_receipt_read_zero_writes')",'assert.equal(winner.receipt.entry.revision,1)');
});
test('both-direction self history and original recovery remain exact after races without rewriting pending commands',()=>{
 has("p.q('detail','self',true)",'assert.deepEqual(other.current,current.current)',"p.q('history','self',true)",
  'assert.deepEqual(history.history,selfHistory.history)',"history.history.map(e=>e.revision),p.seed?[2,1]:[1]",
  "const recover={...original.q,mode:'recover',operationId:original.c.operationId}",
  "call(spec('relations',recover,null,false)).receipt,original.receipt",'call({...original,allow:false},true).receipt,original.receipt');
});
test('actual counts, old facts, definitions and both archives remain protected until outer cleanup',()=>{
 has("'outage_relation_exact_append_only'","'outage_relation_old_or_unauthorized_facts_changed'",'d.definitions(),defs','d.tableCatalog(),catalog',
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  'assert.deepEqual(periodAfter.period,periodBefore.period)','assert.equal(periodAfter.sourceChanged,false)',
  'merchant_attendance_outage_incidents:5,merchant_attendance_outage_declarations:10,merchant_attendance_outage_operations:15',
  'merchant_attendance_outage_relation_operations:7','assert.equal(committed.size,22)','assert.equal(rejections,4)',
  'assert.equal(rolledBackSuccessfulCommands,1)','assert.equal(replays,8)',
  'allIds.filter(op=>!committed.has(op))','committedOnlyInCallerOwnedSchema:true,allTransactionsRolledBack:false,cleanupByOuterOwnedSchema:true',
  'finally{preserve();}');
});
