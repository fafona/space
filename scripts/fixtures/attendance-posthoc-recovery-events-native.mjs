//226-only capability carried through the existing owned-context callbacks.
//Old callers retain the exact full-table fingerprint. No arbitrary tenant,
//table, or row exclusion is accepted, and no database writes occur here.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleId as id} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

export const posthocRecoveryProtectedTables=Object.freeze(['merchant_attendance_events','merchant_attendance_shift_schedule_relations',
 'merchant_attendance_shift_plan_adoptions','merchant_attendance_plan_rule_operations','merchant_attendance_plan_rule_artifacts']);
const site='99990227',ids=[id(226700010),id(226700011)],idsSql=ids.map(quote).join(',');
export function posthocRecoveryOriginalFactsSql(){
 return 'select md5(jsonb_build_object('+posthocRecoveryProtectedTables.map(table=>
  `${quote(table)},(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from public.${table} r`+
  (table==='merchant_attendance_events'?` where not (r.merchant_id=${quote(site)} and r.id in (${idsSql}))`:'')+')').join(',')+')::text);';
}
export function createPosthocRecoveryEventsGuard({d,h,originalTables,originalFacts}){
 assert.deepEqual(originalTables,posthocRecoveryProtectedTables);
 let registered=false;
 return {
  register(){
   assert(!registered,'posthoc_recovery_events_already_registered');
   assert(d.syntheticOnly===true&&h.syntheticOnly===true,'posthoc_recovery_synthetic_context_required');
   assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
   assert.equal(d.fingerprint(originalTables),originalFacts,'posthoc_recovery_registration_changed_original_facts');
   assert.equal(d.exec(`select (not exists(select 1 from public.merchants where id=${quote(site)}) and
    not exists(select 1 from public.merchant_attendance_events where id in (${idsSql})))::text;`),'true','posthoc_recovery_requires_fresh_fixed_ids');
   registered=true;
  },
  verify(){
   if(!registered){assert.equal(d.fingerprint(originalTables),originalFacts);return 0;}
   assert.deepEqual(assertLifecycleSandbox(d.exec),d.owned);
   assert.equal(d.exec(posthocRecoveryOriginalFactsSql()),originalFacts,'posthoc_recovery_changed_original_or_added_undeclared_rows');
   assert.equal(d.exec(`select count(*) from public.merchant_attendance_events where merchant_id=${quote(site)} and id in (${idsSql});`),'2','posthoc_recovery_requires_both_declared_events');
   return 2;
  },
 };
}
