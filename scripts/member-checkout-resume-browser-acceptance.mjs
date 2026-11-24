// Actual source entry, resume client/controller, HTTP handler and safe DTO
// parser. Only identity and private RPC are synthetic; all network intercepted.
import assert from 'node:assert/strict';import test from 'node:test';
import {mkdir} from 'node:fs/promises';import path from 'node:path';
import {build} from 'esbuild';import postcss from 'postcss';import tailwind from '@tailwindcss/postcss';import {chromium} from 'playwright';
import fixture from './fixtures/member-checkout-resume.ts';
import localFixture from './fixtures/member-checkout-history-recovery.ts';
import intentHttp from '../src/lib/merchantCheckoutIntentHttp.server.ts';
import historyHttp from '../src/lib/merchantCheckoutHistoryPending.server.ts';
import recoveryHttp from '../src/lib/merchantCheckoutHistoryRecovery.server.ts';
import entryHttp from '../src/app/api/member-checkout/entry/route-handler.ts';
const origin='https://original-read.synthetic.invalid',html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>';
const words={zh:{entry:'查看我的结算原单',title:'我的结算原单',read:'重新读取原单',detail:'查看原单详情与取消规则',empty:'当前没有待核对的已登记原单。',failed:'暂时无法核对本人原单，请重新读取，不要重复提交。',login:'用户登录'},
 en:{entry:'View my original checkout',title:'My original checkout',read:'Read original again',detail:'Original details & cancellation policy',empty:'No registered original is awaiting review.',failed:'Your original could not be checked. Read it again; do not resubmit.',login:'Sign in'},
 es:{entry:'Consultar mi original',title:'Mi pago original',read:'Consultar original de nuevo',detail:'Detalles y política de cancelación',empty:'No hay originales registrados pendientes de revisión.',failed:'No se pudo consultar tu original. Consulta de nuevo; no lo reenvíes.',login:'Iniciar sesión'}};
let cached;async function assets(){return cached??=Promise.all([
 build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';
 import Entry from'./src/components/checkout/MemberCheckoutSourceEntry';import Resume from'./src/app/member-checkout/[siteId]/resume/CheckoutResumeClient';
 const root=createRoot(document.getElementById('root'));window.__render=()=>root.render(window.__mode==='source'?<Entry active siteId={window.__site} kind={window.__kind} blockId="b1" viewport={window.__width===390?'mobile':'desktop'} locale={window.__locale}/>:<Resume siteId={window.__site} readOnly={window.__history}/>);window.__render();`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'only-context',setup(b){
  b.onResolve({filter:/^(?:@\/components\/I18nProvider|next\/link)$/},a=>({path:a.path,namespace:'context'}));
  b.onLoad({filter:/.*/,namespace:'context'},a=>({contents:a.path==='next/link'?"import React from'react';export default({prefetch,...props})=><a {...props}/>;":"export const useI18n=()=>({locale:window.__locale});",loader:'tsx',resolveDir:process.cwd()}));
 }}]}),postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/app/member-checkout";',{from:path.resolve('resume-browser.css')})
 ]).then(([js,css])=>({js:js.outputFiles[0].text,css:css.css}));}
async function mount(page,a,x,{mode='resume',width=390,locale='zh-CN',kind='booking',history=false}={}){
 await page.evaluate(values=>Object.assign(window,values),{__site:x.siteId,__locale:locale,__width:width,__kind:kind,__mode:mode,__history:history});
 await page.addStyleTag({content:a.css+'body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}'});await page.addScriptTag({content:a.js});
}
function setup(context,x,history=false){let response={ok:true,snapshot:x.snapshot},authenticated=true,publicSource=false,reads=0,release,started,localReads=0,localMode=x.recovery?'confirmed':'unknown',localRelease,localStarted;const paths=[],errors=[],unexpected=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin){unexpected.push(url.href);return route.abort();}
  if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
  paths.push(`${req.method()} ${url.pathname}`);
  if(url.pathname==='/api/member-checkout/entry'){const query=req.postDataJSON();assert.deepEqual(query,{siteId:x.siteId,kind:query.kind,blockId:'b1',viewport:query.viewport});assert.ok(['booking','order'].includes(query.kind));assert.ok(['mobile','desktop'].includes(query.viewport));
   if(publicSource){const reply=await entryHttp.handleCheckoutEntry(new Request(url.href,{method:'POST',headers:{...req.headers(),origin},body:req.postData()}),{enabled:()=>!history,recoveryEnabled:()=>!history,historyEnabled:()=>history,session:async()=>{if(history)assert.fail('history navigation has no identity IO');return null;},read:async()=>{throw Error('public navigation must not read catalog');}});const value=await reply.json();assert.deepEqual(value,{ok:true,entry:null,recovery:{siteId:x.siteId}});return route.fulfill({status:reply.status,json:value});}
   return route.fulfill({json:{ok:true,entry:{query,siteId:x.siteId,accountId:x.accountId,offers:[],recoveryEnabled:true}}});}
  if(url.pathname==='/api/personal-favorites'){assert.equal(req.method(),'GET');return route.fulfill({json:{authenticated,accountId:authenticated?x.accountId:''}});}
  if(history&&url.pathname==='/api/member-checkout/history/recover'){
   localReads++;
   assert.equal(req.method(),'POST');const raw=req.postDataJSON();assert.deepEqual(Object.keys(raw).sort(),['nonce','siteId']);assert.equal(raw.siteId,x.siteId);
   const reply=await recoveryHttp.handleCheckoutHistoryRecovery(new Request(url.href,{method:'POST',headers:{...req.headers(),origin},body:req.postData()}),{
    enabled:()=>true,session:async()=>authenticated?{accountId:x.accountId,userId:x.userId,servicePaused:false,user:{email_confirmed_at:'2026-11-24T00:00:00Z'}}:null,
    call:async(name,args)=>{assert.equal(name,'faolla_member_checkout_history_original_v1');assert.equal(args.p_principal_key,`account:${x.accountId}:${x.userId}`);
     if(localMode==='error')throw Error('PRIVATE');if(x.recovery)assert.equal(args.p_operation_key,x.identity.operationKey);
     return{data:localMode==='confirmed'?x.recovery:localMode==='review'?{...x.recovery,reviewRequired:true}:{version:1,siteId:x.siteId,operationKey:args.p_operation_key,original:null,reviewRequired:null},error:null};}
   });const payload=await reply.json();localStarted?.();if(localRelease===null)await new Promise(resolve=>{localRelease=resolve;});
   return route.fulfill({status:reply.status,json:payload}).catch(()=>{});
  }
  if(url.pathname===(history?'/api/member-checkout/history/pending':'/api/member-checkout/intent/pending')){
   assert.equal(req.method(),'POST');assert.deepEqual(req.postDataJSON(),{siteId:x.siteId});assert.equal(req.headers()['x-checkout-account-scope'],x.accountId);reads++;
   const request=new Request(url.href,{method:'POST',headers:{...req.headers(),origin},body:req.postData()}),deps={
    enabled:()=>true,session:async()=>authenticated?{accountId:x.accountId,userId:x.userId,servicePaused:false,user:{email_confirmed_at:'2026-11-23T12:00:00Z'}}:null,
    call:async(name,args)=>{assert.equal(name,'faolla_member_checkout_pending_intent_v1');assert.deepEqual(args,{p_site_id:x.siteId,p_principal_key:`account:${x.accountId}:${x.userId}`});return{data:response.snapshot,error:null};}
   };const server=history?await historyHttp.handleCheckoutHistoryPending(request,deps):await intentHttp.handleCheckoutIntent('pending',request,deps);
   const payload=await server.json();started?.();if(release===null)await new Promise(resolve=>{release=resolve;});
   return route.fulfill({status:response.ok===false?503:server.status,json:response.ok===false?{error:'checkout_intent_unavailable'}:payload}).catch(()=>{});
  }
  unexpected.push(`${req.method()} ${url.pathname}`);return route.abort();
 });
 return{paths,errors,unexpected,count:()=>reads,localCount:()=>localReads,localMode:v=>{localMode=v;},response:v=>{response=v;},publicSource:()=>{publicSource=true;},guest:()=>{authenticated=false;},hold:()=>{release=null;return new Promise(resolve=>{started=resolve;});},holdLocal:()=>{localRelease=null;return new Promise(resolve=>{localStarted=resolve;});},release:()=>{const run=release;release=undefined;started=undefined;run?.();const localRun=localRelease;localRelease=undefined;localStarted=undefined;localRun?.();}};
}
test('universal read-only original page covers four types, two sizes and three languages without changing nonce/cart or sending finance',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve(`output/checkout-resume-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${kind} ${width} ${locale}`,async()=>{
  const x=await fixture.checkoutResumeFixture(kind),context=await browser.newContext({viewport:{width,height:1000}}),state=setup(context,x),page=await context.newPage(),text=words[locale.slice(0,2)];page.setDefaultTimeout(10000);
  try{await page.goto(origin+`/member-checkout/${x.siteId}/resume?uiLocale=${locale}`);const entries={['faolla-member-checkout-v2:'+x.siteId+':'+x.accountId]:JSON.stringify({version:1,nonce:'33333333-3333-4333-8333-333333333333'}),['merchant-space:product-cart:v2:'+x.siteId+':b1:'+x.accountId]:JSON.stringify({syntheticOriginalCart:'Kept member and products'})};
   await page.evaluate(entries=>{for(const[k,v]of Object.entries(entries))localStorage.setItem(k,v);},entries);await mount(page,a,x,{width,locale});await page.getByRole('link',{name:text.detail,exact:true}).waitFor();
   assert.equal(await page.getByRole('heading',{name:text.title,exact:true}).count(),1);const link=await page.getByRole('link',{name:text.detail,exact:true}).getAttribute('href');assert.ok(link.startsWith(`/member-checkout/${x.siteId}/${kind.startsWith('cart')?'cart/':kind.endsWith('on_site')?'on-site/':''}${x.snapshot.pending.operationKey}?`));
   assert.equal(await page.locator('input,textarea,select').count(),0);assert.equal(await page.getByRole('button').count(),1);await page.getByRole('button',{name:text.read,exact:true}).click();await page.getByRole('link',{name:text.detail,exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);assert.equal(state.count(),2);assert.ok(state.paths.every(p=>p==='GET /api/personal-favorites'||p==='POST /api/member-checkout/intent/pending'));assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(kind==='cart_on_site'||kind==='single_points')await page.screenshot({path:path.join(evidence,`${kind}-${width}-${locale}.png`),fullPage:true});
  }catch(error){await page.screenshot({path:path.join(evidence,`failed-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
 });
 console.log(`CHECKOUT_RESUME_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});
test('empty/malformed/late identity replies never imply failed submission or expose stale originals; guests never query the ledger',{timeout:45000},async()=>{
 const a=await assets(),x=await fixture.checkoutResumeFixture(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:900}}),state=setup(context,x),page=await context.newPage();page.setDefaultTimeout(10000);
 try{await page.goto(origin);await mount(page,a,x);await page.getByRole('link',{name:words.zh.detail}).waitFor();state.response({ok:true,snapshot:{version:1,siteId:x.siteId,pending:null}});await page.getByRole('button',{name:words.zh.read}).click();await page.getByText(words.zh.empty,{exact:true}).waitFor();
  assert.ok((await page.locator('[data-checkout-resume] header').innerText()).includes('不代表'));assert.equal(await page.getByRole('link',{name:words.zh.detail}).count(),0);
  state.response({ok:true,snapshot:{version:1,siteId:'00000000',pending:null}});await page.getByRole('button',{name:words.zh.read}).click();await page.getByText(words.zh.failed,{exact:true}).waitFor();
  state.response({ok:true,snapshot:{...x.snapshot,pending:{...x.snapshot.pending,reviewRequired:true}}});await page.getByRole('button',{name:words.zh.read}).click();await page.getByText('原单需要人工核对，不能据此认定已付款或再次扣减。',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-checkout-resume] article').getByRole('button').count(),0);assert.equal(await page.locator('[data-checkout-resume] article').getByRole('link').count(),1);assert.ok(!(await page.locator('[data-checkout-resume] article').innerText()).includes('积分已兑换'));
  state.response({ok:true,snapshot:x.snapshot});const began=state.hold();await page.getByRole('button',{name:words.zh.read}).click();await began;state.guest();await page.evaluate(()=>window.dispatchEvent(new Event('faolla:service-identity-changed')));await page.getByRole('link',{name:words.zh.login,exact:true}).waitFor();state.release();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.locator('[data-checkout-resume]').count(),0);assert.equal(state.count(),5);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
 }finally{state.release();await context.close();await browser.close();}
});
test('both source kinds offer recovery without any selected/current offer and open the verified page without changing the source',{timeout:45000},async()=>{
 const a=await assets(),x=await fixture.checkoutResumeFixture(),browser=await chromium.launch({headless:true});
 try{for(const kind of ['booking','order'])for(const width of [390,1280]){const context=await browser.newContext({viewport:{width,height:900}}),state=setup(context,x),page=await context.newPage();
  try{state.publicSource();await page.goto(origin);await mount(page,a,x,{mode:'source',kind,width});const link=page.getByRole('link',{name:words.zh.entry,exact:true});await link.waitFor();assert.equal(await page.locator('input,select').count(),0);assert.equal(state.count(),0);
   assert.equal(await link.getAttribute('href'),`/member-checkout/${x.siteId}/resume?uiLocale=zh-CN`);const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');await mount(popup,a,x,{width});await popup.getByRole('link',{name:words.zh.detail,exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/');assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);
  }finally{await context.close();}}
 }finally{await browser.close();}
});

test('closed purchasing retains read-only originals for four types, both sizes and three languages without dead finance links or storage changes',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve(`output/checkout-history-resume-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${kind} ${width} ${locale}`,async()=>{
  const x=await fixture.checkoutResumeFixture(kind),context=await browser.newContext({viewport:{width,height:1000}}),state=setup(context,x,true),page=await context.newPage(),text=words[locale.slice(0,2)];page.setDefaultTimeout(10000);
  try{await page.goto(origin);const entries={['faolla-member-checkout-v2:'+x.siteId+':'+x.accountId]:JSON.stringify({version:1,nonce:'33333333-3333-4333-8333-333333333333'}),
    ['merchant-space:product-cart:v2:'+x.siteId+':b1:'+x.accountId]:JSON.stringify({member:'synthetic-original',items:['kept'],note:'unchanged'}),'synthetic-unowned-shared-draft':JSON.stringify({mustNotAdopt:true})};
   await page.evaluate(entries=>{for(const[k,v]of Object.entries(entries))localStorage.setItem(k,v);},entries);await mount(page,a,x,{width,locale,history:true});
   await page.locator('[data-checkout-resume] article').waitFor();await page.locator('[data-checkout-history-read]').waitFor();
   assert.equal(await page.locator('[data-checkout-resume] article a').count(),0);assert.equal(await page.getByRole('link',{name:text.detail,exact:true}).count(),0);
   if(kind==='single_on_site')assert.equal(await page.locator('[data-checkout-resume] article details').count(),1);
   assert.equal(await page.locator('input,textarea,select').count(),0);assert.equal(await page.locator('[data-checkout-resume] button').count(),2);
   await page.getByRole('button',{name:text.read,exact:true}).click();await page.locator('[data-checkout-resume] article').waitFor();
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);assert.equal(state.count(),2);
   assert.ok(state.paths.every(p=>p==='GET /api/personal-favorites'||p==='POST /api/member-checkout/history/pending'||p==='POST /api/member-checkout/history/recover'));
   assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   if(kind==='cart_on_site'&&locale==='es-ES'||kind==='single_points'&&locale==='zh-CN')await page.screenshot({path:path.join(evidence,`${kind}-${width}-${locale}.png`),fullPage:true});
  }catch(error){await page.screenshot({path:path.join(evidence,`failed-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
 });console.log(`CHECKOUT_HISTORY_RESUME_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});

test('closed-purchase source navigation still works, but no original is a failure proof and changed identities never see late results',{timeout:60000},async()=>{
 const a=await assets(),x=await fixture.checkoutResumeFixture(),browser=await chromium.launch({headless:true});
 try{
  for(const kind of ['booking','order'])for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:1000}}),state=setup(context,x,true),page=await context.newPage();page.setDefaultTimeout(10000);
   try{state.publicSource();await page.goto(origin);await mount(page,a,x,{mode:'source',kind,width,history:true});const link=page.getByRole('link',{name:words.zh.entry,exact:true});await link.waitFor();
    assert.equal(state.count(),0);assert.equal(await page.locator('input,select').count(),0);const promise=page.waitForEvent('popup');await link.click();const popup=await promise;
    await popup.waitForLoadState('domcontentloaded');await mount(popup,a,x,{width,history:true});await popup.locator('[data-checkout-resume] article').waitFor();
    assert.equal(new URL(page.url()).pathname,'/');assert.equal(await popup.locator('[data-checkout-resume] article a').count(),0);assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);
   }finally{await context.close();}
  }
  const context=await browser.newContext({viewport:{width:390,height:1000}}),state=setup(context,x,true),page=await context.newPage();page.setDefaultTimeout(10000);
  try{await page.goto(origin);await mount(page,a,x,{history:true});await page.locator('[data-checkout-resume] article').waitFor();
   state.response({ok:false});await page.getByRole('button',{name:words.zh.read}).click();await page.getByText(words.zh.failed,{exact:true}).waitFor();assert.equal(await page.locator('[data-checkout-resume] article').count(),0);
   state.response({ok:true,snapshot:{version:1,siteId:x.siteId,pending:null}});await page.getByRole('button',{name:words.zh.read}).click();await page.getByText(words.zh.empty,{exact:true}).waitFor();
   assert.ok((await page.locator('[data-checkout-resume] header').innerText()).includes('不代表'));assert.equal(await page.locator('[data-checkout-resume] article').count(),0);
   state.response({ok:true,snapshot:{...x.snapshot,pending:{...x.snapshot.pending,reviewRequired:true}}});await page.getByRole('button',{name:words.zh.read}).click();await page.getByRole('alert').waitFor();
   assert.equal(await page.locator('[data-cart-summary]').count(),0);assert.equal(await page.locator('[data-checkout-resume] article a, [data-checkout-resume] article button').count(),0);
   state.response({ok:true,snapshot:x.snapshot});const began=state.hold();await page.getByRole('button',{name:words.zh.read}).click();await began;state.guest();await page.evaluate(()=>window.dispatchEvent(new Event('faolla:service-identity-changed')));
   await page.getByRole('link',{name:words.zh.login,exact:true}).waitFor();state.release();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await page.locator('[data-checkout-resume]').count(),0);assert.equal(state.count(),5);assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);
  }finally{state.release();await context.close();}
 }finally{await browser.close();}
});

const localWords={zh:{read:'核对本设备原编号',unknown:'原结果尚未确认，原编号已保留。',failed:'暂时无法核对或原编号已变化。',changed:'账号或本设备原编号已变化'},en:{read:'Check this device’s reference',unknown:'The outcome is unconfirmed;',failed:'The reference could not be checked or has changed.',changed:'Account or device reference changed.'},es:{read:'Consultar referencia del dispositivo',unknown:'El resultado sigue sin confirmar;',failed:'No se pudo consultar o cambió la referencia.',changed:'Cambió la cuenta o la referencia.'}};
async function seedLocal(page,x){const entries={['faolla-member-checkout-v2:'+x.siteId+':'+x.accountId]:JSON.stringify({version:1,nonce:x.nonce}),
 ['merchant-space:product-cart:v2:'+x.siteId+':b1:'+x.accountId]:JSON.stringify({member:'kept-synthetic',products:['kept'],note:'original-note'}),'unowned-legacy-draft':JSON.stringify({doNotAdopt:true})};
 await page.evaluate(v=>{for(const[k,s]of Object.entries(v))localStorage.setItem(k,s);},entries);return entries;
}
async function waitLocal(page,x){const section=page.locator('[data-checkout-local-recovery]');
 if(x.recovery.original.kind==='cart')await section.locator('[data-cart-summary]').waitFor();else if(x.recovery.original.original.method==='on_site')await section.locator('[data-on-site-summary]').waitFor();
 else await section.getByText(x.recovery.original.original.result.resourceId,{exact:true}).waitFor();return section;
}
test('retained local nonce restores four original types independently from the latest pending original, in two sizes and three languages',{timeout:120000},async t=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),evidence=path.resolve(`output/checkout-local-recovery-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${kind} ${width} ${locale}`,async()=>{
  const x=await localFixture.historyRecoveryFixture(kind),context=await browser.newContext({viewport:{width,height:1000}}),state=setup(context,x,true),page=await context.newPage();page.setDefaultTimeout(10000);
  try{await page.goto(origin);const entries=await seedLocal(page,x);await mount(page,a,x,{width,locale,history:true});const section=await waitLocal(page,x);await page.locator('[data-checkout-resume]>article').waitFor();
   assert.notEqual(x.recovery.operationKey,x.snapshot.pending.operationKey);assert.equal(await section.locator('a,input,textarea,select').count(),0);assert.equal(await section.getByRole('button').count(),1);
   await section.getByRole('button',{name:localWords[locale.slice(0,2)].read,exact:true}).click();await waitLocal(page,x);assert.equal(state.localCount(),2);assert.equal(state.count(),1);
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);assert.ok(state.paths.every(p=>p==='GET /api/personal-favorites'||/^POST \/api\/member-checkout\/history\/(pending|recover)$/.test(p)));
   assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   if(locale==='es-ES'&&kind==='cart_on_site')await page.screenshot({path:path.join(evidence,`${kind}-${width}-${locale}.png`),fullPage:true});
  }catch(error){await page.screenshot({path:path.join(evidence,`failed-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await context.close();}
 });console.log(`CHECKOUT_LOCAL_RECOVERY_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});

test('unknown/errors/acknowledged originals never erase the local reference, adopt shared drafts or replace it with a newer pending result',{timeout:60000},async()=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),x=await localFixture.historyRecoveryFixture('cart_on_site');
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000}}),state=setup(context,x,true),page=await context.newPage();page.setDefaultTimeout(10000);
  try{await page.goto(origin);const entries=await seedLocal(page,x);state.localMode('unknown');await mount(page,a,x,{width,history:true});const section=page.locator('[data-checkout-local-recovery]');
   await section.getByText(localWords.zh.unknown,{exact:false}).waitFor();await page.locator('[data-checkout-resume]>article').waitFor();assert.equal(await section.locator('[data-cart-summary]').count(),0);
   state.localMode('error');await section.getByRole('button',{name:localWords.zh.read,exact:true}).click();await section.getByText(localWords.zh.failed,{exact:false}).waitFor();assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);
   state.localMode('confirmed');state.response({ok:true,snapshot:{version:1,siteId:x.siteId,pending:null}});await section.getByRole('button',{name:localWords.zh.read,exact:true}).click();await waitLocal(page,x);
   await page.getByRole('button',{name:words.zh.read,exact:true}).click();await page.getByText(words.zh.empty,{exact:true}).waitFor();assert.equal(await section.locator('[data-cart-summary]').count(),1);
   state.localMode('review');await section.getByRole('button',{name:localWords.zh.read,exact:true}).click();await section.getByText('已找到原单，但原记录需人工核对。',{exact:false}).waitFor();assert.equal(await section.locator('[data-cart-summary]').count(),0);
   assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);
   await page.evaluate(key=>{localStorage.setItem(key,JSON.stringify({version:1,nonce:'44444444-4444-4444-8444-444444444444'}));window.dispatchEvent(new StorageEvent('storage',{key}));},'faolla-member-checkout-v2:'+x.siteId+':'+x.accountId);
   await section.getByText(localWords.zh.changed,{exact:false}).waitFor();assert.equal(await section.locator('[data-cart-summary],button').count(),0);assert.equal(state.localCount(),4);assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);
  }finally{await context.close();}
 }
 // A legacy/unowned cart alone cannot supply a financial nonce.
 const context=await browser.newContext(),state=setup(context,x,true),page=await context.newPage();try{
  await page.goto(origin);await page.evaluate(()=>localStorage.setItem('unowned-legacy-draft',JSON.stringify({nonce:'33333333-3333-4333-8333-333333333333'})));
  await mount(page,a,x,{history:true});await page.locator('[data-checkout-resume]>article').waitFor();assert.equal(await page.locator('[data-checkout-local-recovery]').count(),0);assert.equal(state.localCount(),0);assert.deepEqual(state.unexpected,[]);
 }finally{await context.close();}
 }finally{await browser.close();}
});

test('identity loss while a nonce read is held cannot reveal the late original or retry it under guest identity',{timeout:45000},async()=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),x=await localFixture.historyRecoveryFixture(),context=await browser.newContext({viewport:{width:390,height:1000}}),state=setup(context,x,true),page=await context.newPage();page.setDefaultTimeout(10000);
 try{await page.goto(origin);const entries=await seedLocal(page,x),began=state.holdLocal();await mount(page,a,x,{history:true});await began;
  state.guest();await page.evaluate(()=>window.dispatchEvent(new Event('faolla:service-identity-changed')));await page.getByRole('link',{name:words.zh.login,exact:true}).waitFor();state.release();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.locator('[data-checkout-local-recovery],[data-checkout-resume]').count(),0);
  assert.equal(state.localCount(),1);assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);
 }finally{state.release();await context.close();await browser.close();}
});
