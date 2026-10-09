import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createOutageRelationsNativePlan,outageRelationsProtectedSql} from './attendance-outage-relations-native.mjs';
const source=readFileSync(new URL('./attendance-outage-relations-native.mjs',import.meta.url),'utf8');
const input={site:'99990001',worker:'00000000-0000-4000-8000-000000000003',employee:'00000000-0000-4000-8000-000000000004',auth:'00000000-0000-4000-8000-000000000005',
 location:'00000000-0000-4000-8000-000000000006',workerVersion:2,employeeVersion:3,generation:0,startAt:'2026-10-05T08:00:00.000000Z',endAt:'2026-10-05T08:05:00.000000Z'};
test('three statements remain distinct despite same paper reference, and reverse queries identify one pair',()=>{
 const p=createOutageRelationsNativePlan(input);
 assert.equal(new Set([p.a.declarationId,p.b.declarationId,p.c.declarationId]).size,3);
 assert.equal(p.a.paperReference,p.b.paperReference);assert.equal(p.b.paperReference,p.c.paperReference);
 assert.equal(p.q().declarationId,p.q('detail','owner',true).relatedDeclarationId);
 assert.equal(p.q().relatedDeclarationId,p.q('detail','owner',true).declarationId);
 assert.equal('relatedDeclarationId' in p.q('list'),false);
 assert.deepEqual(p.q('recover','owner',false,p.fresh(10)).operationId,p.fresh(10));
});
test('protection hashes retain same-table history except exactly intended append',()=>{
 const names=['merchants','merchant_attendance_outage_relation_operations'];
 const sql=outageRelationsProtectedSql(names,[{table:names[1],key:'operation_id',value:createOutageRelationsNativePlan(input).fresh(10)}]);
 assert(sql.includes('from public.merchants outage_row)'));assert(sql.includes("where outage_row.operation_id<>'00000000-0000-4000-8000-000222000010'::uuid"));
 assert.throws(()=>outageRelationsProtectedSql(names,[{table:names[1],key:'operation_id',value:'unsafe'}]));
 assert.throws(()=>outageRelationsProtectedSql(names,[{table:names[1],key:'merchant_id',value:input.worker}]));
 assert.throws(()=>outageRelationsProtectedSql(names,[{table:'merchant_other',key:'operation_id',value:input.worker}]));
});
test('owned rollback actual RPCs cover new semantic boundaries and never reinterpret old ledger',()=>{
 for(const token of ['assertLifecycleSandbox','set local role','querySteps','projectOutageRelationsResult','unknown_recovery','reverse_same_operation','self_permission_revoked',
  'disabled_revoke','rebound_revoke','unrelated_same_paper','revoke_exact_replay','sourceReviewPeriodSemanticsUnchanged:true','rollback;'])assert(source.includes(token),token);
 for(const token of ['disable trigger','initdb','pg_dump','playwright','supabase.co'])assert(!source.includes(token),token);
 assert(!source.includes('update public.merchant_attendance_events'));
});
