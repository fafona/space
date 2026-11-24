// Actual manager integration/personal entry -> actual HTTP and safe parsers.
// Synthetic identity/service/private read ports; all network is intercepted.
// NOT a running Next/PostgREST app, real account or production ACL acceptance.
import assert from 'node:assert/strict';import test from 'node:test';import path from 'node:path';import{mkdir}from'node:fs/promises';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import fixtures from'./fixtures/member-checkout-resume.ts';import catalog from'./fixtures/member-checkout-cart-review.ts';
import ownerHttp from'../src/app/api/merchant-checkout/settlements/route-handler.ts';import personalHttp from'../src/app/api/member-checkout/resource/route-handler.ts';
import history from'../src/lib/merchantCheckoutHistoryRead.server.ts';
const origin='https://history-browser.synthetic.invalid',html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>';
const readOnly={zh:'只读查阅原单',en:'Read-only original.',es:'Original de solo lectura.'};let assets;
async function compile(){return assets??=Promise.all([
 build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutManagerIntegration as Manager}from'./src/components/checkout/MerchantCheckoutManagerIntegration';import{MemberCheckoutRecordEntry as Entry}from'./src/components/checkout/MemberCheckoutRecordEntry';
 const api=(url,init)=>fetch(url,init),request=async(url,init)=>{const r=await fetch(url,init),v=await r.json();if(!r.ok)throw Error('unavailable');return v;},root=createRoot(document.getElementById('root'));
 window.__render=()=>root.render(window.__target==='owner'?<Manager active siteId={window.__siteId} resources={[window.__resource]} locale={window.__locale} apiClient={api}/>:<Entry active accountId={window.__accountId} siteId={window.__siteId} kind={window.__resource.kind} id={window.__resource.id} locale={window.__locale} request={request}/>);window.__render();`},
  bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}}),
 postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout";',{from:path.resolve('history-browser.css')})
 ]).then(([js,css])=>({js:js.outputFiles[0].text,css:css.css}));}
async function mount(browser,kind,target,width,locale){
 const x=await fixtures.checkoutResumeFixture(kind),c=await catalog.cartReviewFixture(),a=await compile(),value=x.original.kind==='cart'?x.original.result:x.original.original.method==='on_site'?x.original.original.result.terms:x.original.original.result;
 const resource={kind:value.resourceKind,id:value.resourceId},row={...resource,termsMatch:true,...(x.original.kind==='cart'?{result:null,cart:x.original.result}:x.original.original.method==='on_site'?{result:null,onSite:x.original.original.result}:{result:x.original.original.result})};
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],unexpected=[],requests=[];let mode='ok';
 const actor={type:'owner',siteId:x.siteId,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner'},session={accountId:x.accountId,userId:x.userId,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
 const ownerDeps={enabled:()=>false,historyEnabled:()=>true,cartEnabled:()=>false,mixedEnabled:()=>false,collectionEnabled:()=>true,cartCollectionEnabled:()=>true,
  actor:async()=>actor,site:async()=>({...c.f.site,id:x.siteId}),read:async()=>assert.fail('no incomplete v1'),readMixed:async()=>assert.fail('no incomplete v2'),
  readCart:async()=>{if(mode==='error')throw Error('PRIVATE');return{version:3,siteId:x.siteId,rows:[{...row,PRIVATE:'discard'}]};}};
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await context.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==origin){unexpected.push(q.url());return route.abort();}
  if(q.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});requests.push(`${q.method()} ${u.pathname}`);
  const request=new Request(q.url(),{method:q.method(),headers:{...q.headers(),origin},...(q.method()==='POST'?{body:q.postData()}:{} )});let response;
  if(u.pathname==='/api/merchant-checkout/settlements')response=q.method()==='GET'?await ownerHttp.handleCheckoutReportingAccess(request,ownerDeps):await ownerHttp.handleCheckoutReporting(request,ownerDeps);
  else if(u.pathname==='/api/member-checkout/resource')response=await personalHttp.handlePersonalCheckoutResource(request,async()=>assert.fail('no disabled old lookup'),{
   historyEnabled:()=>true,readHistory:input=>history.readPersonalCheckoutHistoryResource(input,{enabled:()=>true,session:async()=>session,
    call:async args=>{assert.equal(args.p_principal_key,`account:${x.accountId}:${x.userId}`);if(mode==='error')throw Error('PRIVATE');return{data:x.original,error:null};}})});
  else{unexpected.push(u.pathname);return route.abort();}
  const json=await response.json();assert.ok(!JSON.stringify(json).includes('PRIVATE'));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),json});
 });
 await page.goto(origin);await page.evaluate(v=>Object.assign(window,v),{__target:target,__siteId:x.siteId,__accountId:x.accountId,__resource:resource,__locale:locale});
 await page.addStyleTag({content:a.css+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif;padding:16px}'});await page.addScriptTag({content:a.js});
 return{context,page,errors,unexpected,requests,x,resource,mode:v=>{mode=v;}};
}
test('retained history is readable but cannot collect/cancel/debit in two sizes and three languages',{timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true}),evidence=path.resolve(`output/checkout-history-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const target of ['owner','personal'])for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${target} ${kind} ${width} ${locale}`,async()=>{
  const x=await mount(browser,kind,target,width,locale),lang=locale.slice(0,2);try{
   if(target==='owner'){await x.page.locator('[data-checkout-manager]>button').click();await x.page.locator(`[data-resource-id="${x.resource.id}"]`).waitFor();
    assert.equal(await x.page.getByRole('button',{name:/登记到店收款|Record venue receipt|Registrar cobro|Confirm full|确认已收到|Confirmar importe/}).count(),0);
   }else{await x.page.locator('[data-checkout-record-entry]>button').click();await x.page.getByText(readOnly[lang],{exact:false}).waitFor();
    assert.equal(await x.page.locator('[data-checkout-record-entry] a').count(),0);assert.equal(await x.page.locator('[data-checkout-record-entry] button').count(),1);
   }
   assert.equal(await x.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await x.page.evaluate(()=>localStorage.length),0);
   assert.deepEqual(x.unexpected,[]);assert.deepEqual(x.errors,[]);assert.ok(x.requests.every(v=>v.includes('/settlements')||v.includes('/resource')));
   if(kind==='cart_on_site'&&locale==='es-ES')await x.page.screenshot({path:path.join(evidence,`${target}-${width}.png`),fullPage:true});
  }catch(error){await x.page.screenshot({path:path.join(evidence,`failed-${target}-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await x.context.close();}
 });console.log(`CHECKOUT_HISTORY_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});
test('read failures clear previous facts, and account changes cannot expose or re-enable the old original',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const target of ['owner','personal']){
  const x=await mount(browser,'cart_on_site',target,390,'en-GB');try{
   if(target==='owner'){await x.page.locator('[data-checkout-manager]>button').click();await x.page.locator('[data-cart-summary]').waitFor();x.mode('error');await x.page.getByRole('button',{name:'Reload',exact:true}).click();await x.page.getByRole('alert').waitFor();}
   else{await x.page.locator('[data-checkout-record-entry]>button').click();await x.page.getByText(readOnly.en,{exact:false}).waitFor();x.mode('error');await x.page.locator('[data-checkout-record-entry]>button').click();await x.page.getByText('Settlement could not be checked.',{exact:false}).waitFor();
    await x.page.evaluate(()=>{window.__accountId='59999999';window.__render();});assert.equal(await x.page.locator('[data-cart-summary]').count(),0);await x.page.locator('[data-checkout-record-entry]>button').click();await x.page.getByText('Settlement could not be checked.',{exact:false}).waitFor();assert.equal(await x.page.locator('[data-checkout-record-entry] a').count(),0);}
   assert.equal(await x.page.locator('[data-cart-summary]').count(),0);assert.deepEqual(x.unexpected,[]);assert.deepEqual(x.errors,[]);
  }finally{await x.context.close();}
 }}finally{await browser.close();}
});
