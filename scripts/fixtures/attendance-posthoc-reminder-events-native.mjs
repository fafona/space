// Fixed195 + fixed201 composition only. It freezes the three already-verified
//195 events and the one real193 clock-in's event/relation/empty-adoption rows.
//No arbitrary tenant/table/ID exclusion, database write, or import-time work.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';
import {posthocRecoveryProtectedTables} from './attendance-posthoc-recovery-events-native.mjs';
const administrativeSite='99990196',site='99990201',worker=id(201900020),employee=id(201900021),auth=id(201900022),location=id(201900003),operation=id(201901010);
const administrativeExpected=[[id(245700005),1,'clock_in'],[id(245700005),2,'break_start'],[id(245700008),1,'clock_in']];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,hash=/^[a-f0-9]{32}$/;
const serializationSql="jsonb_build_object('user',current_user,'timeZone',current_setting('TimeZone'),'dateStyle',current_setting('DateStyle'),'floatDigits',current_setting('extra_float_digits'))";
function exact(value,keys,label){assert(value&&typeof value==='object'&&!Array.isArray(value),label);assert.deepEqual(Object.keys(value).sort(),[...keys].sort(),label);return value;}
function serialization(value){
 exact(value,['user','timeZone','dateStyle','floatDigits'],'posthoc_reminder_serialization_shape');
 for(const v of Object.values(value))assert(typeof v==='string'&&v.length>0&&v.length<=64,'posthoc_reminder_serialization_scalar');
 assert.equal(value.user,'postgres','posthoc_reminder_owner_role');return value;
}
function snapshotSql(){return `select jsonb_build_object('serialization',${serializationSql},
 'administrative',jsonb_build_object('count',(select count(*) from public.merchant_attendance_events where merchant_id=${quote(administrativeSite)}),
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'siteId',e.merchant_id,'workerId',e.worker_id,'sequence',e.sequence,'action',e.action,'rowHash',md5(to_jsonb(e)::text)) order by e.worker_id,e.sequence,e.id),'[]'::jsonb)
  from (select * from public.merchant_attendance_events where merchant_id=${quote(administrativeSite)} order by worker_id,sequence,id limit 3) e)),
 'reminders',jsonb_build_object('eventCount',(select count(*) from public.merchant_attendance_events where merchant_id=${quote(site)}),
 'relationCount',(select count(*) from public.merchant_attendance_shift_schedule_relations where merchant_id=${quote(site)}),
 'adoptionCount',(select count(*) from public.merchant_attendance_shift_plan_adoptions where merchant_id=${quote(site)}),
 'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'siteId',e.merchant_id,'workerId',e.worker_id,'employeeId',e.actor_employee_id,'operationId',e.operation_id,
  'locationId',e.location_id,'sequence',e.sequence,'action',e.action,'source',e.source,'rowHash',md5(to_jsonb(e)::text)) order by e.id),'[]'::jsonb)
  from (select * from public.merchant_attendance_events where merchant_id=${quote(site)} order by id limit 1) e),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('eventId',r.start_event_id,'siteId',r.merchant_id,'workerId',r.worker_id,'employeeId',r.employee_id,'authId',r.employee_auth_user_id,
  'operationId',r.operation_id,'locationId',r.location_id,'sequence',r.sequence,'status',r.status,'selection',r.selection,'slotId',r.slot_id,'slotRevision',r.slot_revision,
  'reason',r.reason,'slotSnapshot',r.slot_snapshot,'publicationSnapshot',r.publication_snapshot,'cancellationSnapshot',r.cancellation_snapshot,'rowHash',md5(to_jsonb(r)::text)) order by r.start_event_id),'[]'::jsonb)
  from (select * from public.merchant_attendance_shift_schedule_relations where merchant_id=${quote(site)} order by start_event_id limit 1) r),
 'adoptions',(select coalesce(jsonb_agg(jsonb_build_object('eventId',a.start_event_id,'siteId',a.merchant_id,'workerId',a.worker_id,'employeeId',a.employee_id,'authId',a.employee_auth_user_id,
  'operationId',a.operation_id,'channel',a.channel,'slotId',a.slot_id,'approvalId',a.approval_operation_id,'status',a.adoption->>'status','reason',a.adoption->'reason',
  'approval',a.adoption->'approval','rowHash',md5(to_jsonb(a)::text)) order by a.start_event_id),'[]'::jsonb)
  from (select * from public.merchant_attendance_shift_plan_adoptions where merchant_id=${quote(site)} order by start_event_id limit 1) a)));`;}
function filteredFactsSql(administrativeIds,eventId=null){
 assert.equal(administrativeIds.length,3);assert.equal(new Set(administrativeIds).size,3);administrativeIds.forEach(v=>assert.match(v,uuid));
 if(eventId!==null)assert.match(eventId,uuid);
 return 'select md5(jsonb_build_object('+posthocRecoveryProtectedTables.map(table=>{
  let exclusion='';
  if(table==='merchant_attendance_events')exclusion=` where not ((r.merchant_id=${quote(administrativeSite)} and r.id in (${administrativeIds.map(quote).join(',')}))`+
   (eventId!==null?` or (r.merchant_id=${quote(site)} and r.id=${quote(eventId)})`:'')+')';
  else if(eventId!==null&&['merchant_attendance_shift_schedule_relations','merchant_attendance_shift_plan_adoptions'].includes(table))
   exclusion=` where not (r.merchant_id=${quote(site)} and r.start_event_id=${quote(eventId)})`;
  return `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r${exclusion})`;
 }).join(',')+')::text);';
}
function administrative(value){
 exact(value,['count','items'],'posthoc_reminder_administrative_shape');assert.equal(value.count,3,'posthoc_reminder_administrative_count');
 assert(Array.isArray(value.items)&&value.items.length===3,'posthoc_reminder_administrative_items');
 for(const row of value.items){exact(row,['id','siteId','workerId','sequence','action','rowHash'],'posthoc_reminder_administrative_row_shape');
  assert.match(row.id,uuid);assert.equal(row.siteId,administrativeSite);assert.match(row.rowHash,hash);}
 assert.equal(new Set(value.items.map(r=>r.id)).size,3,'posthoc_reminder_administrative_distinct_ids');
 assert.deepEqual(value.items.map(r=>[r.workerId,r.sequence,r.action]),administrativeExpected,'posthoc_reminder_administrative_fixed_actions');return value;
}
function reminders(value,required){
 exact(value,['eventCount','relationCount','adoptionCount','events','relations','adoptions'],'posthoc_reminder_footprint_shape');
 for(const [count,items]of[['eventCount','events'],['relationCount','relations'],['adoptionCount','adoptions']]){
  assert.equal(value[count],required,'posthoc_reminder_exact_one_or_zero:'+count);assert(Array.isArray(value[items])&&value[items].length===required,'posthoc_reminder_exact_items:'+items);
 }
 if(!required)return value;
 const e=value.events[0],r=value.relations[0],a=value.adoptions[0];
 exact(e,['id','siteId','workerId','employeeId','operationId','locationId','sequence','action','source','rowHash'],'posthoc_reminder_event_shape');
 exact(r,['eventId','siteId','workerId','employeeId','authId','operationId','locationId','sequence','status','selection','slotId','slotRevision','reason','slotSnapshot','publicationSnapshot','cancellationSnapshot','rowHash'],'posthoc_reminder_relation_shape');
 exact(a,['eventId','siteId','workerId','employeeId','authId','operationId','channel','slotId','approvalId','status','reason','approval','rowHash'],'posthoc_reminder_adoption_shape');
 assert.match(e.id,uuid);for(const row of[e,r,a]){
  assert.equal(row.siteId,site);assert.equal(row.workerId,worker);assert.equal(row.employeeId,employee);assert.equal(row.operationId,operation);assert.match(row.rowHash,hash);
 }
 assert.equal(e.sequence,1);assert.equal(e.action,'clock_in');assert.equal(e.source,'web');assert.equal(e.locationId,location);
 assert.equal(r.eventId,e.id);assert.equal(a.eventId,e.id);assert.equal(r.authId,auth);assert.equal(a.authId,auth);assert.equal(r.locationId,location);assert.equal(r.sequence,1);
 assert.equal(r.status,'unselected');for(const key of['selection','slotId','slotRevision','reason','slotSnapshot','publicationSnapshot','cancellationSnapshot'])assert.equal(r[key],null,'posthoc_reminder_no_selection:'+key);
 assert.equal(a.channel,'self');assert.equal(a.status,'unselected');for(const key of['slotId','approvalId','reason','approval'])assert.equal(a[key],null,'posthoc_reminder_empty_adoption:'+key);return value;
}
export function createPosthocReminderEventsGuard({d,h,originalTables,originalFacts,administrativeEvents}){
 assert.deepEqual(originalTables,posthocRecoveryProtectedTables);assert.match(originalFacts,hash);
 assert(administrativeEvents&&typeof administrativeEvents.isArmed==='function'&&typeof administrativeEvents.verify==='function','posthoc_reminder_fixed_administrative_capability_required');
 let armed=false,sealed=null,frozenAdministrative=null,originalSerialization=null;const dispatches=[];
 const run=(label,sql)=>{assert(dispatches.length<64,'posthoc_reminder_max64_protection_dispatches');dispatches.push(label);return d.exec(sql);};
 const owned=()=>{assert(d.syntheticOnly===true&&h.syntheticOnly===true,'posthoc_reminder_synthetic_context_required');
  assert.deepEqual(assertLifecycleSandbox(sql=>run('owned_namespace',sql)),d.owned,'posthoc_reminder_owned_namespace');};
 const snapshot=()=>{
  const value=JSON.parse(run('fixed_snapshot',snapshotSql()));exact(value,['serialization','administrative','reminders'],'posthoc_reminder_snapshot_shape');
  assert.deepEqual(serialization(value.serialization),originalSerialization,'posthoc_reminder_serialization_changed');administrative(value.administrative);return value;
 };
 return Object.freeze({
  isArmed:()=>armed,
  arm(){
   assert(!armed,'posthoc_reminder_already_armed');owned();assert(administrativeEvents.isArmed(),'posthoc_reminder_administrative_must_be_sealed');
   assert.equal(administrativeEvents.verify(),3,'posthoc_reminder_administrative_exact_original');
   const fresh=JSON.parse(run('fresh_fixed_identity',`select jsonb_build_object('serialization',${serializationSql},'fresh',
    not exists(select 1 from public.merchants where id=${quote(site)})
    and not exists(select 1 from public.merchant_attendance_workers where id=${quote(worker)})
    and not exists(select 1 from public.merchant_enterprise_employees where id=${quote(employee)} or auth_user_id=${quote(auth)})
    and not exists(select 1 from public.merchant_attendance_events where merchant_id=${quote(site)} or worker_id=${quote(worker)} or operation_id=${quote(operation)})
    and not exists(select 1 from public.merchant_attendance_shift_schedule_relations where merchant_id=${quote(site)} or worker_id=${quote(worker)} or operation_id=${quote(operation)})
    and not exists(select 1 from public.merchant_attendance_shift_plan_adoptions where merchant_id=${quote(site)} or worker_id=${quote(worker)} or operation_id=${quote(operation)}));`));
   exact(fresh,['serialization','fresh'],'posthoc_reminder_fresh_shape');assert.equal(fresh.fresh,true,'posthoc_reminder_fresh_fixed_identity_required');originalSerialization=serialization(fresh.serialization);
   const value=snapshot();reminders(value.reminders,0);frozenAdministrative=value.administrative;
   assert.equal(run('original_five_union_before',filteredFactsSql(frozenAdministrative.items.map(row=>row.id))),originalFacts,'posthoc_reminder_changed_original_or_undeclared_rows');armed=true;
  },
  seal(){
   assert(armed&&!sealed,'posthoc_reminder_seal_requires_once_armed');owned();const value=snapshot();
   assert.deepEqual(value.administrative,frozenAdministrative,'posthoc_reminder_administrative_sealed_rows_changed');reminders(value.reminders,1);
   assert.equal(run('original_five_union_seal',filteredFactsSql(frozenAdministrative.items.map(row=>row.id),value.reminders.events[0].id)),originalFacts,'posthoc_reminder_changed_original_or_undeclared_rows');sealed=value;
  },
  verify(){
   assert(armed,'posthoc_reminder_verify_requires_armed');owned();const value=snapshot();
   assert.deepEqual(value.administrative,frozenAdministrative,'posthoc_reminder_administrative_sealed_rows_changed');reminders(value.reminders,sealed?1:0);
   if(sealed)assert.deepEqual(value,sealed,'posthoc_reminder_sealed_rows_changed');
   assert.equal(run('original_five_union_verify',filteredFactsSql(frozenAdministrative.items.map(row=>row.id),sealed?sealed.reminders.events[0].id:null)),originalFacts,'posthoc_reminder_changed_original_or_undeclared_rows');
   return {administrativeEvents:3,reminderEvents:sealed?1:0,reminderRelations:sealed?1:0,reminderAdoptions:sealed?1:0};
  },
  summary:()=>({protectionSqlDispatches:dispatches.length,dispatches:[...dispatches],armed,sealed:sealed!==null}),
 });
}
