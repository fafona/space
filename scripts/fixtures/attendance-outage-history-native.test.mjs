//Pure plan/static contract assertions only; root owns actual native execution.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {createOutageHistoryNativePlan,outageHistoryProtectedSql} from './attendance-outage-history-native.mjs';
const source=readFileSync(new URL('./attendance-outage-history-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:id(202),employee:id(102),auth:id(2),location:id(4),workerVersion:8,employeeVersion:5,generation:2,
 startAt:'2026-10-05T09:40:00.000000Z',endAt:'2026-10-05T09:45:00.000000Z',now:'2026-10-07T10:00:00.000000Z',
 sealedStart:'2026-10-04T00:00:00.000000Z',sealedEnd:'2026-10-05T00:00:00.000000Z'};
test('219 independent56-operation plan retains current dual identity and exact session-only interval',()=>{
 const p=createOutageHistoryNativePlan(input);assert.equal(p.operationIds.length,56);assert.equal(new Set(p.operationIds).size,56);
 assert.equal(p.declaration.workerId,input.worker);assert.equal(p.declaration.employeeId,input.employee);assert.equal(p.declaration.employeeAuthUserId,input.auth);
 assert.equal(p.declaration.expectedWorkerVersion,8);assert.equal(p.declaration.expectedEmployeeVersion,5);assert.equal(p.declaration.expectedGeneration,2);
 assert.deepEqual(p.incident.interval,p.declaration.interval);assert.equal(p.incident.interval.startAt,input.startAt);assert.equal(p.incident.interval.endAt,input.endAt);
 assert.equal(p.declaration.originalOperationId,null);assert.equal(p.declaration.originalChannel,null);
 assert.deepEqual(p.reference,{kind:'session',startEventId:id(204710),lastEventId:id(204711),lastSequence:4,effectOperationId:null,effectRevision:null});
 assert.deepEqual(p.query('history','self',2),{siteId:input.site,access:'self',mode:'history',declarationId:p.declaration.declarationId,beforeRevision:2});
 assert.equal(p.operation('links',27),id(219100127));assert.equal(p.operation('review',27),id(219100227));
 assert.throws(()=>p.operation('links',28));assert.throws(()=>p.operation('other',1));
 assert.throws(()=>createOutageHistoryNativePlan({...input,workerVersion:0}));
 assert.throws(()=>createOutageHistoryNativePlan({...input,now:input.startAt}));
 assert.throws(()=>createOutageHistoryNativePlan({...input,sealedEnd:'2026-10-05T10:00:00.000Z'}));
});
test('each write protects existing218 rows, other merchants and all other tables, permitting only one new219 operation',()=>{
 const names=['merchants','merchant_attendance_events','merchant_attendance_outage_operations','merchant_attendance_outage_review_operations'];
 const hash=outageHistoryProtectedSql(names,input.site,id(219100201));
 assert(hash.includes("history_row.merchant_id='99990001'"));assert(hash.includes("history_row.operation_id='"+id(219100201)+"'::uuid"));
 assert(hash.includes('from public.merchant_attendance_events history_row) history_rows'));
 assert(hash.includes('from public.merchant_attendance_outage_review_operations history_row where not'));
 assert.throws(()=>outageHistoryProtectedSql(names,input.site,id(218100010)));
 assert.throws(()=>outageHistoryProtectedSql(['bad;drop'],input.site,id(219100201)));
 assert.throws(()=>outageHistoryProtectedSql(names,'production',id(219100201)));
});
test('fixture is inert and one bounded transaction uses caller-owned guards and all default constraints',()=>{
 for(const token of ['assertLifecycleSandbox','assert.deepEqual(owned,d.owned)','assert.equal(owned.schema,scope.schema)','d.guard',
  "t.tgenabled<>'O'",'not c.convalidated','c.relrowsecurity',"steps.push('begin;'+prefix",'assert.equal(steps.length,90)','steps.length<=100',
  'native.querySteps(steps.map(sql=>scope.sql(sql)))',');rollback;'])assert(source.includes(token),token);
 for(const forbidden of ['native.connect(','initdb','pg_ctl','spawn(','process.argv','disable trigger','session_replication_role',
  'set statement_timeout','set lock_timeout','insert into public.merchant_attendance_events','delete from'])assert(!source.includes(forbidden),forbidden);
 assert(!source.includes("where merchant_id=${site}),'"),'must not require empty outage tables after218');
});
test('all new history comes from actual176177178 calls with previous server revision and result version',()=>{
 for(const token of ['faolla_attendance_outage_v1','faolla_attendance_outage_links_v1','faolla_attendance_outage_review_v1',
  "saved('links_write_'+(n-1))","saved('review_write_'+(n-1))","->'receipt'->'entry'->'revision'","->'receipt'->'entry'->'resultVersion'",
  "n%2?'propose':'confirm'","action==='confirm'?'self':'owner'",'set constraints all immediate;set constraints all deferred;reset role'])assert(source.includes(token),token);
 for(const forbidden of ['insert into public.merchant_attendance_outage','update public.merchant_attendance_outage'])assert(!source.includes(forbidden),forbidden);
});
test('25 and26 pages are observed before27 append, and original cursors are reused for both roles',()=>{
 for(const kind of ['links','review']){
  assert(source.includes(kind+'_at25_'));assert(source.includes(kind+'_at26_'));
  const writer=kind==='links'?'linkWrite':'reviewWrite';
  assert(source.indexOf(writer+'(26)')<source.indexOf(writer+'(27)'));
  assert(source.includes(writer+"(27);boundaries('"+kind+"')"));
 }
 for(const token of ["saved(kind+'_at26_'+access)","saved(kind+'_tail_'+access)","->'history'->-1->'revision'",
  'first26.history.at(-1).revision','last.revision,27','new Set(chain.map(x=>x.operationId)).size,26',
  'Array.from({length:26},(_,i)=>p.operation(kind,26-i))','parsed.get(kind+\'_old_anchor\').history,parsed.get(kind+\'_at26_owner\').history'])assert(source.includes(token),token);
});
test('empty final page, invalid zero/upper cursor, bounded history DTO and owner/self parity are explicit',()=>{
 for(const token of ['first25.historyTruncated,false','first26.historyTruncated,true','last.historyTruncated,false','end.history,[]',
  "kind==='links'?102:1002","error:'attendance_invalid_request'",'value.canWrite,false','value.current,null','value.receipt,null',
  'value.proposal,null','value.response,null','value.status,null','value.preview,null',
  "['at25','at26','tail','end']"])assert(source.includes(token),token);
});
test('all success output goes through real projectors and every read/replay/rejection hashes complete current facts',()=>{
 for(const token of ['projectOutageResult','projectOutageLinksResult','projectOutageReviewResult',
  'projectors[row.kind](row.value,row.query,row.actor,row.command)',"'outage_history_projection:'+row.label",
  'write?outageHistoryProtectedSql(names,d.site,op):fullHash',"'outage_history_read_rejection_or_preexisting_rows_changed'",
  'assert.equal(row.before,row.after)','assert.equal(rows.filter(x=>x.error).length,4)'])assert(source.includes(token),token);
});
test('old owner/self operation receipts survive new heads and exact flagoff replays, not automatic retry',()=>{
 for(const token of ["savedCommand('links_write_1')",'links_original_recover','links_original_replay',"[[1,'owner'],[2,'self']]",
  'review_original_recover_','review_original_replay_','allow:false,replay:true','value.receipt.entry.actorId,n%2?d.owner:h.employeeAuthUserId',
  "parsed.get('review_write_'+n).receipt",'actualSelfConfirmations:13,actualOwnerProposals:14'])assert(source.includes(token),token);
});
test('rollback compares the complete218 starting state, definitions/catalog and both immutable archives',()=>{
 for(const token of ['new AggregateError(failures','outage_history_rollback_',
  "['facts',()=>d.fingerprint(),baseline]","['definitions',()=>d.definitions(),defs]","['catalog',()=>d.tableCatalog(),catalog]",
  'archive().artifactText,oldArchive.artifactText','archive().artifactSha256,oldArchive.artifactSha256',
  'periodArchive().artifactText,savedArchive.artifactText','periodArchive().artifactSha256,savedArchive.artifactSha256',
  'finalPeriod.period,initialPeriod.period','finalPeriod.sourceChanged,initialPeriod.sourceChanged',
  'merchant_attendance_outage_link_operations:27,merchant_attendance_outage_review_operations:27',
  'preexisting218FactsPreserved:true,rollbackRestored:true'])assert(source.includes(token),token);
});
