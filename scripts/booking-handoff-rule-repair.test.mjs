import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isolatedBookingActivationAcceptanceSql} from './booking-handoff-activation.mjs';
import {planBookingRuleOptionRepair,guardedProductionBookingRepairActivationSql,
  isolatedBookingRepairActivationAcceptanceSql} from './booking-handoff-rule-repair.mjs';

const clone=structuredClone,hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const seal=p=>{delete p.planSha256;p.originalSha256=hash(JSON.stringify(canonical(p.original)));p.nextSha256=hash(JSON.stringify(canonical(p.next)));return {...p,planSha256:hash(JSON.stringify(canonical(p)))};};
function fixture(){
  const entry={viewport:'desktop',blockId:'booking-1',availableTimeRanges:['10:00-11:00'],timeSlotRules:[{timeRange:'10:00-11:00',capacity:3}],
    blockedDates:['2026-12-25'],holidayDates:[],maxBookingsPerSlot:null};
  const snapshot={version:1,siteId:'12345678',publishedAt:'2026-05-01T18:42:36.172Z',entries:[entry]};
  const rulesRow={id:'00000000-0000-4000-8000-000000000001',merchant_id:'__faolla_booking_persistence__',
    slug:'__merchant_booking_rules__:v1',blocks:{version:1,snapshots:{'12345678':snapshot}},rowSha256:'a'.repeat(64)};
  const publishedRows=[{id:'00000000-0000-4000-8000-000000000002',merchant_id:'12345678',slug:null,
    blocks:[],rowSha256:'b'.repeat(64)}];
  const expected={...clone(snapshot),entries:[{...clone(entry),storeOptions:["Store's main",'Store 2','Store 3'],itemOptions:['A','B','C','D','E'],titleOptions:['Ms','Mr']}]};
  return {rulesRow,publishedRows,expected,buildSnapshot:(siteId,blocks,publishedAt)=>({...clone(expected),siteId,publishedAt})};
}
const isolatedBefore={systemIdentifier:'7000000000000000001',databaseOid:'12345',serverVersionNum:'150008',
  generation:'10000000-0000-4000-8000-000000000001',revision:'0',protocol:2,active:false,
  savedBookingRowsSha256:'c'.repeat(64),commands:0,mailJobs:0};
const sqlFor=(plan,before=isolatedBefore)=>isolatedBookingRepairActivationAcceptanceSql({before,plan,
  databaseName:'faolla_booking_activation_1234567890abcdef',backupSealSha256:'d'.repeat(64)});

test('only the three missing arrays are copied; all other fields and original inputs remain identical',()=>{
  const f=fixture(),original=clone({rulesRow:f.rulesRow,publishedRows:f.publishedRows}),plan=planBookingRuleOptionRepair(f);
  assert.deepEqual(f.rulesRow,original.rulesRow);assert.deepEqual(f.publishedRows,original.publishedRows);
  assert.deepEqual(plan.next.snapshots['12345678'],f.expected);
  assert.equal(plan.next.snapshots['12345678'].publishedAt,original.rulesRow.blocks.snapshots['12345678'].publishedAt);
  assert.deepEqual(plan.repairs,[{siteId:'12345678',viewport:'desktop',blockId:'booking-1',index:0,fields:['storeOptions','itemOptions','titleOptions']}]);
  assert.deepEqual(plan.sources,[{id:f.publishedRows[0].id,merchantId:'12345678',rowSha256:'b'.repeat(64)}]);
  assert.match(plan.planSha256,/^[a-f0-9]{64}$/);
});

test('existing explicit options, even empty arrays, are not overwritten',()=>{
  for(const existing of [[],['kept']]){
    const f=fixture();f.rulesRow.blocks.snapshots['12345678'].entries[0].storeOptions=existing;
    assert.throws(()=>planBookingRuleOptionRepair(f),/unapproved_semantic_difference/);
    f.expected.entries[0].storeOptions=existing;
    const plan=planBookingRuleOptionRepair(f);
    assert.deepEqual(plan.next.snapshots['12345678'].entries[0].storeOptions,existing);
    assert.deepEqual(plan.repairs[0].fields,['itemOptions','titleOptions']);
  }
});

test('null, string, malformed arrays, duplicate bindings, unknown fields and non-option changes fail closed',()=>{
  const mutations=[
    f=>{f.rulesRow.blocks.snapshots['12345678'].entries[0].storeOptions=null;},
    f=>{f.rulesRow.blocks.snapshots['12345678'].entries[0].itemOptions='bad';},
    f=>{f.expected.entries[0].itemOptions=['A','A'];},
    f=>{f.expected.entries[0].itemOptions=[' A'];},
    f=>{f.expected.entries[0].itemOptions=[];},
    f=>{f.expected.entries[0].titleOptions=[1];},
    f=>{f.expected.entries[0].blockId='different';},
    f=>{f.expected.entries.push(clone(f.expected.entries[0]));},
    f=>{f.rulesRow.blocks.snapshots['12345678'].entries.push(clone(f.rulesRow.blocks.snapshots['12345678'].entries[0]));},
    f=>{f.expected.entries[0].maxBookingsPerSlot=7;},
    f=>{f.expected.entries[0].blockedDates=[];},
    f=>{f.expected.entries[0].timeSlotRules[0].capacity=9;},
    f=>{f.expected.extra='unknown';},
    f=>{f.rulesRow.blocks.snapshots['12345678'].siteId='87654321';},
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>planBookingRuleOptionRepair(f));}
});

test('source binding requires exactly one real published page and exact block/viewport identity',()=>{
  for(const mutate of [f=>{f.publishedRows=[];},f=>{f.publishedRows.push(clone(f.publishedRows[0]));},
    f=>{f.publishedRows[0].slug='__draft';},f=>{f.publishedRows[0].rowSha256='bad';},
    f=>{f.expected.entries[0].viewport='mobile';},f=>{f.publishedRows[0].id='invalid';}]){
    const f=fixture();mutate(f);assert.throws(()=>planBookingRuleOptionRepair(f));
  }
  const f=fixture();f.buildSnapshot=()=>({...clone(f.expected),publishedAt:'2026-10-26T00:00:00Z'});
  assert.throws(()=>planBookingRuleOptionRepair(f),/builder_identity/);
});

test('reordered published entries cannot conceal an unrelated array-order change',()=>{
  const f=fixture(),second=clone(f.rulesRow.blocks.snapshots['12345678'].entries[0]);second.blockId='booking-2';second.viewport='mobile';
  f.rulesRow.blocks.snapshots['12345678'].entries.push(second);
  f.expected.entries.unshift({...clone(second),storeOptions:['3'],itemOptions:['C'],titleOptions:['X']});
  // Entire snapshot comparison intentionally rejects reordering: no unrelated
  // mutation is hidden behind a successful binding lookup.
  assert.throws(()=>planBookingRuleOptionRepair(f),/unapproved_snapshot_difference/);
});

test('the composed transaction keeps the original activation body and repair is before its flip',()=>{
  const plan=planBookingRuleOptionRepair(fixture()),sql=sqlFor(plan);
  for(const token of ['begin;',"lock_timeout='2s'","statement_timeout='20s'",'in share row exclusive mode',
    'booking_rule_repair_saved_rows_changed','booking_rule_repair_published_source_changed','booking_rule_repair_primary_ambiguous',
    'booking_rule_repair_original_changed','booking_rule_repair_other_fields_changed','booking_rule_repair_other_saved_rows_changed',
    'transaction_timestamp()','set_config(\'faolla.booking_handoff_expected\'','booking_activation_changed_saved_data',"Store''s main"])
    assert.ok(sql.includes(token),token);
  assert.equal((sql.match(/update public\.pages/g)??[]).length,1);
  assert.equal((sql.match(/update public\.faolla_booking_atomic_control/g)??[]).length,1);
  assert.ok(sql.indexOf('update public.pages')<sql.indexOf('update public.faolla_booking_atomic_control'));
  assert.equal((sql.match(/\bbegin;/g)??[]).length,1);assert.equal((sql.match(/\bcommit;/g)??[]).length,1);
  const original=isolatedBookingActivationAcceptanceSql({before:isolatedBefore,databaseName:'faolla_booking_activation_1234567890abcdef'});
  const activationBody=value=>value.slice(value.lastIndexOf('lock table public.pages'),value.indexOf('end;$booking_handoff_activate$;')+'end;$booking_handoff_activate$;'.length);
  assert.equal(activationBody(sql),activationBody(original));
  assert.doesNotMatch(sql,/disable trigger|enable trigger|session_replication_role|delete from|truncate |drop (?:table|function|schema)|create (?:or replace )?function|set active=false|\bfetch\(/i);
});

test('even re-sealed plans cannot alter any unrelated field, overwrite options or invent bindings',()=>{
  const plan=planBookingRuleOptionRepair(fixture());
  const mutations=[p=>{p.next.snapshots['12345678'].publishedAt='2026-01-01';},p=>{p.next.version=2;},
    p=>{p.next.snapshots['12345678'].entries[0].maxBookingsPerSlot=99;},
    p=>{p.repairs[0].fields.push('blockedDates');},p=>{p.repairs[0].index=9;},
    p=>{p.repairs.push(clone(p.repairs[0]));},p=>{p.sources[0].merchantId='87654321';},
    p=>{p.sources.push(clone(p.sources[0]));},p=>{p.original.snapshots['12345678'].entries[0].storeOptions=[];}];
  for(const mutate of mutations){const changed=clone(plan);mutate(changed);assert.throws(()=>sqlFor(seal(changed)));}
  for(const field of ['rowSha256','originalSha256','nextSha256','planSha256']){
    const changed=clone(plan);changed[field]='0'.repeat(64);assert.throws(()=>sqlFor(changed));
  }
});

test('production construction never accepts synthetic or broadened repair scope; isolated SQL independently fences production',()=>{
  const plan=planBookingRuleOptionRepair(fixture()),production={...isolatedBefore,systemIdentifier:'7612049595342295079',databaseOid:'5'};
  assert.throws(()=>guardedProductionBookingRepairActivationSql({before:production,plan,backupSealSha256:'d'.repeat(64)}),/approved_scope/);
  assert.throws(()=>sqlFor(plan,production),/isolated_identity/);
  assert.match(sqlFor(plan),/or \(select system_identifier::text from pg_control_system\(\)\)='7612049595342295079'/);
  for(const backupSealSha256 of ['',null,"x';select 1;--",'d'.repeat(64)+'\n'])assert.throws(()=>
    isolatedBookingRepairActivationAcceptanceSql({before:isolatedBefore,databaseName:'faolla_booking_activation_1234567890abcdef',plan,backupSealSha256}));
});

test('module is SQL/planning only, with no hidden execution, credentials or retry path',()=>{
  const source=readFileSync(new URL('./booking-handoff-rule-repair.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/from ['"]node:(?:fs|child_process)|process\.env|spawnSync\(|writeFileSync\(|while\(|--skip|--force/);
});
