//194 test-only committed permission restriction. The genuine roles_touch
//trigger remains enabled: restoring permissions advances version a second time,
//not a fabricated restoration of every original byte. Caller owns final cleanup.
import assert from 'node:assert/strict';
import {assertLifecycleSandbox,lifecycleJson as json} from '../merchant-attendance-lifecycle-native-support.mjs';
import {quote} from './attendance-bound-clocks-native.mjs';

const roleTable='merchant_enterprise_roles';
function fixedRole(row){
  const {permissions,version,updated_at,...fixed}=row;
  assert(Array.isArray(permissions)&&Number.isSafeInteger(version)&&version>=1&&typeof updated_at==='string');
  return fixed;
}
function changedRole(actual,original,permissions,advance,monotonic){
  assert(actual,'status_recovery_role_row_required');
  assert.deepEqual(fixedRole(actual),fixedRole(original),'status_recovery_unexpected_role_field_change');
  assert.deepEqual(actual.permissions,permissions,'status_recovery_role_permissions');
  assert.equal(actual.version,original.version+advance,'status_recovery_real_touch_version');
  assert.equal(monotonic,true,'status_recovery_real_touch_timestamp');
}

export async function withAccountStatusRecoveryRestrictedRole(ctx,callback){
  const {d,h,native,scope}=ctx??{};
  assert(d?.syntheticOnly===true&&h?.syntheticOnly===true,'status_recovery_role_synthetic_only');
  assert.equal(typeof callback,'function');assert.equal(typeof d.exec,'function');assert.equal(typeof d.guard,'string');
  assert.equal(typeof scope?.sql,'function');assert.equal(typeof native?.query,'function');
  assert.match(d.site,/^\d{8}$/);
  for(const value of [d.employee,d.auth])assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const assertOwned=()=>{const owned=assertLifecycleSandbox(sql=>native.query(scope.sql(sql)));assert.deepEqual(owned,d.owned);assert.equal(scope.schema,owned.schema);};
  assertOwned();
  const prefix="reset role;set local time zone 'UTC';set local datestyle='ISO, YMD';"+d.guard;
  const read=sql=>JSON.parse(d.exec(prefix+sql));
  const trigger=read(`select jsonb_build_object('valid',t.tgname='merchant_enterprise_roles_touch' and t.tgtype=19 and t.tgenabled='O'
      and not t.tgisinternal and t.tgnargs=0 and t.tgqual is null and t.tgfoid='public.faolla_touch_versioned_row()'::regprocedure,
      'body',p.prosrc) from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid='public.merchant_enterprise_roles'::regclass and t.tgname='merchant_enterprise_roles_touch';`);
  assert.equal(trigger?.valid,true,'status_recovery_real_roles_touch_required');
  assert.equal(trigger.body.trim().replace(/\s+/g,' '),'begin new.updated_at = now(); new.version = old.version + 1; return new; end;','status_recovery_real_touch_body');
  const roleId=read(`select to_jsonb(role_id) from public.merchant_enterprise_employees
    where merchant_id=${quote(d.site)} and id=${quote(d.employee)} and auth_user_id=${quote(d.auth)};`);
  assert.match(roleId,/^[0-9a-f-]{36}$/,'status_recovery_manager_current_role');
  const roles=()=>read(`select coalesce(jsonb_agg(to_jsonb(r) order by r.merchant_id,r.id),'[]') from public.merchant_enterprise_roles r;`);
  const initialRoles=roles(),original=initialRoles.find(row=>row.merchant_id===d.site&&row.id===roleId);
  assert(original&&original.permissions.includes('employees.view'),'status_recovery_manager_view_permission_required');
  assert(Number.isSafeInteger(original.version)&&original.version>=1&&original.version<=Number.MAX_SAFE_INTEGER-2);
  const otherRoles=rows=>rows.filter(row=>!(row.merchant_id===d.site&&row.id===roleId));
  const initialOthers=otherRoles(initialRoles),inventory=d.inventory(),protectedTables=inventory.filter(name=>name!==roleTable);
  assert(inventory.includes(roleTable)&&protectedTables.length>0);
  const protectedFacts=d.fingerprint(protectedTables),definitions=d.definitions(),catalog=d.tableCatalog();
  const initialFull=d.fingerprint(),failures=[];
  let value,restrictedFacts,restoredFacts,attempted=false;
  const monotonic=()=>read(`select to_jsonb(updated_at>=${quote(original.updated_at)}::timestamptz) from public.merchant_enterprise_roles
    where merchant_id=${quote(d.site)} and id=${quote(roleId)};`);
  const update=(permissions,expectedVersion)=>{
    assertOwned();
    const rows=read(`with changed as(update public.merchant_enterprise_roles r set permissions=array(select jsonb_array_elements_text(${json(permissions)}))
      where r.merchant_id=${quote(d.site)} and r.id=${quote(roleId)} and r.version=${expectedVersion}
      returning to_jsonb(r) value) select coalesce(jsonb_agg(value),'[]') from changed;`);
    assert.equal(rows.length,1,'status_recovery_exact_role_update');return rows[0];
  };
  const protect=()=>{
    assert.deepEqual(d.inventory(),inventory,'status_recovery_role_table_inventory');
    assert.deepEqual(otherRoles(roles()),initialOthers,'status_recovery_other_roles_changed');
    assert.equal(d.fingerprint(protectedTables),protectedFacts,'status_recovery_non_role_facts_changed');
    assert.equal(d.definitions(),definitions,'status_recovery_role_definitions_changed');
    assert.equal(d.tableCatalog(),catalog,'status_recovery_role_catalog_changed');
  };
  try{
    attempted=true;
    const restricted=update(['enterprise.view'],original.version);
    changedRole(restricted,original,['enterprise.view'],1,monotonic());protect();
    restrictedFacts=d.fingerprint();
    try{value=await callback();}catch(error){failures.push(error);}
    //Keep a callback error as well as any evidence failure; a finally-throw
    //must not replace the original diagnostic.
    try{assert.equal(d.fingerprint(),restrictedFacts,'status_recovery_callback_gets_wrote');}catch(error){failures.push(error);}
  }catch(error){failures.push(error);}
  finally{
    if(attempted){
      try{
        assertOwned();
        const current=roles().find(row=>row.merchant_id===d.site&&row.id===roleId);
        // If the first SQL never committed, do not manufacture a cleanup write.
        if(current&&JSON.stringify(current)===JSON.stringify(original)){
          assert.equal(d.fingerprint(),initialFull,'status_recovery_failed_restriction_changed_facts');
          throw Error('status_recovery_permission_restriction_did_not_commit');
        }
        try{changedRole(current,original,['enterprise.view'],1,monotonic());}catch(error){failures.push(error);}
        const restored=update(original.permissions,original.version+1);
        changedRole(restored,original,original.permissions,2,monotonic());
        restoredFacts=d.fingerprint();
      }catch(error){failures.push(error);}
    }
    try{protect();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,'account_status_recovery_restricted_role_failed: '+failures.map(error=>error.message).join(' | '));
  assert.equal(typeof restoredFacts,'string');
  return {value,restoredFacts,permissionRestored:true,roleVersionAdvances:2};
}
