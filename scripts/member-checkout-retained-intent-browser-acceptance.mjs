// Actual ProductBlock, account draft, panel/controller, native storage/locks,
// and new HTTP handlers. Synthetic sessions/RPC only; all network intercepted.
import assert from'node:assert/strict';import test from'node:test';import{mkdir}from'node:fs/promises';import path from'node:path';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import fixture from'./fixtures/member-checkout-history-recovery.ts';import http from'../src/lib/merchantCheckoutRetainedIntent.server.ts';
const origin='https://retained-browser.synthetic.invalid';
const words={zh:{retry:'重新核验',register:'核对并登记原单',ack:'已核对原单，开始另一单',read:'读取原单'},en:{retry:'Recheck',register:'Register reviewed original',ack:'Reviewed — start another',read:'Read original'},es:{retry:'Verificar',register:'Registrar original revisado',ack:'Revisado — empezar otro',read:'Consultar original'}};
async function assets(){const[js,css]=await Promise.all([build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import Products from'./src/components/checkout/MemberProductCartBlock';createRoot(document.getElementById('root')).render(<Products products={window.__products} runtimeSiteId={window.__site} runtimeBlockId="products" runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled productPricePrefix="€"/>);`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-context',setup(b){
 b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));b.onResolve({filter:/authSessionRecovery$/},()=>({path:'session',namespace:'synthetic'}));b.onResolve({filter:/^next\/(image|link)$/},a=>({path:a.path,namespace:'synthetic'}));
 b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'jsx',resolveDir:process.cwd(),contents:p==='i18n'?'export const useI18n=()=>({locale:window.__locale});':p==='traffic'?'export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};':p==='session'?'export const resolveFrontendAuthPayload=async()=>null;':p==='next/link'?'import React from"react";export default({prefetch,...props})=><a {...props}/>;':'export default function Image(){return null;}'}));
 }}]}),postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('retained-browser.css')})]);return{js:js.outputFiles[0].text,css:css.css};}
async function scenario(browser,a,{kind='cart_points',locale='zh',width=390,mode='normal'}={}){
 const x=await fixture.historyRecoveryFixture(kind),t=words[locale],context=await browser.newContext({viewport:{width,height:width<600?720:900}}),page=await context.newPage();page.setDefaultTimeout(6000);
 const site=x.siteId,account=x.accountId,original=x.recovery.original,operationKey=x.identity.operationKey,hash='a'.repeat(64),key=`faolla-member-checkout-v2:${site}:${account}`,owned=`merchant-space:product-cart:v2:${site}:products:${account}`,shared=`merchant-space:product-cart:v1:${site}:products`;
 if(mode==='collected'){assert.equal(original.kind,'cart');assert.equal(original.result.method,'on_site');original.result.collection={amountMinor:original.result.dueMinor,currency:'eur',recordedAt:new Date().toISOString()};original.result.cancellationAvailable=false;}
 const product={id:'kept',code:'KEPT',name:'Keep my product',description:'',price:'5',imageUrl:'',thumbnailUrl:'',tag:''},item={productId:'kept',product,quantity:2,checked:true,unitPrice:5,unitPriceText:'€5'},customer={name:'Kept contact',email:'kept@example.invalid',phone:'123',note:'Keep note'};
 const initial={[key]:JSON.stringify({version:1,nonce:x.nonce}),[owned]:JSON.stringify({version:1,scope:{siteId:site,blockId:'products',accountId:account},revision:1,data:{items:[item],customer,clientRequestId:''}}),[shared]:JSON.stringify({items:[],customer:{name:'Unowned contact'},clientRequestId:''})};
 await context.addInitScript(({initial,site,product,locale,origin})=>{if(location.origin!==origin)return;window.__site=site;window.__products=[product];window.__locale=locale;if(!localStorage.getItem('retained-seeded')){for(const[k,v]of Object.entries(initial))localStorage.setItem(k,v);localStorage.setItem('retained-seeded','1');}},{initial,site,product,locale,origin});
 let registered=false,acknowledged=false,changed=false;const append=[],acks=[],unexpected=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const review=()=>({operationKey,generation:1,reviewHash:hash,reviewRequired:false,original,acknowledged});
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
  if(url.pathname==='/api/member-checkout/cart/entry'){const query=request.postDataJSON();return route.fulfill({status:200,json:{ok:true,intent:true,ownedDraft:true,...(mode!=='closed'?{retainedIntent:true}:{}),entry:{siteId:site,accountId:account,query,offers:[{offerId:'11111111-1111-4111-8111-111111111111',offerRevision:'22222222-2222-4222-8222-222222222222',title:'Synthetic',maxQuantity:10,source:{kind:'order',productId:'kept'}}]}}});}
  const body=request.postDataJSON();assert.equal(request.headers()['x-checkout-account-scope'],account);
  if(url.pathname.endsWith('cart/recover'))return route.fulfill({status:200,json:{ok:true,state:'confirmed',original}});
  if(url.pathname.endsWith('intent/review'))return route.fulfill(mode==='readFailed'?{status:503,json:{error:'checkout_intent_unconfirmed'}}:{status:200,json:{ok:true,review:registered?review():null}});
  if(url.pathname.endsWith('intent/pending'))return route.fulfill({status:200,json:{ok:true,snapshot:{version:1,siteId:site,pending:registered&&!acknowledged?review():null}}});
  if(/intent\/(retained-review|register-retained)$/.test(url.pathname)){
   const register=url.pathname.endsWith('register-retained'),session={...x.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
   const response=await http.handleRetainedCheckoutIntent(register,new Request(request.url(),{method:'POST',headers:{...request.headers(),origin},body:request.postData()}),{enabled:()=>true,session:async()=>session,call:async(name,args)=>{
    assert.equal(args.p_operation_key,operationKey);assert.equal(args.p_principal_key,x.identity.principalKey);
    if(name==='faolla_member_checkout_retained_intent_review_v1')return{data:{version:1,siteId:site,operationKey,proposal:mode==='absent'?null:{reviewHash:changed?'b'.repeat(64):hash,reviewRequired:mode==='manual',original}},error:null};
    assert.equal(name,'faolla_member_checkout_register_retained_intent_v1');assert.equal(args.p_review_hash,hash);append.push(args);registered=true;
    if(mode==='draftChanged')await page.evaluate(k=>{const v=JSON.parse(localStorage.getItem(k));v.revision++;v.data.customer.note='External change';localStorage.setItem(k,JSON.stringify(v));},owned);
    return{data:{version:1,siteId:site,replayed:append.length>1,review:review()},error:null};
   }});return route.fulfill(register&&mode==='lost'?{status:503,json:{error:'checkout_intent_unconfirmed'}}:{status:response.status,json:await response.json()});
  }
  if(url.pathname.endsWith('intent/acknowledge')){acks.push(body);acknowledged=true;assert.equal(registered,true);return route.fulfill({status:200,json:{ok:true,acknowledgement:{version:1,siteId:site,operationKey,generation:1,acknowledged:true,replayed:false}}});}
  unexpected.push(url.pathname);return route.abort();
 });
 await page.goto(origin);await page.addStyleTag({content:a.css});await page.addScriptTag({content:a.js});
 await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.locator('[data-cart-member-entry]').getByRole('button',{name:t.retry,exact:true}).click();
 const panel=page.locator('[data-member-cart-checkout]');await panel.waitFor();
 return{x,t,context,page,panel,initial,key,owned,shared,append,acks,unexpected,errors,changed:()=>{changed=true;},bytes:()=>page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(initial))};
}
test('retained originals explicitly register without financial replay through actual cart in three languages and two sizes',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`retained-intent-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${kind}-${width}-${locale}`,async()=>{
  const f=await scenario(browser,a,{kind,width,locale});try{const box=f.panel.locator('[data-retained-registration]');await box.waitFor();assert.equal(await box.getByRole('button').isDisabled(),true);
   if(kind.startsWith('single_')){const summary=f.panel.locator('[data-retained-single-summary]');await summary.waitFor();assert.ok((await summary.textContent()).includes('R-original-synthetic_retained'));}
   await box.getByRole('button').scrollIntoViewIfNeeded();await f.page.screenshot({path:path.join(evidence,`review-${kind}-${width}-${locale}.png`),fullPage:true});
   assert.deepEqual(await f.bytes(),f.initial);assert.equal(await f.panel.getByRole('button',{name:f.t.ack,exact:true}).count(),0);await box.getByRole('checkbox').check();await box.getByRole('button',{name:f.t.register,exact:true}).click();
   await f.panel.getByRole('button',{name:f.t.ack,exact:true}).waitFor();assert.equal(f.append.length,1);assert.equal(f.acks.length,0);assert.deepEqual(await f.bytes(),f.initial);
   await f.page.screenshot({path:path.join(evidence,`${kind}-${width}-${locale}.png`),fullPage:true});
   await f.panel.getByRole('button',{name:f.t.ack,exact:true}).click();await f.page.waitForFunction(k=>localStorage.getItem(k)===null,f.key);
   const bytes=await f.bytes();assert.equal(bytes[f.shared],f.initial[f.shared]);const data=JSON.parse(bytes[f.owned]).data,old=JSON.parse(f.initial[f.owned]).data;
   assert.deepEqual(data.items,old.items);assert.deepEqual(data.customer,old.customer);assert.equal(f.append.length,1);assert.equal(f.acks.length,1);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${kind}-${width}-${locale}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`RETAINED_INTENT_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
test('registration keeps unknown references and cart data on closed scope, lost reply, changed view and failed host handoff',{timeout:90000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`retained-intent-boundary-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const mode of ['closed','readFailed','manual','absent','lost','changed','draftChanged','collected'])await t.test(mode,async()=>{
  const f=await scenario(browser,a,{mode,...(mode==='collected'?{kind:'cart_on_site'}:{})});try{
   if(['closed','readFailed','absent'].includes(mode)){await f.panel.getByRole('alert').waitFor();assert.equal(await f.panel.locator('[data-retained-registration]').count(),0);assert.equal(f.append.length,0);}
   else if(mode==='manual'){await f.panel.getByRole('alert').waitFor();assert.equal(await f.panel.locator('[data-retained-registration]').count(),0);assert.equal(f.append.length,0);}
   else{const box=f.panel.locator('[data-retained-registration]');await box.waitFor();if(mode==='collected'){assert.match(await f.panel.locator('[data-cart-payment-status]').textContent(),/商户登记已收款/);assert.equal(await f.panel.getByRole('button',{name:'取消整车原单',exact:true}).count(),0);}
    await box.getByRole('checkbox').check();if(mode==='changed')f.changed();await box.getByRole('button').click();
    if(mode==='lost'||mode==='changed'){await f.panel.getByRole('alert').waitFor();if(mode==='lost'){await f.panel.getByRole('button',{name:f.t.read,exact:true}).click();await f.panel.getByRole('button',{name:f.t.ack,exact:true}).waitFor();}}
    else if(mode==='draftChanged'){await f.panel.getByRole('button',{name:f.t.ack,exact:true}).click();await f.panel.getByRole('alert').waitFor();}
    else{await f.panel.getByRole('button',{name:f.t.ack,exact:true}).waitFor();assert.match(await f.panel.locator('[data-cart-payment-status]').textContent(),/商户登记已收款/);}
    assert.equal(f.append.length,mode==='changed'?0:1);
   }
   const bytes=await f.bytes();assert.equal(bytes[f.key],f.initial[f.key]);assert.equal(bytes[f.shared],f.initial[f.shared]);if(mode!=='draftChanged')assert.equal(bytes[f.owned],f.initial[f.owned]);assert.equal(f.acks.length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
   await f.page.screenshot({path:path.join(evidence,`${mode}.png`),fullPage:true});
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${mode}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`RETAINED_INTENT_BOUNDARY_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
