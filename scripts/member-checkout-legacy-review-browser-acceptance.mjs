// Actual gated ProductBlock + actual entry/review HTTP; synthetic sessions/RPC.
// Every network route intercepted. No production storage, finance or services.
import assert from 'node:assert/strict';import test from 'node:test';
import{mkdir}from'node:fs/promises';import path from'node:path';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import entryHttp from'../src/app/api/member-checkout/cart/entry/route-handler.ts';import reviewHttp from'../src/lib/merchantCheckoutLegacyReview.server.ts';
import handoffHttp from'../src/lib/merchantCheckoutLegacyHandoff.server.ts';
const origin='https://legacy-review-browser.synthetic.invalid',siteId='10909994',accountId='58000001',userId='legacy-browser-synthetic';
const query={siteId,blockId:'products',requestId:'ordinary-browser-request'},order={id:'O-old-synthetic',status:'pending',createdAt:'2026-11-24T10:00:00.000Z',updatedAt:'2026-11-24T10:00:00.001Z'};
const title={zh:'旧普通订单核对',en:'Review old regular order',es:'Revisar pedido normal antiguo'},read={zh:'核对旧普通订单',en:'Check old regular order',es:'Consultar pedido normal antiguo'};
async function assets(){
 const[js,css]=await Promise.all([build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from 'react';import{createRoot}from'react-dom/client';import Products from './src/components/checkout/MemberProductCartBlock';import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));createRoot(document.getElementById('root')).render(<Products products={window.__products} runtimeSiteId="${siteId}" runtimeBlockId="products" runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled productPricePrefix="€"/>);`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-context-only',setup(b){
  b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));b.onResolve({filter:/authSessionRecovery$/},()=>({path:'session',namespace:'synthetic'}));b.onResolve({filter:/^next\/(image|link)$/},a=>({path:a.path,namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'jsx',resolveDir:process.cwd(),contents:p==='i18n'?'export const useI18n=()=>({locale:window.__locale});':p==='traffic'?'export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};':p==='session'?'export const resolveFrontendAuthPayload=async()=>null;':p==='next/link'?'import React from "react";export default({prefetch,...props})=><a {...props}/>;':'export default function Image(){return null;}'}));
 }}]}),postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('legacy-review-browser.css')})]);return{js:js.outputFiles[0].text,css:css.css};
}
async function fixture(browser,a,{width=390,height=680,locale='zh',status='pending',mode='owned',handoff=false,retainNonce=true}={}){
 const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();
 const legacyKey=`merchant-space:product-cart:v1:${siteId}:products`,ownedKey=`merchant-space:product-cart:v2:${siteId}:products:${accountId}`,nonceKey=`faolla-member-checkout-v2:${siteId}:${accountId}`;
 const product={id:'kept',code:'KEPT',name:'Kept account product',description:'',price:'5',imageUrl:'',thumbnailUrl:'',tag:''},item={productId:product.id,product,quantity:2,checked:true,unitPrice:5,unitPriceText:'€5'};
 const initial={[legacyKey]:mode==='corrupt'?'broken-shared-draft':JSON.stringify({items:[item],customer:{name:'PRIVATE prior contact',email:'private@example.invalid',phone:'999',note:'PRIVATE prior note'},clientRequestId:query.requestId}),
  [ownedKey]:JSON.stringify({version:1,scope:{siteId,accountId,blockId:'products'},revision:3,data:{items:[item],customer:{name:'Owned contact',email:'owned@example.invalid',phone:'123',note:'Keep note'},clientRequestId:''}}),[nonceKey]:JSON.stringify({version:1,nonce:'11111111-1111-4111-8111-111111111111'})};
 if(!retainNonce)delete initial[nonceKey];
 await context.addInitScript(({initial,product,locale,expectedOrigin})=>{if(location.origin!==expectedOrigin)return;window.__products=[product];window.__locale=locale;if(!localStorage.getItem('synthetic-legacy-seeded')){for(const[k,v]of Object.entries(initial))localStorage.setItem(k,v);localStorage.setItem('synthetic-legacy-seeded','1');}window.__writes=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){window.__writes.push(k);return set.call(this,k,v);};},{initial,product,locale,expectedOrigin:origin});
 let authenticated=mode!=='forgedGuest',enabled=true,handoffEnabled=true,release,handoffRelease;const rpc=[],calls=[],handoffCalls=[],errors=[],unexpected=[];page.on('pageerror',e=>errors.push(e.message));
 const session=()=>authenticated?{accountId,userId,servicePaused:false,user:{email_confirmed_at:'2026-11-24T00:00:00Z'}}:null;
 const reply=async(route,response)=>route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());calls.push(url.pathname);if(url.origin!==origin){unexpected.push(req.url());return route.abort();}
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/synthetic.css"><div id="root"></div><script src="/synthetic.js"></script>'});
  if(url.pathname==='/synthetic.js')return route.fulfill({contentType:'text/javascript',body:a.js});if(url.pathname==='/synthetic.css')return route.fulfill({contentType:'text/css',body:a.css});
  const request=()=>new Request(url.href,{method:req.method(),headers:{...req.headers(),origin},body:req.postData()});
  if(url.pathname==='/api/member-checkout/cart/entry'){
   const response=await entryHttp.handleCartCheckoutEntry(request(),{enabled:()=>true,recoveryEnabled:()=>true,intentEnabled:()=>true,draftEnabled:()=>mode!=='noDraft',legacyReviewEnabled:()=>mode!=='closed',legacyHandoffEnabled:()=>handoff,session:async()=>session(),read:async()=>[]});
   if(mode==='forgedGuest'){const value=await response.json();assert.equal(value.entry,null);return route.fulfill({json:{...value,intent:true,ownedDraft:true,legacyReview:true,legacyHandoff:handoff}});}return reply(route,response);
  }
  if(url.pathname==='/api/personal-favorites')return route.fulfill({json:{authenticated,accountId:authenticated?accountId:''}});
  if(url.pathname==='/api/member-checkout/legacy/review'){
   const response=await reviewHttp.handleCheckoutLegacyReview(request(),{enabled:()=>enabled,session:async()=>session(),call:async(name,args)=>{
    rpc.push(name);assert.equal(name,'faolla_member_checkout_legacy_review_v1');const{p_not_after,...rest}=args;assert.ok(Number.isFinite(Date.parse(p_not_after)));assert.deepEqual(rest,{p_site_id:siteId,p_block_id:'products',p_request_id:query.requestId,p_principal_key:`account:${accountId}:${userId}`});
    if(mode==='late')await new Promise(r=>{release=r;});if(mode==='failure')throw Error('PRIVATE failure');return{data:{version:1,...query,order:mode==='unknown'?null:{...order,status,...(mode==='unsafe'?{paymentStatus:'paid'}:{})}},error:null};
   }});return reply(route,response);
  }
  if(url.pathname==='/api/member-checkout/legacy/handoff-review'){
   handoffCalls.push(req.postData());assert.ok(!req.postData().includes('PRIVATE'));assert.deepEqual(JSON.parse(req.postData()),query);
   const response=await handoffHttp.handleCheckoutLegacyHandoffReview(request(),{enabled:()=>handoff&&handoffEnabled,session:async()=>session(),call:async(name,args)=>{
    rpc.push(name);assert.equal(name,'faolla_member_checkout_legacy_review_v1');assert.equal(args.p_principal_key,`account:${accountId}:${userId}`);
    if(mode==='handoffLate'||mode==='handoffIdentity'||mode==='handoffStorage')await new Promise(r=>{handoffRelease=r;});
    if(mode==='handoffFailure')throw Error('PRIVATE handoff');return{data:{version:1,...query,order:mode==='handoffForeign'?null:{...order,status,...(mode==='handoffChanged'?{updatedAt:'2026-11-24T10:02:00.000Z'}:{})}},error:null};
   }});return reply(route,response);
  }
  unexpected.push(`${req.method()} ${url.pathname}`);return route.abort();
 });
 return{page,context,initial,legacyKey,ownedKey,nonceKey,rpc,calls,handoffCalls,errors,unexpected,release:()=>release?.(),releaseHandoff:()=>handoffRelease?.(),revoke:()=>{enabled=false;},revokeHandoff:()=>{handoffEnabled=false;},signOut:()=>{authenticated=false;},async bytes(){return page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(initial));},async check(){assert.deepEqual(await this.bytes(),initial);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}};
}
async function open(f){await f.page.goto(origin);await f.page.getByRole('button',{name:'打开购物车',exact:true}).click();}
test('manual old-order record review keeps shared cart, owned draft and financial reference unchanged across states/languages/sizes',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`legacy-review-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const status of ['pending','confirmed','completed','cancelled'])for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${status} ${width} ${locale}`,async()=>{
  const f=await fixture(browser,a,{status,width,locale});try{
   await open(f);const panel=f.page.locator('[data-checkout-legacy-review]');await panel.getByRole('heading',{name:title[locale],exact:true}).waitFor();assert.equal(f.rpc.length,0);assert.equal(await f.page.getByText('PRIVATE prior contact',{exact:true}).count(),0);
   await panel.getByRole('button',{name:read[locale],exact:true}).click();await panel.locator('[data-legacy-review-order-id]').waitFor();assert.equal(await panel.locator('[data-legacy-review-order-id]').textContent(),order.id);assert.equal(f.rpc.length,1);
   assert.equal(await panel.locator('input,select,textarea,a').count(),0);assert.equal(await panel.getByRole('button').count(),1);assert.ok(!(await panel.textContent()).includes('PRIVATE'));assert.equal(await f.page.locator('[data-member-cart-checkout]').count(),0);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   const rect=await panel.boundingBox();assert.ok(rect&&rect.y>=0&&rect.y+rect.height<=680+1&&rect.height<=680*.32+1,'review must fit without displacing the cart');
   const item=f.page.getByText('Kept account product',{exact:true}).last(),itemBox=await item.boundingBox();assert.ok(itemBox&&itemBox.y>0&&itemBox.y+itemBox.height<=rect.y,'owned products remain visible above the review');
   await panel.evaluate(e=>{e.scrollTop=e.scrollHeight;});assert.ok((await panel.textContent()).includes('UTC'));await panel.evaluate(e=>{e.scrollTop=0;});
   const button=await panel.getByRole('button',{name:read[locale],exact:true}).boundingBox();assert.ok(button&&button.y>=0&&button.y+button.height<=680+1);await f.check();
   if(status==='completed'&&locale==='es')await f.page.screenshot({path:path.join(evidence,`${width}-${locale}.png`),fullPage:true});
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${status}-${width}-${locale}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`LEGACY_REVIEW_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});

const handoffButton={zh:'保留旧车，使用独立购物车',en:'Keep old cart; use account cart',es:'Conservar y usar carrito de mi cuenta'};
const markerKey=`merchant-space:product-cart:legacy-isolation:v1:${siteId}:products:${accountId}`;
async function reviewed(f,locale='zh'){
 await open(f);const panel=f.page.locator('[data-checkout-legacy-review]');await panel.getByRole('button',{name:read[locale],exact:true}).click();await panel.locator('[data-legacy-review-order-id]').waitFor();return panel;
}
test('explicit isolated handoff preserves both actual carts and revalidates on reopen in both sizes and three languages',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`legacy-handoff-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${width} ${locale}`,async()=>{
  const f=await fixture(browser,a,{width,locale,handoff:true,retainNonce:false});try{
   const panel=await reviewed(f,locale),decision=panel.locator('[data-legacy-handoff]'),button=decision.getByRole('button',{name:handoffButton[locale],exact:true});await decision.waitFor();
   assert.equal(await button.isDisabled(),true);assert.equal(f.handoffCalls.length,0);const beginLabel=locale==='zh'?'核对会员积分与券':locale==='en'?'Review member points & coupons':'Revisar puntos y cupones';assert.equal(await f.page.getByRole('button',{name:beginLabel,exact:true}).isDisabled(),true);await f.check();
   await decision.getByRole('checkbox').check();if(locale==='es')await f.page.screenshot({path:path.join(evidence,`${width}-confirm.png`),fullPage:true});await button.click();await decision.waitFor({state:'detached'});await panel.getByRole('status').waitFor();assert.equal(f.handoffCalls.length,1);await f.check();
   const marker=await f.page.evaluate(k=>localStorage.getItem(k),markerKey);assert.ok(marker);assert.ok(!marker.includes('PRIVATE'));assert.ok(!marker.includes('Owned contact'));assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.nonceKey),null);
   assert.deepEqual(await f.page.evaluate(()=>window.__writes),[markerKey]);const plus=f.page.getByRole('button',{name:'+',exact:true}).last();assert.equal(await plus.isDisabled(),false);await plus.click();
   await f.page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).data.items[0].quantity===3,f.ownedKey);const owned=await f.page.evaluate(k=>localStorage.getItem(k),f.ownedKey);assert.equal(JSON.parse(owned).data.customer.name,'Owned contact');assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.legacyKey),f.initial[f.legacyKey]);
   await open(f);await f.page.getByRole('button',{name:locale==='zh'?'核对会员积分与券':locale==='en'?'Review member points & coupons':'Revisar puntos y cupones',exact:true}).waitFor();assert.equal(f.handoffCalls.length,2);
   assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.ownedKey),owned);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),markerKey),marker);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.legacyKey),f.initial[f.legacyKey]);assert.deepEqual(await f.page.evaluate(()=>window.__writes),[]);
   assert.equal(await f.page.locator('[data-legacy-handoff]').count(),0);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
   if(locale==='es')await f.page.screenshot({path:path.join(evidence,`${width}-reopened.png`),fullPage:true});
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${width}-${locale}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`LEGACY_HANDOFF_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
test('explicit handoff never bypasses financial originals, failed rechecks, other tabs or changed identities',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`legacy-handoff-boundary-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const mode of ['nonce','closed','noDraft','forgedGuest','handoffFailure','handoffForeign','handoffChanged','revokedHandoff','handoffLate','handoffIdentity','handoffStorage','lock','double','markerChangedAfter','reopenOff'])await t.test(mode,async()=>{
  const f=await fixture(browser,a,{mode,handoff:true,retainNonce:mode==='nonce'});try{
   if(['closed','noDraft','forgedGuest'].includes(mode)){await open(f);await f.page.waitForFunction(()=>!document.body.textContent.includes('正在核验会员结算入口'));assert.equal(await f.page.locator('[data-legacy-handoff]').count(),0);assert.equal(f.handoffCalls.length,0);return;}
   const panel=await reviewed(f),decision=panel.locator('[data-legacy-handoff]');
   if(mode==='nonce'){assert.equal(await decision.count(),0);assert.equal(f.handoffCalls.length,0);await f.check();return;}
   await decision.getByRole('checkbox').check();if(mode==='revokedHandoff')f.revokeHandoff();
   if(mode==='lock'){await f.page.evaluate(k=>{void navigator.locks.request(k,async()=>{window.__lockHeld=true;await new Promise(r=>{window.__releaseLock=r;});});},f.nonceKey);await f.page.waitForFunction(()=>window.__lockHeld);}
   const button=decision.getByRole('button',{name:handoffButton.zh,exact:true});if(mode==='double')await button.evaluate(b=>{b.click();b.click();});else await button.click();
   if(['handoffLate','handoffIdentity','handoffStorage'].includes(mode)){
    const until=Date.now()+3000;while(f.handoffCalls.length<1&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(f.handoffCalls.length,1);
    if(mode==='handoffStorage')await f.page.evaluate(k=>window.dispatchEvent(new StorageEvent('storage',{key:k})),f.legacyKey);else{f.signOut();await f.page.evaluate(()=>window.__identity());}f.releaseHandoff();await f.page.waitForFunction(()=>!document.querySelector('[data-legacy-handoff]'));
   }else if(['double','markerChangedAfter','reopenOff'].includes(mode)){
    await decision.waitFor({state:'detached'});assert.equal(f.handoffCalls.length,1);const marker=await f.page.evaluate(k=>localStorage.getItem(k),markerKey);assert.ok(marker);await f.check();
    if(mode==='markerChangedAfter'){await f.page.evaluate(k=>{localStorage.setItem(k,'changed');window.dispatchEvent(new StorageEvent('storage',{key:k}));},markerKey);await f.page.waitForFunction(()=>!document.querySelector('[data-checkout-legacy-review]'));await f.check();}
    if(mode==='reopenOff'){f.revokeHandoff();await open(f);await f.page.locator('[data-cart-draft-error]').waitFor();assert.equal(f.handoffCalls.length,2);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),markerKey),marker);assert.equal(await f.page.locator('[data-legacy-handoff]').count(),0);await f.check();}
    return;
   }
   else await panel.getByRole('alert').waitFor();
   assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),markerKey),null);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.ownedKey),f.initial[f.ownedKey]);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.nonceKey),null);
   if(mode!=='handoffIdentity'&&mode!=='handoffLate')assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.legacyKey),f.initial[f.legacyKey]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
   if(mode==='lock'){assert.equal(f.handoffCalls.length,0);await f.page.evaluate(()=>window.__releaseLock());}
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${mode}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`LEGACY_HANDOFF_BOUNDARY_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
test('old-order record review cannot grant authority through public hints, failures or identity/storage changes',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`legacy-review-boundary-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const mode of ['closed','noDraft','forgedGuest','corrupt','unknown','failure','unsafe','revoke','signOut','storage','late','identity'])await t.test(mode,async()=>{
  const f=await fixture(browser,a,{mode});try{
   await open(f);const panel=f.page.locator('[data-checkout-legacy-review]');
   if(['closed','noDraft','forgedGuest'].includes(mode)){await f.page.waitForFunction(()=>!document.body.textContent.includes('正在核验会员结算入口'));assert.equal(await panel.count(),0);assert.equal(f.rpc.length,0);if(mode==='forgedGuest'||mode==='noDraft'){assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.ownedKey),f.initial[f.ownedKey]);assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.nonceKey),f.initial[f.nonceKey]);}else await f.check();return;}
   await panel.waitFor();if(mode==='corrupt'){await panel.getByRole('alert').waitFor();assert.equal(f.rpc.length,0);await f.check();return;}
   if(mode==='revoke')f.revoke();if(mode==='signOut')f.signOut();
   if(mode==='storage'){await f.page.evaluate(k=>window.dispatchEvent(new StorageEvent('storage',{key:k})),f.legacyKey);await f.page.waitForFunction(()=>!document.querySelector('[data-checkout-legacy-review]'));await f.check();return;}
   await panel.getByRole('button',{name:read.zh,exact:true}).click();
   if(mode==='late'){const until=Date.now()+3000;while(!f.rpc.length&&Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.equal(f.rpc.length,1);f.signOut();await f.page.evaluate(()=>window.__identity());f.release();await f.page.waitForFunction(()=>!document.querySelector('[data-checkout-legacy-review]'));}
   else if(mode==='identity'){await panel.locator('[data-legacy-review-order-id]').waitFor();f.signOut();await f.page.evaluate(()=>window.__identity());await f.page.waitForFunction(()=>!document.querySelector('[data-checkout-legacy-review]'));}
   else if(mode==='unknown')await panel.getByRole('status').waitFor();else await panel.getByRole('alert').waitFor();
   assert.equal(await f.page.locator('[data-legacy-review-order-id]').count(),0);assert.equal(await f.page.locator('[data-member-cart-checkout]').count(),0);
   if(mode==='identity'||mode==='late'){
    // Unchanged legacy guest mode may reserialize its own v1 cart on logout.
    // No new review action writes it: preserve every original field semantically.
    const values=await f.bytes(),raw=JSON.parse(values[f.legacyKey]),old=JSON.parse(f.initial[f.legacyKey]);assert.deepEqual(raw.customer,old.customer);assert.equal(raw.clientRequestId,old.clientRequestId);assert.equal(raw.items.length,old.items.length);
    for(let i=0;i<raw.items.length;i++){assert.equal(raw.items[i].productId,old.items[i].productId);assert.equal(raw.items[i].quantity,old.items[i].quantity);assert.equal(raw.items[i].unitPrice,old.items[i].unitPrice);assert.deepEqual(raw.items[i].product,old.items[i].product);}
    assert.equal(values[f.ownedKey],f.initial[f.ownedKey]);assert.equal(values[f.nonceKey],f.initial[f.nonceKey]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
   }else await f.check();assert.ok(!(await f.page.locator('body').textContent()).includes('PRIVATE'));
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${mode}.png`),fullPage:true});throw error;}finally{await f.context.close();}
 });}finally{console.log(`LEGACY_REVIEW_BOUNDARY_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
