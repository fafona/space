// Actual standalone Start client, both panels/coordinators, native Web Locks
// and storage, and real HTTP handlers. Only sessions/private RPC are synthetic;
// all network intercepted. No running Next/PostgREST, phones or live data.
import assert from'node:assert/strict';import test from'node:test';import{mkdir}from'node:fs/promises';import path from'node:path';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import originals from'./fixtures/member-checkout-history-recovery.ts';import selection from'./fixtures/member-checkout-single-intent.ts';
import retainedHttp from'../src/lib/merchantCheckoutRetainedIntent.server.ts';import cartHttp from'../src/lib/merchantCheckoutCartHttp.server.ts';import intentHttp from'../src/lib/merchantCheckoutIntentHttp.server.ts';
const origin='https://single-retained-browser.synthetic.invalid',html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';
const words={zh:{register:'核对并登记原单',another:'已核对，开始另一单',read:'核对原单',quote:['核对积分与券','核对金额与优惠券'],login:'用户登录',shop:'返回商户购物车'},en:{register:'Register reviewed original',another:'Reviewed — start another',read:'Check original checkout',quote:['Review points & coupons','Review amount & coupons'],login:'Sign in',shop:'Back to merchant cart'},es:{register:'Registrar original revisado',another:'Revisado — empezar otro',read:'Consultar pedido original',quote:['Revisar puntos y cupones','Revisar importe y cupones'],login:'Iniciar sesión',shop:'Volver al carrito del comercio'}};
async function assets(){const[js,css]=await Promise.all([build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import Start from'./src/app/member-checkout/[siteId]/start/CheckoutStartClient';import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));createRoot(document.getElementById('root')).render(<Start siteId={window.__selection.siteId} initialSelection={window.__selection} onSite={window.__method==='on_site'} intentEnabled retainedIntentEnabled={window.__enabled}/>);`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-context',setup(b){b.onResolve({filter:/^(?:@\/components\/I18nProvider|next\/link)$/},a=>({path:a.path,namespace:'context'}));b.onLoad({filter:/.*/,namespace:'context'},a=>({contents:a.path==='next/link'?"import React from'react';export default({prefetch,...props})=><a {...props}/>;":"export const useI18n=()=>({locale:window.__locale});",loader:'tsx',resolveDir:process.cwd()}));}}]}),postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/booking"; @source "./src/app/member-checkout";',{from:path.resolve('single-retained-browser.css')})]);return{js:js.outputFiles[0].text,css:css.css};}
async function fixture(browser,a,{method='points',kind='single_points',width=390,locale='zh',mode='normal'}={}){
 const x=await originals.historyRecoveryFixture(kind),s=await selection.singleIntentFixture(method),t=words[locale],context=await browser.newContext({viewport:{width,height:width<600?760:1050}}),page=await context.newPage();page.setDefaultTimeout(6500);
 const original=x.recovery.original,op=x.identity.operationKey,hash='a'.repeat(64),key=`faolla-member-checkout-v2:${x.siteId}:${x.accountId}`;
 const hostForm=`merchant-space:booking-draft:synthetic`,hostCart=`merchant-space:product-cart:v2:${x.siteId}:products:${x.accountId}`,initial={[key]:JSON.stringify({version:1,nonce:x.nonce}),[hostForm]:'KEEP original appointment/member/contact/note',[hostCart]:'KEEP saved products, member, coupons and note'};
 if(mode==='noNonce')delete initial[key];
 await context.addInitScript(({initial,selection,method,locale,enabled,origin})=>{if(location.origin!==origin)return;Object.assign(window,{__selection:selection,__method:method,__locale:locale,__enabled:enabled});if(!localStorage.getItem('single-retained-seeded')){for(const[k,v]of Object.entries(initial))localStorage.setItem(k,v);localStorage.setItem('single-retained-seeded','1');}},{initial,selection:s.selection,method,locale,enabled:mode!=='closedUi',origin});
 let registered=false,acknowledged=false,guest=mode==='guest',enabled=true,changed=false,release;
 const calls=[],rpc=[],errors=[],unexpected=[],appends=[],acks=[];page.on('pageerror',e=>errors.push(e.message));
 const reviewed=()=>({operationKey:op,generation:1,reviewHash:changed?'b'.repeat(64):hash,reviewRequired:mode==='manual',original,acknowledged});
 const session=async()=>guest?null:{...x.principal,servicePaused:false,user:{email_confirmed_at:new Date().toISOString()}};
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){unexpected.push(url.href);return route.abort();}if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
  calls.push(url.pathname);if(url.pathname==='/api/personal-favorites')return route.fulfill({json:{authenticated:!guest,accountId:guest?'':x.accountId}});
  if(!/^\/api\/member-checkout\/(?:cart\/recover|intent\/(?:pending|review|acknowledge|retained-review|register-retained))$/.test(url.pathname)){unexpected.push(url.pathname);return route.abort();}
  assert.equal(req.headers()['x-checkout-account-scope'],x.accountId);const body=req.postDataJSON(),register=url.pathname.endsWith('register-retained');
  const call=async(name,args)=>{rpc.push(name);assert.equal(args.p_site_id,x.siteId);assert.equal(args.p_principal_key,x.identity.principalKey);if(!name.includes('pending'))assert.equal(args.p_operation_key,op);
   if(name==='faolla_member_checkout_cart_result_v1')return{data:original.kind==='cart'?original.result:null,error:null};
   if(name==='faolla_member_checkout_original_result_v1')return{data:original.kind==='single'?original.original:null,error:null};
   if(name==='faolla_member_checkout_pending_intent_v1')return mode==='noNonce'?{data:null,error:{message:'checkout_intent_review_required'}}:{data:{version:1,siteId:x.siteId,pending:registered&&!acknowledged?reviewed():null},error:null};
   if(name==='faolla_member_checkout_intent_review_v1')return mode==='readFailure'?{data:null,error:{message:'unavailable'}}:{data:{version:1,siteId:x.siteId,review:registered?reviewed():null},error:null};
   if(name==='faolla_member_checkout_retained_intent_review_v1')return{data:{version:1,siteId:x.siteId,operationKey:op,proposal:mode==='absent'?null:{reviewHash:changed?'b'.repeat(64):hash,reviewRequired:mode==='manual',original}},error:null};
   if(name==='faolla_member_checkout_register_retained_intent_v1'){
    assert.equal(original.kind,'single');assert.equal(args.p_review_hash,hash);appends.push(args);
    if(mode==='lateIdentity')await new Promise(resolve=>{release=resolve;});registered=true;
    return{data:mode==='malformed'?{}:{version:1,siteId:x.siteId,replayed:false,review:reviewed()},error:null};
   }
   if(name==='faolla_member_checkout_acknowledge_intent_v1'){acks.push(args);assert.equal(registered,true);acknowledged=true;return{data:{version:1,siteId:x.siteId,operationKey:op,generation:1,acknowledged:true,replayed:false},error:null};}
   throw Error('Unexpected synthetic RPC '+name);
  };
  const request=new Request(req.url(),{method:'POST',headers:{...req.headers(),origin},body:JSON.stringify(body)}),deps={enabled:()=>enabled,intentEnabled:()=>true,session,call};
  const response=url.pathname.endsWith('cart/recover')?await cartHttp.handleCartCheckout('recover',request,deps):/intent\/(retained-review|register-retained)$/.test(url.pathname)?await retainedHttp.handleRetainedCheckoutIntent(register,request,deps):await intentHttp.handleCheckoutIntent(url.pathname.endsWith('pending')?'pending':url.pathname.endsWith('acknowledge')?'acknowledge':'review',request,deps);
  if(register&&mode==='lost'||url.pathname.endsWith('acknowledge')&&mode==='ackLost')return route.fulfill({status:503,json:{error:'checkout_intent_unconfirmed'}});
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.goto(origin);await page.addStyleTag({content:a.css+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}'});await page.addScriptTag({content:a.js});
 return{x,t,context,page,key,hostForm,hostCart,initial,calls,rpc,errors,unexpected,appends,acks,form:page.locator('[data-single-original-review]'),bytes:()=>page.evaluate(keys=>Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])),Object.keys(initial)),change:()=>{changed=true;},closeGate:()=>{enabled=false;},signOut:()=>{guest=true;},release:()=>release?.()};
}
test('standalone single recovery requires explicit registration then original acknowledgement without touching source form/cart',{timeout:90000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`single-retained-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const method of ['points','on_site'])for(const kind of ['single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${method}-${kind}-${width}-${locale}`,async()=>{
  const f=await fixture(browser,a,{method,kind,width,locale});try{const box=f.form.locator('[data-single-retained-registration]');await box.waitFor();assert.equal(await box.getByRole('button').isDisabled(),true);assert.equal(await f.form.getByRole('button',{name:f.t.another,exact:true}).count(),0);assert.deepEqual(await f.bytes(),f.initial);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await f.page.screenshot({path:path.join(evidence,`${method}-${kind}-${width}-${locale}.png`),fullPage:true});
   await box.getByRole('checkbox').check();await box.getByRole('button').evaluate(el=>{el.click();el.click();});await f.form.getByRole('button',{name:f.t.another,exact:true}).waitFor();assert.equal(f.appends.length,1);assert.equal(f.acks.length,0);assert.deepEqual(await f.bytes(),f.initial);
   await f.page.reload();await f.page.addStyleTag({content:a.css});await f.page.addScriptTag({content:a.js});await f.form.getByRole('button',{name:f.t.another,exact:true}).waitFor();assert.equal(await f.form.locator('[data-single-retained-registration]').count(),0);assert.deepEqual(await f.bytes(),f.initial);
   await f.form.getByRole('button',{name:f.t.another,exact:true}).click();await f.page.getByRole('button',{name:f.t.quote[method==='points'?0:1],exact:true}).waitFor();assert.equal(await f.page.evaluate(k=>localStorage.getItem(k),f.key),null);
   const bytes=await f.bytes();for(const k of [f.hostForm,f.hostCart])assert.equal(bytes[k],f.initial[k]);assert.equal(f.appends.length,1);assert.equal(f.acks.length,1);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }catch(error){await f.page.screenshot({path:path.join(evidence,`failure-${method}-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await f.context.close();}
 });}finally{console.log(`SINGLE_RETAINED_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
test('single recovery never releases an unowned cart or bypasses failed verification, another tab or changed identity',{timeout:90000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve('output',`single-retained-boundary-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const method of ['points','on_site'])for(const kind of ['cart_points','cart_on_site'])await t.test(`${method}-${kind}`,async()=>{
  const f=await fixture(browser,a,{method,kind});try{await f.form.getByRole('link',{name:f.t.shop,exact:true}).waitFor();assert.equal(await f.form.locator('[data-single-retained-registration]').count(),0);assert.equal(await f.form.getByRole('button',{name:f.t.another,exact:true}).count(),0);assert.deepEqual(await f.bytes(),f.initial);assert.equal(f.appends.length,0);assert.equal(f.acks.length,0);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);}finally{await f.context.close();}
 });
 for(const mode of ['closedUi','guest','readFailure','manual','absent','noNonce','changed','revoke','lock','lost','ackLost','malformed','lateIdentity','storage'])await t.test(mode,async()=>{
  const f=await fixture(browser,a,{method:'on_site',kind:'single_on_site',mode});try{
   if(mode==='guest'){await f.page.getByRole('link',{name:f.t.login,exact:true}).waitFor();assert.equal(f.rpc.length,0);}
   else if(['closedUi','readFailure','absent','noNonce'].includes(mode)){await f.page.getByRole('alert').waitFor();assert.equal(await f.form.count(),0);assert.equal(f.appends.length,0);}
   else if(mode==='manual'){await f.form.getByRole('alert').waitFor();assert.equal(await f.form.locator('[data-single-retained-registration]').count(),0);assert.equal(f.appends.length,0);}
   else{const box=f.form.locator('[data-single-retained-registration]');await box.waitFor();await box.getByRole('checkbox').check();
    if(mode==='changed')f.change();if(mode==='revoke')f.closeGate();
    if(mode==='lock'){await f.page.evaluate(key=>{window.__holding=false;void navigator.locks.request(key,async()=>{window.__holding=true;await new Promise(resolve=>{window.__unlock=resolve;});});},f.key);await f.page.waitForFunction(()=>window.__holding);}
    if(mode==='storage'){await f.page.evaluate(key=>{localStorage.setItem(key,JSON.stringify({version:1,nonce:'99999999-9999-4999-8999-999999999999'}));window.dispatchEvent(new StorageEvent('storage',{key}));},f.key);await f.page.getByRole('alert').waitFor();}
    else{await box.getByRole('button').click();
     if(mode==='lateIdentity'){const end=Date.now()+4000;while(!f.appends.length&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(f.appends.length,1);f.signOut();await f.page.evaluate(()=>window.__identity());f.release();await f.page.getByRole('link',{name:f.t.login,exact:true}).waitFor();}
     else if(mode==='ackLost'){await f.form.getByRole('button',{name:f.t.another,exact:true}).click();await f.page.getByRole('alert').waitFor();assert.deepEqual(await f.bytes(),f.initial);await f.page.getByRole('button',{name:f.t.read,exact:true}).click();await f.form.getByRole('button',{name:f.t.another,exact:true}).click();await f.page.waitForFunction(k=>localStorage.getItem(k)===null,f.key);assert.equal(f.acks.length,1);}
     else{await f.page.getByRole('alert').waitFor();if(mode==='lost'){await f.page.getByRole('button',{name:f.t.read,exact:true}).click();await f.form.getByRole('button',{name:f.t.another,exact:true}).waitFor();assert.equal(f.appends.length,1);}}
    }
    if(mode==='lock')await f.page.evaluate(()=>window.__unlock());
   }
   const bytes=await f.bytes();for(const k of [f.hostForm,f.hostCart])assert.equal(bytes[k],f.initial[k]);if(mode==='storage')assert.ok(bytes[f.key].includes('99999999-9999-4999-8999-999999999999'));else if(mode!=='ackLost')assert.deepEqual(bytes,f.initial);
   if(mode!=='ackLost')assert.equal(f.acks.length,0);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);await f.page.screenshot({path:path.join(evidence,`${mode}.png`),fullPage:true});
  }catch(error){f.release();await f.page.screenshot({path:path.join(evidence,`failure-${mode}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await f.context.close();}
 });}finally{console.log(`SINGLE_RETAINED_BOUNDARY_BROWSER_EVIDENCE=${evidence}`);await browser.close();}
});
