import assert from "node:assert/strict";
import test from "node:test";
import {createClient} from "@supabase/supabase-js";
import {withAttendanceApplicationAuth} from "../../scripts/fixtures/attendance-application-auth";
import {resolveValidatedMerchantEnterpriseAuthContext,requireMerchantEnterprisePasswordAuthentication} from "./merchantEnterpriseAuth.server";
import {MERCHANT_AUTH_COOKIE} from "./merchantAuthSession";
const actor={id:'00000000-0000-4000-8000-000000000002',email:'self@example.test'},owner={id:'00000000-0000-4000-8000-000000000001',email:'owner@example.test'};
const request=(headers:HeadersInit={})=>new Request('https://www.faolla.com/api/merchant-enterprise/attendance/revision-history',{headers});
test('SDK password protocol and actual auth resolver validate current claims and user together',async()=>{
  await withAttendanceApplicationAuth([actor,owner],null,async f=>{
    const token=await f.login(actor),context=await resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':token}));
    assert.equal(context.user.id,actor.id);assert.deepEqual(context.authenticationMethods,['password']);requireMerchantEnterprisePasswordAuthentication(context);
    assert(f.calls.some(c=>c.path==='/auth/v1/token'));assert.equal(f.calls.filter(c=>c.path==='/auth/v1/user').length,2);
    f.revoke(token);await assert.rejects(resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':token})),/unauthorized/);
  });
});
test('actual resolver rejects tampered, expired and mismatched subjects without trusting client identity',async()=>{
  await withAttendanceApplicationAuth([actor,owner],null,async f=>{
    const token=await f.login(actor);
    for(const bad of [f.tamper(token,{sub:owner.id}),f.tamper(token,{amr:[{method:'password'}],exp:9999999999}),f.issue(actor,['password'],-10),'bad-token'])
      await assert.rejects(resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':bad})),/unauthorized/);
    f.userMismatch(owner.id);await assert.rejects(resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':token})),/unauthorized/);
  });
});
test('employee explicit header cannot fall back to owner cookies and no token causes no auth request',async()=>{
  await withAttendanceApplicationAuth([actor,owner],null,async f=>{
    const own=await f.login(owner),self=await f.login(actor),cookie=`${MERCHANT_AUTH_COOKIE}=${own}`;
    assert.equal((await resolveValidatedMerchantEnterpriseAuthContext(request({cookie,'x-merchant-access-token':self}))).user.id,actor.id);
    const before=f.calls.length;await assert.rejects(resolveValidatedMerchantEnterpriseAuthContext(request({cookie,'x-merchant-access-token':''})),/unauthorized/);assert.equal(f.calls.length,before);
    await assert.rejects(resolveValidatedMerchantEnterpriseAuthContext(request({cookie,'x-merchant-access-token':'bad-token'})),/unauthorized/);
    assert.equal((await resolveValidatedMerchantEnterpriseAuthContext(request({cookie}))).user.id,owner.id);
  });
});
test('verified invite, recovery, OAuth and refreshed-password sessions retain existing employee policy',async()=>{
  await withAttendanceApplicationAuth([actor,owner],null,async f=>{
    for(const methods of [['invite'],['recovery'],['magiclink'],['oauth'],['password','recovery']]){
      const context=await resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':f.issue(actor,methods)}));
      assert.equal(context.user.id,actor.id);assert.throws(()=>requireMerchantEnterprisePasswordAuthentication(context),/employee_password_authentication_required/);
    }
    requireMerchantEnterprisePasswordAuthentication(await resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':f.issue(actor,['token_refresh','password'])})));
  });
});
test('in-memory protocol fixture restores process environment and never opens external endpoints',async()=>{
  const originalFetch=globalThis.fetch,originalUrl=process.env.SUPABASE_INTERNAL_URL;
  await assert.rejects(withAttendanceApplicationAuth([actor],null,async()=>{await fetch('https://outside.invalid/');}),/fixture_external_request_forbidden/);
  assert.equal(globalThis.fetch,originalFetch);assert.equal(process.env.SUPABASE_INTERNAL_URL,originalUrl);
});
test('SDK protocol refresh rotates one-use synthetic refresh credentials and retains password proof',async()=>{
  await withAttendanceApplicationAuth([actor],null,async()=>{
    const client=createClient('https://attendance-auth.invalid','attendance-synthetic-anon',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const first=await client.auth.signInWithPassword({email:actor.email,password:'Synthetic-attendance-only!'});assert.equal(first.error,null);assert(first.data.session);
    const next=await client.auth.refreshSession();assert.equal(next.error,null);assert(next.data.session);assert.notEqual(next.data.session.access_token,first.data.session.access_token);
    const context=await resolveValidatedMerchantEnterpriseAuthContext(request({'x-merchant-access-token':next.data.session.access_token}));
    assert.equal(context.user.id,actor.id);requireMerchantEnterprisePasswordAuthentication(context);assert(context.authenticationMethods.includes('token_refresh'));
    const replay=await fetch('https://attendance-auth.invalid/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:'attendance-synthetic-anon','content-type':'application/json'},body:JSON.stringify({refresh_token:first.data.session.refresh_token})});assert.equal(replay.status,400);
    assert.equal((await client.auth.signOut()).error,null);assert.equal((await client.auth.getSession()).data.session,null);
    const removed=await fetch('https://attendance-auth.invalid/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:'attendance-synthetic-anon','content-type':'application/json'},body:JSON.stringify({refresh_token:next.data.session.refresh_token})});assert.equal(removed.status,400);
  });
});
test('revocation makes synthetic refresh fail instead of silently renewing another identity',async()=>{
  await withAttendanceApplicationAuth([actor,owner],null,async f=>{
    const client=createClient('https://attendance-auth.invalid','attendance-synthetic-anon',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const first=await client.auth.signInWithPassword({email:actor.email,password:'Synthetic-attendance-only!'});assert(first.data.session);f.revoke(first.data.session.access_token);
    const next=await client.auth.refreshSession();assert(next.error);assert.equal(next.data.session,null);assert.equal((await client.auth.getSession()).data.session,null);
  });
});
