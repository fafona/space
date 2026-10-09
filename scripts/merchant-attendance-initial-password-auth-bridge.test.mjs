// Pure protocol tests plus installed-SDK/in-memory-fixture integration. No
// database, browser, real Auth, email, listener or external fetch is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import test from 'node:test';
import {createClient} from '@supabase/supabase-js';
import {createInitialPasswordAuthModel} from './merchant-attendance-initial-password-native.mjs';
import {createInitialPasswordAuthBridge} from './merchant-attendance-initial-password-auth-bridge.mjs';
const require=createRequire(import.meta.url);
const {withAttendanceApplicationAuth}=require('./fixtures/attendance-application-auth.ts');
const origin='https://attendance-auth.invalid',anon='attendance-synthetic-anon';
const actor={id:'00000000-0000-4000-8000-000000000002',email:'invite-retry-2@example.test'};
const oldPassword='Synthetic-attendance-only!',newPassword='Synthetic-new-staff-only!2026';
const request=(password=newPassword,email=actor.email)=>new Request(origin+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email,password})});
const session=()=>({access_token:'opaque-pure-test-token',refresh_token:'opaque-pure-test-refresh',token_type:'bearer',expires_in:3600,
  user:{...actor,app_metadata:{provider:'email',providers:['email'],merchant_staff_password_initialized:false},user_metadata:{untouched:true}}});
const initialize=async model=>model.updateAuthUserById(actor.id,{password:newPassword,
  app_metadata:{...model.user().app_metadata,merchant_staff_password_initialized:true}});

test('bridge configuration and request origin reject unowned identities or external URLs before any delegation',async()=>{
  const model=createInitialPasswordAuthModel(actor);let delegated=0;
  const protocol=async()=>{delegated++;throw Error('must not delegate');};
  for(const other of [{...actor,id:'not-synthetic'},{...actor,email:'private@actual.example'},
    {...actor,id:'00000000-0000-4000-8000-000000000001'},{...actor,email:'other@example.test'}])
    assert.throws(()=>createInitialPasswordAuthBridge(protocol,other,model),/initial_password_auth_bridge_(?:configuration|model_identity)_invalid/);
  const bridge=createInitialPasswordAuthBridge(protocol,actor,model);
  for(const url of ['https://example.test/auth/v1/user','http://attendance-auth.invalid/auth/v1/user',origin+'/auth/v1/user#fragment'])
    await assert.rejects(bridge.fetch(url),/^Error: initial_password_auth_bridge_external_request_forbidden$/);
  assert.equal(delegated,0);assert.deepEqual(bridge.proof(),{passwordAttempts:0,passwordRejected:0,passwordAccepted:0,validatedUserReads:0});
});

test('uninitialized state, wrong password/email and malformed JSON never reach the fixed protocol password path',async()=>{
  const model=createInitialPasswordAuthModel(actor);let delegated=0;
  const bridge=createInitialPasswordAuthBridge(async()=>{delegated++;return Response.json(session());},actor,model);
  for(const req of [request(newPassword),request(oldPassword),new Request(origin+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:'{'})]){
    const response=await bridge.fetch(req);assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid_credentials');
  }
  await initialize(model);
  for(const req of [request(oldPassword),request(newPassword,'other@example.test'),request(123)])assert.equal((await bridge.fetch(req)).status,400);
  assert.equal(delegated,0);assert.deepEqual(bridge.proof(),{passwordAttempts:6,passwordRejected:6,passwordAccepted:0,validatedUserReads:0});
  assert.deepEqual(model.proof(),{updates:1,reads:0,initialized:true,retained:'unchanged'});
});

test('successful password delegation preserves the original request and tokens and merges only current model app_metadata',async()=>{
  const model=createInitialPasswordAuthModel(actor);await initialize(model);const original=session();let delegated;
  const bridge=createInitialPasswordAuthBridge(async req=>{
    delegated={method:req.method,url:req.url,headers:Object.fromEntries(req.headers),body:await req.json()};
    return Response.json(original,{headers:{'x-test-response':'preserved','content-length':'1'}});
  },actor,model);
  const response=await bridge.fetch(request()),result=await response.json();
  assert.deepEqual(delegated.body,{email:actor.email,password:newPassword});assert.equal(delegated.headers.apikey,anon);
  assert.equal(delegated.method,'POST');assert.equal(delegated.url,origin+'/auth/v1/token?grant_type=password');
  assert.equal(result.access_token,original.access_token);assert.equal(result.refresh_token,original.refresh_token);
  assert.equal(result.user.id,actor.id);assert.equal(result.user.email,actor.email);
  assert.deepEqual(result.user.user_metadata,original.user.user_metadata);
  assert.deepEqual(result.user.app_metadata,{...original.user.app_metadata,...model.user().app_metadata});
  assert.equal(response.headers.get('content-length'),null);assert.equal(response.headers.get('x-test-response'),'preserved');
  assert.deepEqual(bridge.proof(),{passwordAttempts:1,passwordRejected:0,passwordAccepted:1,validatedUserReads:0});
  const leaked=JSON.stringify(bridge.proof());for(const value of [newPassword,actor.email,original.access_token,original.refresh_token])assert(!leaked.includes(value));
  const snapshot=bridge.proof();snapshot.passwordAccepted=100;assert.equal(bridge.proof().passwordAccepted,1);
});

test('delegate failures are never upgraded to success and do not mutate model state',async()=>{
  const model=createInitialPasswordAuthModel(actor);await initialize(model);const before=model.proof();
  const denied=Response.json({code:'bad_jwt',message:'Invalid session'},{status:401});
  const bridge=createInitialPasswordAuthBridge(async()=>denied,actor,model);
  assert.equal(await bridge.fetch(request()),denied);assert.deepEqual(model.proof(),before);
  assert.deepEqual(bridge.proof(),{passwordAttempts:1,passwordRejected:1,passwordAccepted:0,validatedUserReads:0});
  const failed=createInitialPasswordAuthBridge(async()=>{throw Error('unsafe '+newPassword);},actor,model);
  await assert.rejects(failed.fetch(request()),/^Error: initial_password_auth_bridge_protocol_failed$/);
  assert.deepEqual(model.proof(),before);
});

test('wrong or malformed delegated identities cannot receive model metadata or count as accepted authentication',async()=>{
  const model=createInitialPasswordAuthModel(actor);await initialize(model);
  for(const replacement of [{id:'00000000-0000-4000-8000-000000000001'},{email:'other@example.test'},{email:actor.email.toUpperCase()}]){
    const result=session();result.user={...result.user,...replacement};
    const bridge=createInitialPasswordAuthBridge(async()=>Response.json(result),actor,model);
    assert.equal((await bridge.fetch(request())).status,401);assert.equal(bridge.proof().passwordAccepted,0);
  }
  for(const body of [null,{}, {...session(),access_token:''},{...session(),refresh_token:null},{...session(),user:null}]){
    const bridge=createInitialPasswordAuthBridge(async()=>Response.json(body),actor,model);
    assert.equal((await bridge.fetch(request())).status,401);assert.equal(bridge.proof().passwordRejected,1);
  }
});

test('validated user reads expose current metadata before and after model initialization, but never trust a foreign user reply',async()=>{
  const model=createInitialPasswordAuthModel(actor);let reply={...session().user};
  const bridge=createInitialPasswordAuthBridge(async req=>{assert.equal(req.headers.get('authorization'),'Bearer opaque');return Response.json(reply);},actor,model);
  const read=()=>bridge.fetch(origin+'/auth/v1/user',{headers:{apikey:anon,authorization:'Bearer opaque'}});
  assert.equal((await(await read()).json()).app_metadata.merchant_staff_password_initialized,false);
  await initialize(model);
  assert.equal((await(await read()).json()).app_metadata.merchant_staff_password_initialized,true);
  reply={...reply,id:'00000000-0000-4000-8000-000000000003'};
  assert.equal((await read()).status,401);
  assert.deepEqual(bridge.proof(),{passwordAttempts:0,passwordRejected:0,passwordAccepted:0,validatedUserReads:2});
  assert.equal(model.proof().reads,0,'bridge observes user() without inventing admin read evidence');
});

test('other local protocol paths remain unchanged delegate calls, including failures from the original closed allowlist',async()=>{
  const model=createInitialPasswordAuthModel(actor),seen=[];
  const success=Response.json({opaqueResult:true}),bridge=createInitialPasswordAuthBridge(async req=>{
    seen.push({method:req.method,path:new URL(req.url).pathname,body:await req.text(),authorization:req.headers.get('authorization')});return success;
  },actor,model);
  assert.equal(await bridge.fetch(origin+'/rest/v1/rpc/synthetic',{method:'POST',headers:{authorization:'Bearer service'},body:'opaque-input'}),success);
  assert.equal(await bridge.fetch(origin+'/auth/v1/logout?scope=global',{method:'POST'}),success);
  assert.deepEqual(seen,[{method:'POST',path:'/rest/v1/rpc/synthetic',body:'opaque-input',authorization:'Bearer service'},
    {method:'POST',path:'/auth/v1/logout',body:'',authorization:null}]);
  assert.deepEqual(bridge.proof(),{passwordAttempts:0,passwordRejected:0,passwordAccepted:0,validatedUserReads:0});
  const denied=createInitialPasswordAuthBridge(async()=>{throw Error('fixture_unexpected_endpoint');},actor,model);
  await assert.rejects(denied.fetch(origin+'/unlisted'),/^Error: initial_password_auth_bridge_protocol_failed$/);
});

test('installed SDK keeps default fixture login compatible and exercises model-backed new-password login plus real fixture JWT validation', {timeout:15000}, async()=>{
  const client=fetch=>createClient(origin,anon,{global:{fetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  await withAttendanceApplicationAuth([actor],null,async()=>{
    const sdk=client(globalThis.fetch);
    try{
      assert.equal((await sdk.auth.signInWithPassword({email:actor.email,password:oldPassword})).error,null);
      assert.equal((await sdk.auth.getUser()).data.user.id,actor.id);
      assert.equal((await sdk.auth.signInWithPassword({email:actor.email,password:newPassword})).error?.status,400);
    }finally{sdk.auth.stopAutoRefresh();}
  });
  const model=createInitialPasswordAuthModel(actor);let checkerCalls=0;
  await withAttendanceApplicationAuth([actor],null,async()=>{
    const protocolFetch=globalThis.fetch,bridge=createInitialPasswordAuthBridge(protocolFetch,actor,model),sdk=client(bridge.fetch);
    try{
      assert.equal((await sdk.auth.signInWithPassword({email:actor.email,password:newPassword})).error?.status,400);
      assert.equal(checkerCalls,0,'bridge rejects before a protocol session can be minted');
      await initialize(model);
      assert.equal((await sdk.auth.signInWithPassword({email:actor.email,password:oldPassword})).error?.status,400);
      assert.equal(checkerCalls,0);
      const login=await sdk.auth.signInWithPassword({email:actor.email,password:newPassword});
      assert.equal(login.error,null);assert.equal(login.data.user.id,actor.id);assert.equal(login.data.user.app_metadata.merchant_staff_password_initialized,true);
      assert.equal(checkerCalls,1);assert.equal((await sdk.auth.getUser()).data.user.app_metadata.principal_type,'merchant_staff');
      assert.equal((await sdk.auth.refreshSession()).error,null);
      assert.equal((await sdk.auth.getUser('invalid-unverified-token')).error?.status,401);
      const badKey=new Request(request(),{headers:{apikey:'wrong-key','content-type':'application/json'}});
      await assert.rejects(bridge.fetch(badKey),/^Error: initial_password_auth_bridge_protocol_failed$/);
      assert.equal(checkerCalls,1,'original fixture API-key check still runs before password checker');
      assert.deepEqual(bridge.proof(),{passwordAttempts:4,passwordRejected:3,passwordAccepted:1,validatedUserReads:1});
      assert.deepEqual(model.proof(),{updates:1,reads:0,initialized:true,retained:'unchanged'});
      assert.equal((await sdk.auth.signOut()).error,null);
    }finally{sdk.auth.stopAutoRefresh();}
  },undefined,undefined,(subject,password)=>{
    checkerCalls++;return subject.id===actor.id&&subject.email===actor.email&&model.proof().initialized===true&&model.passwordMatches(password);
  });
});
