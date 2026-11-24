// Owned TEMP-cluster entry point only. Actual HTTP, complete read-only SQL,
// synthetic identity/service ports. No grants, deployment or live connections.
import assert from 'node:assert/strict';
import ownerHttp from '../src/app/api/merchant-checkout/settlements/route-handler.ts';
import personalHttp from '../src/app/api/member-checkout/resource/route-handler.ts';
import history from '../src/lib/merchantCheckoutHistoryRead.server.ts';
import reporting from '../src/lib/merchantCheckoutReporting.server.ts';

export async function historyReadCases(t,{admin,a,seed,submit,state,site,one,dispatch}){
 const origin='https://history-postgres.synthetic.invalid';
 await t.test('closed purchase gates retain actual owner and original-customer history via complete SQL with no writes or receipt capability',async()=>{
  for(const method of ['points','on_site']){
   const f=await seed(method),result=(await submit(f)).result,before=await state();let reads=0;
   const scope={siteId:site,resources:[{kind:'order',id:result.resourceId}]},actor={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner'};
   const deps={enabled:()=>false,historyEnabled:()=>true,cartEnabled:()=>false,mixedEnabled:()=>false,collectionEnabled:()=>true,cartCollectionEnabled:()=>true,
    actor:async()=>actor,site:async()=>f.site,read:async()=>assert.fail('no incomplete report'),readMixed:async()=>assert.fail('no incomplete report'),
    readCart:input=>{reads++;return reporting.readCartCheckoutReporting(input,dispatch(admin));}};
   const access=await ownerHttp.handleCheckoutReportingAccess(new Request(`${origin}/api/merchant-checkout/settlements?siteId=${site}`,{headers:{origin}}),deps);
   assert.equal(access.status,200);const identity=(await access.json()).access.identityKey;
   const response=await ownerHttp.handleCheckoutReporting(new Request(`${origin}/api/merchant-checkout/settlements`,{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-owner-scope':identity},body:JSON.stringify(scope)}),deps);
   assert.equal(response.status,200);const body=await response.json();assert.equal(body.snapshot.version,3);assert.equal(body.snapshot.rows[0].cart.operationKey,result.operationKey);
   assert.equal(body.canRecordOnSiteReceipt,undefined);assert.equal(body.canRecordCartReceipt,undefined);assert.equal(reads,1);
   const session={...f.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}},query=`?siteId=${site}&kind=order&id=${result.resourceId}`;
   const request=account=>new Request(`${origin}/api/member-checkout/resource${query}`,{headers:{origin,'x-checkout-account-scope':account}});
   const personal=owner=>input=>history.readPersonalCheckoutHistoryResource(input,{enabled:()=>true,session:async()=>owner,
    call:async args=>({data:(await one(a,'select public.faolla_member_checkout_original_resource_v2($1,$2,$3,$4) result',[args.p_site_id,args.p_kind,args.p_id,args.p_principal_key])).result,error:null})});
   const mine=await personalHttp.handlePersonalCheckoutResource(request(session.accountId),async()=>assert.fail('no older fallback'),{historyEnabled:()=>true,readHistory:personal(session)});
   assert.equal(mine.status,200);const own=await mine.json();assert.equal(own.readOnly,true);assert.equal(own.cart.operationKey,result.operationKey);assert.ok(!/principalKey|userId|customerAccountId/.test(JSON.stringify(own)));
   const foreign={...session,accountId:'59999999',userId:'other-history-synthetic-user'};
   const other=await personalHttp.handlePersonalCheckoutResource(request(foreign.accountId),async()=>assert.fail('no older fallback'),{historyEnabled:()=>true,readHistory:personal(foreign)});
   assert.equal(other.status,200);assert.deepEqual(await other.json(),{ok:true,result:null,readOnly:true});assert.deepEqual(await state(),before);
  }
 });
 await t.test('the history change grants no SQL execution to API roles and changes no database state',async()=>{
  const before=await state();for(const role of ['anon','authenticated','service_role'])for(const signature of ['public.faolla_member_checkout_reporting_v3(text,jsonb)','public.faolla_member_checkout_original_resource_v2(text,text,text,text)']){
   assert.equal((await one(admin,"select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).allowed,false);
  }assert.deepEqual(await state(),before);
 });
}
