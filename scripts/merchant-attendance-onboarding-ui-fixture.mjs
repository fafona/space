// UI-only test infrastructure. The full ten-field role form reaches the real
// SQL function unchanged; metadata editing and additional permissions are not
// part of this acceptance scope. No business rows or replies are synthesized.
import assert from 'node:assert/strict';
import {prepareAttendanceOnboardingFixture,validateAttendanceOnboardingRpcInput} from './merchant-attendance-onboarding-fixture.mjs';
import {assertLifecycleSandbox,lifecycleId as id} from './merchant-attendance-lifecycle-native-support.mjs';

const roleName='faolla_update_merchant_enterprise_role_v3';
const rpcNames=Object.freeze([
  ...['claim','complete','release'].map(action=>`faolla_${action}_merchant_employee_initial_password_setup_v1`),
  'faolla_accept_merchant_employee_invitation_v1','faolla_waive_employee_initial_password_v1',
  roleName,'faolla_attendance_admin_v1','faolla_attendance_self_v1',
]);
const roleIds=[id(30),id(31),id(32)];
const baseKeys=['merchant_id','role_id','expected_version','actor_type','actor_id','permissions'];
const fullKeys=[...baseKeys,'name','description','access_scope','allowed_board_ids'];
const roleErrors=new Set(['invalid_role_update','invalid_role_actor','invalid_role','invalid_role_status',
  'invalid_permissions','invalid_permission_dependencies','invalid_role_board_access','invalid_site_id',
  'role_not_found','enterprise_version_conflict','permission_escalation_denied','system_role_protected','role_in_use','role_board_access_in_use']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const exact=(value,keys)=>{
  assert(value&&typeof value==='object'&&!Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(),[...keys].sort());
};

/** Prepared must be the original owned fixture, not an application DB client. */
export function createAttendanceOnboardingUiTransport(prepared){
  assert.equal(typeof prepared.exec,'function');
  assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_ui_namespace_changed');
  assert.deepEqual(prepared.onboardingRpcNames,rpcNames,'onboarding_ui_original_rpc_list_required');
  for(const name of ['onboardingRpc','onboardingRead','onboardingFacts'])assert.equal(typeof prepared[name],'function');
  const rows=prepared.onboardingFacts().roles;
  assert(Array.isArray(rows)&&rows.length===3,'onboarding_ui_original_roles_required');
  const metadata=new Map();
  for(const row of rows){
    assert(row&&roleIds.includes(row.id)&&!metadata.has(row.id)&&row.merchant_id==='99990001');
    assert(typeof row.name==='string'&&row.name.trim()===row.name&&row.name.length>=1&&row.name.length<=80);
    assert(typeof row.description==='string'&&row.description.trim()===row.description&&row.description.length<=1000);
    assert.equal(row.access_scope,'all','onboarding_ui_original_all_scope_required');
    metadata.set(row.id,Object.freeze({name:row.name,description:row.description,access_scope:row.access_scope}));
  }
  // The original raw role row has no derived allowed_board_ids field. Verify
  // its actual relation is empty instead of inventing a normalized scope.
  assert.equal(prepared.exec(`reset role;select count(*) from public.merchant_enterprise_role_boards
    where merchant_id='99990001' and role_id in(${roleIds.map(quote).join(',')});`),'0','onboarding_ui_original_empty_role_boards_required');
  const uiCalls=[],errors=[];
  const uiRpc=async(name,args)=>{
    let fullRole=false;
    try{
      assert(rpcNames.includes(name));
      if(name===roleName){
        exact(args,['p_input']);const input=args.p_input;
        assert(input&&typeof input==='object'&&!Array.isArray(input));
        fullRole=Object.keys(input).length!==baseKeys.length;
        if(fullRole){
          exact(input,fullKeys);
          // Reuse the original six-field validator for validation only. The
          // statement below sends the entire original ten-field input.
          validateAttendanceOnboardingRpcInput(name,{p_input:Object.fromEntries(baseKeys.map(key=>[key,input[key]]))});
          const original=metadata.get(input.role_id);assert(original);
          assert.equal(input.name,original.name);assert.equal(input.description,original.description);
          assert.equal(input.access_scope,original.access_scope);assert.deepEqual(input.allowed_board_ids,[]);
        }else validateAttendanceOnboardingRpcInput(name,args);
      }else validateAttendanceOnboardingRpcInput(name,args);
    }catch{errors.push('onboarding_ui_rpc_forbidden');throw Error('onboarding_ui_rpc_forbidden');}
    const call={name,error:null};
    if(name===roleName)call.input=structuredClone(args.p_input);
    else if(name==='faolla_attendance_admin_v1'||name==='faolla_attendance_self_v1')call.input=structuredClone(args);
    uiCalls.push(call);
    if(!fullRole){
      try{
        const result=await prepared.onboardingRpc(name,args);call.error=result.error?.message??null;return result;
      }catch{errors.push('onboarding_ui_rpc_failed');throw Error('onboarding_ui_rpc_failed');}
    }
    try{
      assert.deepEqual(assertLifecycleSandbox(prepared.exec),prepared.owned,'onboarding_ui_namespace_changed');
      const result=JSON.parse(prepared.exec(`begin;reset role;set local role service_role;
        select jsonb_build_object('role',current_user,'data',public.faolla_update_merchant_enterprise_role_v3(${quote(JSON.stringify(args.p_input))}::jsonb));commit;`));
      assert.equal(result.role,'service_role');return {data:result.data,error:null};
    }catch(error){
      const code=String(error).match(/ERROR:\s+([a-z_]+)(?=\r?\n|$)/)?.[1];
      if(code&&roleErrors.has(code)){call.error=code;return {data:null,error:{message:code}};}
      errors.push('onboarding_ui_rpc_failed');throw Error('onboarding_ui_rpc_failed');
    }
  };
  return {uiRpc,uiRead:prepared.onboardingRead,uiFacts:prepared.onboardingFacts,uiCalls,
    get uiErrors(){return [...errors,...prepared.onboardingErrors];}};
}

export async function prepareAttendanceOnboardingUiFixture(native,scope){
  const prepared=await prepareAttendanceOnboardingFixture(native,scope);
  const ui=createAttendanceOnboardingUiTransport(prepared);
  Object.defineProperty(prepared,'uiErrors',{enumerable:true,get:()=>ui.uiErrors});
  return Object.assign(prepared,{uiRpc:ui.uiRpc,uiRead:ui.uiRead,uiFacts:ui.uiFacts,uiCalls:ui.uiCalls});
}
