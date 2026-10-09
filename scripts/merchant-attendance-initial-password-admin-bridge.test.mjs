import assert from 'node:assert/strict';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAdminBridge} from './merchant-attendance-initial-password-admin-bridge.mjs';
const origin='https://attendance-auth.invalid',service='attendance-synthetic-service';
const actor={id:'00000000-0000-4000-8000-000000000002',email:'invite-retry-2@example.test'};
const password='Synthetic-new-employee-only!2026';
const headers={apikey:service,authorization:'Bearer '+service,'content-type':'application/json'};
const attributes=model=>({password,app_metadata:{...model.user().app_metadata,merchant_staff_password_initialized:true}});
const build=()=>{
  const model=createInitialPasswordAuthModel(actor),delegated=[];
  const bridge=createInitialPasswordAdminBridge(async req=>{delegated.push(new URL(req.url).pathname);return Response.json({local:true});},actor,model);
  return {model,bridge,delegated};
};
test('installed SDK admin GET/PUT reaches only the synthetic target and preserves existing metadata',async()=>{
  const {model,bridge,delegated}=build();
  const sdk=createClient(origin,service,{global:{fetch:bridge.fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try{
    const first=await sdk.auth.admin.getUserById(actor.id);assert.equal(first.error,null);assert.equal(first.data.user.app_metadata.merchant_staff_password_initialized,false);
    const updated=await sdk.auth.admin.updateUserById(actor.id,attributes(model));assert.equal(updated.error,null);
    assert.equal(updated.data.user.app_metadata.fixture_retained,'unchanged');assert(model.passwordMatches(password));
    assert.deepEqual(model.proof(),{updates:1,reads:1,initialized:true,retained:'unchanged'});
    assert.deepEqual(bridge.calls,[{method:'GET',status:200},{method:'PUT',status:200}]);assert.deepEqual(bridge.errors,[]);assert.deepEqual(delegated,[]);
    for(const sensitive of [password,actor.email,actor.id])assert(!JSON.stringify(bridge.calls).includes(sensitive));
  }finally{sdk.auth.stopAutoRefresh();}
});
test('service credentials, subject, method and URL variations are rejected before model mutation',async()=>{
  const {model,bridge}=build(),before=model.proof(),url=origin+'/auth/v1/admin/users/'+actor.id;
  for(const [target,options] of [[url,{method:'DELETE',headers}],
    [url+'?ignored=1',{headers}],[url+'#fragment',{headers}],
    [origin+'/auth/v1/admin/users/00000000-0000-4000-8000-000000000001',{headers}],
    [url,{headers:{...headers,apikey:'anon'}}],[url,{headers:{...headers,authorization:'Bearer wrong'}}],
    [origin+'/auth/v1/admin/users',{headers}]])await assert.rejects(bridge.fetch(target,options),/initial_password_admin_bridge_rejected/);
  assert.deepEqual(model.proof(),before);assert.deepEqual(bridge.calls,[]);
});
test('PUT rejects metadata takeover, extra attributes, malformed JSON and out-of-bounds passwords',async()=>{
  const {model,bridge}=build(),before=model.proof();
  for(const value of ['{',JSON.stringify({...attributes(model),email:'other@example.test'}),
    JSON.stringify({...attributes(model),password:'short'}),JSON.stringify({...attributes(model),password:'a'.repeat(129)}),
    JSON.stringify({password,app_metadata:{principal_type:'merchant'}})]){
    await assert.rejects(bridge.fetch(origin+'/auth/v1/admin/users/'+actor.id,{method:'PUT',headers,body:value}),/initial_password_admin_bridge_rejected/);
  }
  assert.deepEqual(model.proof(),before);assert.deepEqual(bridge.calls,[]);
});
test('committed-but-lost PUT remains an SDK503 and the next GET observes the same single update',async()=>{
  const {model,bridge}=build();model.loseNextUpdateReply();
  const sdk=createClient(origin,service,{global:{fetch:bridge.fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  try{
    const lost=await sdk.auth.admin.updateUserById(actor.id,attributes(model));assert.equal(lost.error?.status,503);
    assert(model.passwordMatches(password));assert.equal(model.proof().updates,1);
    const current=await sdk.auth.admin.getUserById(actor.id);assert.equal(current.error,null);assert.equal(current.data.user.app_metadata.merchant_staff_password_initialized,true);
    assert.deepEqual(bridge.calls,[{method:'PUT',status:503},{method:'GET',status:200}]);assert.deepEqual(bridge.errors,[]);
  }finally{sdk.auth.stopAutoRefresh();}
});
test('non-admin requests use the existing closed user bridge and external requests never reach a delegate',async()=>{
  const {bridge,delegated}=build();assert.equal((await bridge.fetch(origin+'/rest/v1/rpc/synthetic')).status,200);
  await assert.rejects(bridge.fetch('https://outside.example.test/auth/v1/admin/users/'+actor.id,{headers}),/external_request_forbidden/);
  assert.deepEqual(delegated,['/rest/v1/rpc/synthetic']);assert.deepEqual(bridge.calls,[]);
});
