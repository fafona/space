// Pure contract probes; opaque SQL spies are not successful role-edit evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {createAttendanceOnboardingUiTransport} from './merchant-attendance-onboarding-ui-fixture.mjs';
import {createAttendanceOnboardingTransport} from './merchant-attendance-onboarding-fixture.mjs';
import {createInvitationBrowserTransport} from './merchant-attendance-invitation-browser-fixture.mjs';
import {createInitialPasswordFixtureTransport} from './merchant-attendance-initial-password-fixture.mjs';

const require=createRequire(import.meta.url);
const {updateMerchantEnterpriseRole}=require('../src/lib/merchantEnterpriseStore.server.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owned={schema:'attendance_race_'+'a'.repeat(32),oid:123,tableOid:456,owner:'postgres',
  marker:'faolla-synthetic-concurrency:12345678-1234-1234-1234-123456789abc'};
const roleName='faolla_update_merchant_enterprise_role_v3';
const rows=()=>[30,31,32].map(n=>({id:id(n),merchant_id:'99990001',name:`合成邀请角色${n-29}`,description:'',access_scope:'all'}));
const base=()=>({merchant_id:'99990001',role_id:id(30),expected_version:1,actor_type:'owner',actor_id:id(99),
  permissions:['enterprise.view','attendance.self.view','attendance.self.clock']});
const full=()=>({...base(),name:rows()[0].name,description:'',access_scope:'all',allowed_board_ids:[]});
function fixture({reply=()=>JSON.stringify({role:'service_role',data:{opaquePureProbe:true}}),roles=rows(),boards='0'}={}){
  const queries=[];let currentOwned=owned;
  const raw=source=>{
    queries.push(source);
    if(source.includes("'schema',n.nspname"))return JSON.stringify(currentOwned);
    if(source.includes('select count(*) from public.merchant_enterprise_role_boards'))return boards;
    return reply(source);
  };
  const prepared=createInvitationBrowserTransport(raw,owned);Object.assign(prepared,createInitialPasswordFixtureTransport(prepared));
  const original=createAttendanceOnboardingTransport(prepared);
  Object.assign(prepared,{onboardingRpc:original.onboardingRpc,onboardingRead:original.onboardingRead,
    onboardingRpcNames:original.onboardingRpcNames,onboardingFacts:()=>({roles})});
  Object.defineProperty(prepared,'onboardingErrors',{get:()=>original.onboardingErrors});
  const ui=createAttendanceOnboardingUiTransport(prepared);
  const business=()=>queries.filter(source=>!source.includes("'schema',n.nspname")&&!source.includes('select count(*) from public.merchant_enterprise_role_boards'));
  return {prepared,original,ui,queries,business,setOwned:value=>{currentOwned=value;}};
}

test('complete ten-field form reaches actual guarded service-role RPC unchanged; metadata is captured from raw role rows',async()=>{
  const h=fixture(),input=full();
  assert.deepEqual(await h.ui.uiRpc(roleName,{p_input:input}),{data:{opaquePureProbe:true},error:null});
  assert.equal(h.business().length,1);const source=h.business()[0];
  assert.match(source,/^begin;reset role;do \$owned\$/);assert.match(source,/c\.oid=456 and n\.oid=123/);
  assert(source.includes(owned.marker));assert.match(source,/set local role service_role/);
  const serialized=source.match(/faolla_update_merchant_enterprise_role_v3\('((?:''|[^'])*)'::jsonb\)/)?.[1];
  assert(serialized);assert.deepEqual(JSON.parse(serialized.replaceAll("''","'")),input);
  assert.equal(Object.keys(JSON.parse(serialized)).length,10);
  assert.deepEqual(h.original.onboardingCalls,[],'ten-key form must not be stripped and routed through six-key transport');
  assert.deepEqual(h.ui.uiCalls,[{name:roleName,error:null,input}]);
  input.permissions.push('not-logged');assert.equal(h.ui.uiCalls[0].input.permissions.length,3);
});

test('role metadata binding rejects missing/extra fields, wrong name/description/scope/boards and malformed or excessive permissions',async()=>{
  const h=fixture(),input=full();
  const bad=[{...input,name:'renamed'},{...input,description:'edited'},{...input,access_scope:'restricted'},
    {...input,allowed_board_ids:[id(401)]},{...input,allowed_board_ids:null},{...input,status:'active'},
    {...input,merchant_id:'99990002'},{...input,role_id:id(33)},{...input,actor_id:id(2)},
    {...input,actor_type:'employee'},{...input,expected_version:'1'},{...input,expected_version:0},
    {...input,permissions:['enterprise.view','attendance.self.request']},
    {...input,permissions:['enterprise.view','roles.manage']},{...input,permissions:['enterprise.view','enterprise.view']}];
  const missing={...input};delete missing.description;bad.push(missing);
  for(const p_input of bad)await assert.rejects(h.ui.uiRpc(roleName,{p_input}),/^Error: onboarding_ui_rpc_forbidden$/);
  await assert.rejects(h.ui.uiRpc(roleName,{p_input:input,extra:true}),/onboarding_ui_rpc_forbidden/);
  assert.deepEqual(h.business(),[]);assert.deepEqual(h.ui.uiCalls,[]);
});

test('constructor requires exact original synthetic role metadata and empty actual role-board mappings',()=>{
  assert.throws(()=>fixture({roles:rows().slice(0,2)}),/onboarding_ui_original_roles_required/);
  assert.throws(()=>fixture({roles:[rows()[0],rows()[0],rows()[2]]}));
  assert.throws(()=>fixture({roles:rows().map((row,i)=>i===0?{...row,merchant_id:'99990002'}:row)}));
  assert.throws(()=>fixture({roles:rows().map((row,i)=>i===0?{...row,access_scope:'restricted'}:row)}),/onboarding_ui_original_all_scope_required/);
  assert.throws(()=>fixture({roles:rows().map((row,i)=>i===0?{...row,name:' padded '}:row)}));
  assert.throws(()=>fixture({boards:'1'}),/onboarding_ui_original_empty_role_boards_required/);
});

test('six-key role and original seven other RPCs retain strict original delegation and do not log invitation/setup secrets',async()=>{
  const h=fixture(),setup={merchant_id:'99990001',auth_user_id:id(2),invitation_version:7,token_hash:'a'.repeat(64),
    operation_id:id(1001),password_fingerprint:'b'.repeat(64)};
  const admin={p_site_id:'99990001',p_auth_user_id:id(99),p_query:{view:'settings',cursor:null,search:''},p_command:null,p_operation_id:null};
  const self={p_site_id:'99990001',p_auth_user_id:id(2),p_command:null,p_operation_id:null};
  for(const name of h.prepared.onboardingRpcNames){
    const args=name===roleName?{p_input:base()}:name==='faolla_attendance_admin_v1'?admin:name==='faolla_attendance_self_v1'?self:
      name.includes('_initial_password_setup_v1')?{p_input:setup}:{p_input:{merchant_id:'99990001',auth_user_id:id(2),invitation_version:7,token_hash:setup.token_hash}};
    assert.deepEqual(await h.ui.uiRpc(name,args),{data:{opaquePureProbe:true},error:null});
  }
  assert.equal(h.ui.uiCalls.length,8);assert.deepEqual(h.ui.uiCalls,h.original.onboardingCalls);
  assert(!JSON.stringify(h.ui.uiCalls).includes(setup.token_hash));assert(!JSON.stringify(h.ui.uiCalls).includes(setup.password_fingerprint));
  const count=h.business().length;
  await assert.rejects(h.ui.uiRpc('faolla_update_merchant_enterprise_employee_v1',{p_input:base()}),/onboarding_ui_rpc_forbidden/);
  await assert.rejects(h.ui.uiRpc('faolla_attendance_self_v1',{...self,p_site_id:'99990002'}),/onboarding_ui_rpc_forbidden/);
  assert.equal(h.business().length,count);
});

test('actual role store emits all ten UI fields and exact versions, while SQL typed errors remain typed without invented role DTOs',async()=>{
  const h=fixture({reply:()=>{throw Error('ERROR: enterprise_version_conflict\nDETAIL: private-value');}});
  await assert.rejects(updateMerchantEnterpriseRole({rpc:h.ui.uiRpc},{siteId:'99990001',roleId:id(30),version:7,
    actorType:'owner',actorId:id(99),name:full().name,description:'',permissions:base().permissions,accessScope:'all',allowedBoardIds:[]}),
  /enterprise_version_conflict/);
  assert.deepEqual(h.ui.uiCalls,[{name:roleName,error:'enterprise_version_conflict',input:{...full(),expected_version:7}}]);
  assert.deepEqual(h.ui.uiErrors,[]);assert.deepEqual(h.original.onboardingCalls,[]);
});

test('owned namespace substitution, non-service replies, raw SQL failures and lookalike codes are fixed closed failures',async()=>{
  const changed=fixture();changed.setOwned({...owned,oid:999});
  await assert.rejects(changed.ui.uiRpc(roleName,{p_input:full()}),/^Error: onboarding_ui_rpc_failed$/);
  assert.deepEqual(changed.business(),[]);
  for(const reply of [()=>JSON.stringify({role:'postgres',data:{secret:true}}),
    ()=>{throw Error('ERROR: internal_error secret-value');},()=>{throw Error('ERROR: enterprise_version_conflict123\nsecret-value');}]){
    const h=fixture({reply});await assert.rejects(h.ui.uiRpc(roleName,{p_input:full()}),/^Error: onboarding_ui_rpc_failed$/);
    assert.deepEqual(h.ui.uiErrors,['onboarding_ui_rpc_failed']);assert.equal(h.ui.uiCalls[0].error,null);
  }
});

test('read/facts are exact original aliases and errors remain live including original strict read rejection',()=>{
  const h=fixture();assert.strictEqual(h.ui.uiRead,h.prepared.onboardingRead);assert.strictEqual(h.ui.uiFacts,h.prepared.onboardingFacts);
  assert.deepEqual(h.ui.uiFacts(),{roles:rows()});assert.deepEqual(h.ui.uiErrors,[]);
  const request=new Request('https://attendance-auth.invalid/rest/v1/merchant_enterprise_employees?invitation_version=eq.7');
  assert.throws(()=>h.ui.uiRead(request),/invitation_browser_recovery_forbidden/);
  assert(h.ui.uiErrors.includes('invitation_browser_recovery_forbidden'));
  assert.deepEqual(h.business(),[]);
});

test('UI preparation layers over original fixture without new migrations, seeds, permissions or ordinary-reader fallback',()=>{
  const source=readFileSync(new URL('./merchant-attendance-onboarding-ui-fixture.mjs',import.meta.url),'utf8');
  assert.match(source,/await prepareAttendanceOnboardingFixture\(native,scope\)/);
  assert.match(source,/createAttendanceOnboardingUiTransport\(prepared\)/);
  assert.match(source,/Object\.defineProperty\(prepared,'uiErrors',\{enumerable:true,get:\(\)=>ui\.uiErrors\}\)/);
  assert.match(source,/JSON\.stringify\(args\.p_input\)/);
  assert.doesNotMatch(source,/\b(?:insert into|update|delete from|truncate|create table|alter table|grant execute|grant select)\s+/i);
  assert.doesNotMatch(source,/serveShell|createClient\(|fetch\(|readFileSync|supabase-migrations|process\.env|console\.|spawn\(/);
});
