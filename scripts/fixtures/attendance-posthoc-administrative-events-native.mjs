//195-only owned acceptance capability. No import performs a database operation.
//The fixed producer may append three events, not an arbitrary tenant footprint.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {posthocRecoveryProtectedTables} from './attendance-posthoc-recovery-events-native.mjs';

const site='99990196',workers=[id(245700005),id(245700008)];
const employees=[id(245700006),id(245700009)],auths=[id(245700007),id(245700010)];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const expected=[[workers[0],1,'clock_in'],[workers[0],2,'break_start'],[workers[1],1,'clock_in']];
const serializationSql="jsonb_build_object('user',current_user,'timeZone',current_setting('TimeZone'),'dateStyle',current_setting('DateStyle'),'floatDigits',current_setting('extra_float_digits'))";
function exact(value,keys,label){
 assert(value&&typeof value==='object'&&!Array.isArray(value),label);
 assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);return value;
}
function serialization(value){
 exact(value,['user','timeZone','dateStyle','floatDigits'],'posthoc_administrative_serialization_shape');
 for(const v of Object.values(value))assert(typeof v==='string'&&v.length>0&&v.length<=64,'posthoc_administrative_serialization_scalar');
 assert.equal(value.user,'postgres','posthoc_administrative_owner_role');return value;
}
function filteredFactsSql(ids){
 assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);ids.forEach(value=>assert.match(value,uuid));
 return 'select md5(jsonb_build_object('+posthocRecoveryProtectedTables.map(table=>
  `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r`+
  (table==='merchant_attendance_events'?` where not (r.merchant_id=${quote(site)} and r.id in (${ids.map(quote).join(',')}))`:'')+')').join(',')+')::text);';
}
function snapshotSql(){
 return `select jsonb_build_object('serialization',${serializationSql},
  'count',(select count(*) from public.merchant_attendance_events where merchant_id=${quote(site)}),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'siteId',e.merchant_id,'workerId',e.worker_id,
   'sequence',e.sequence,'action',e.action,'rowHash',md5(to_jsonb(e)::text)) order by e.worker_id,e.sequence,e.id),'[]'::jsonb)
   from (select * from public.merchant_attendance_events where merchant_id=${quote(site)} order by worker_id,sequence,id limit 3) e));`;
}
export function createPosthocAdministrativeEventsGuard({d,h,originalTables,originalFacts}){
 assert.deepEqual(originalTables,posthocRecoveryProtectedTables);assert.match(originalFacts,/^[a-f0-9]{32}$/);
 let armed=false,sealed=null,originalSerialization=null;
 const owned=()=>{
  assert(d.syntheticOnly===true&&h.syntheticOnly===true,'posthoc_administrative_synthetic_context_required');
  assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned,'posthoc_administrative_owned_namespace');
 };
 const snapshot=()=>{
  const value=JSON.parse(d.exec(snapshotSql()));exact(value,['serialization','count','items'],'posthoc_administrative_snapshot_shape');
  assert.deepEqual(serialization(value.serialization),originalSerialization,'posthoc_administrative_serialization_changed');
  assert.equal(value.count,3,'posthoc_administrative_exactly_three_events');
  assert(Array.isArray(value.items)&&value.items.length===3,'posthoc_administrative_exactly_three_items');
  for(const row of value.items){exact(row,['id','siteId','workerId','sequence','action','rowHash'],'posthoc_administrative_event_shape');
   assert.match(row.id,uuid);assert.equal(row.siteId,site);assert.match(row.rowHash,/^[a-f0-9]{32}$/);}
  assert.equal(new Set(value.items.map(row=>row.id)).size,3,'posthoc_administrative_distinct_event_ids');
  assert.deepEqual(value.items.map(row=>[row.workerId,row.sequence,row.action]),expected,'posthoc_administrative_fixed_worker_actions');return value;
 };
 return Object.freeze({
  isArmed:()=>armed,
  arm(){
   assert(!armed,'posthoc_administrative_already_armed');owned();
   assert.equal(d.fingerprint(posthocRecoveryProtectedTables),originalFacts,'posthoc_administrative_registration_changed_original_facts');
   const value=JSON.parse(d.exec(`select jsonb_build_object('serialization',${serializationSql},'fresh',
    not exists(select 1 from public.merchants where id=${quote(site)})
    and not exists(select 1 from public.merchant_attendance_workers where id in (${workers.map(quote).join(',')}))
    and not exists(select 1 from public.merchant_enterprise_employees where id in (${employees.map(quote).join(',')}) or auth_user_id in (${auths.map(quote).join(',')}))
    and not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(site)} or worker_id in (${workers.map(quote).join(',')})));`));
   exact(value,['serialization','fresh'],'posthoc_administrative_fresh_shape');assert.equal(value.fresh,true,'posthoc_administrative_fresh_fixed_identity_required');
   originalSerialization=serialization(value.serialization);armed=true;
  },
  seal(){
   assert(armed&&!sealed,'posthoc_administrative_seal_requires_once_armed');owned();const value=snapshot();
   assert.equal(d.exec(filteredFactsSql(value.items.map(row=>row.id))),originalFacts,'posthoc_administrative_changed_original_or_undeclared_rows');sealed=value;
  },
  verify(){
   assert(armed&&sealed,'posthoc_administrative_verify_requires_sealed');owned();const value=snapshot();
   assert.deepEqual(value,sealed,'posthoc_administrative_sealed_rows_changed');
   assert.equal(d.exec(filteredFactsSql(sealed.items.map(row=>row.id))),originalFacts,'posthoc_administrative_changed_original_or_undeclared_rows');return 3;
  },
 });
}
