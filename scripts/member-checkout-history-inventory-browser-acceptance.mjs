// Actual resume client/panel/inventory/controller -> actual HTTP + DTOs.
// Synthetic verified identity/private RPC only. Every network call intercepted.
import assert from 'node:assert/strict';import test from 'node:test';import path from 'node:path';import{mkdir}from'node:fs/promises';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import fixtures from'./fixtures/member-checkout-resume.ts';import inventoryHttp from'../src/lib/merchantCheckoutHistoryInventory.server.ts';import pendingHttp from'../src/lib/merchantCheckoutHistoryPending.server.ts';
const origin='https://inventory-browser.synthetic.invalid',html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>';
const words={zh:{read:'查阅／重读首页',next:'下一页'},en:{read:'Read / reload first page',next:'Next page'},es:{read:'Consultar / recargar primera página',next:'Página siguiente'}};let compiled;
async function assets(){return compiled??=Promise.all([build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';import Resume from'./src/app/member-checkout/[siteId]/resume/CheckoutResumeClient';createRoot(document.getElementById('root')).render(<Resume siteId={window.__site} readOnly/>);`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'context-only',setup(b){
 b.onResolve({filter:/^(?:@\/components\/I18nProvider|next\/link)$/},a=>({path:a.path,namespace:'context'}));b.onLoad({filter:/.*/,namespace:'context'},a=>({contents:a.path==='next/link'?"import React from'react';export default({prefetch,...props})=><a {...props}/>;":"export const useI18n=()=>({locale:window.__locale});",loader:'tsx',resolveDir:process.cwd()}));
 }}]}),postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/app/member-checkout";',{from:path.resolve('inventory-browser.css')})]).then(([js,css])=>({js:js.outputFiles[0].text,css:css.css}));}
const op=n=>n.toString(16).padStart(64,'0');
async function mount(browser,kind,width=390,locale='zh-CN'){
 const x=await fixtures.checkoutResumeFixture(kind),a=await assets(),context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(7000);
 const errors=[],unexpected=[],paths=[],privateCalls=[],entries={['host-form:'+x.siteId]:'KEEP host form/member/note',['host-cart:'+x.siteId]:'KEEP products/customer',['old-ordinary-request:'+x.siteId]:'KEEP original request'};let mode='ok',authenticated=true,pages=false,release,started;
 const row=n=>{const original=structuredClone(x.original),r=original.kind==='cart'?original.result:original.original.result;r.operationKey=op(n);return{operationKey:op(n),original,reviewRequired:false};};
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.href);return route.abort();}if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});paths.push(url.pathname);
  const session=()=>authenticated?{accountId:x.accountId,userId:x.userId,servicePaused:false,user:{email_confirmed_at:'2026-11-24T12:00:00Z'}}:null;
  if(url.pathname==='/api/personal-favorites')return route.fulfill({json:{authenticated,accountId:authenticated?x.accountId:''}});
  const req=new Request(url.href,{method:request.method(),headers:{...request.headers(),origin},body:request.postData()});let response;
  if(url.pathname==='/api/member-checkout/history/pending')response=await pendingHttp.handleCheckoutHistoryPending(req,{enabled:()=>true,session:async()=>session(),call:async()=>({data:null,error:{message:'checkout_intent_review_required'}})});
  else if(url.pathname==='/api/member-checkout/history/retained')response=await inventoryHttp.handleCheckoutHistoryInventory(req,{enabled:()=>mode!=='closed',session:async()=>session(),call:async(name,args)=>{
   assert.equal(name,'faolla_member_checkout_history_inventory_v1');assert.equal(args.p_site_id,x.siteId);assert.equal(args.p_principal_key,`account:${x.accountId}:${x.userId}`);privateCalls.push(args);started?.();
   if(mode==='late')await new Promise(r=>{release=r;});if(mode==='fail')throw Error('PRIVATE');
   const items=mode==='empty'?[]:pages?args.p_after?[row(11)]:Array.from({length:10},(_,i)=>row(i+1)):[row(1)];
   if(mode==='manual'){items[0].reviewRequired=true;if(items[0].original.kind==='cart'){items[0].original.result.reviewRequired=true;items[0].original.result.cancellationAvailable=false;}}
   return{data:mode==='malformed'?{}:{version:1,siteId:x.siteId,after:args.p_after,items,nextCursor:pages&&!args.p_after?op(10):null},error:null};
  }});else{unexpected.push(url.pathname);return route.abort();}
  const body=await response.json();return route.fulfill({status:response.status,json:body}).catch(()=>{});
 });
 await page.goto(origin+`/member-checkout/${x.siteId}/resume?uiLocale=${locale}`);await page.evaluate(v=>{Object.assign(window,v.values);for(const[k,s]of Object.entries(v.entries))localStorage.setItem(k,s);},{values:{__site:x.siteId,__locale:locale},entries});
 await page.addStyleTag({content:a.css+'body{margin:0;font-family:Arial,sans-serif;background:#f8fafc}'});await page.addScriptTag({content:a.js});
 if(authenticated)await page.locator('[data-checkout-history-inventory]').waitFor();
 const section=page.locator('[data-checkout-history-inventory]'),text=words[locale.slice(0,2)];
 return{x,context,page,section,text,errors,unexpected,paths,privateCalls,mode:v=>{mode=v;},pages:()=>{pages=true;},guest:()=>{authenticated=false;},hold:()=>{mode='late';return new Promise(r=>{started=r;});},release:()=>release?.(),
  async read(){await section.getByRole('button',{name:text.read,exact:true}).click();},async preserved(){assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage))),entries);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(paths.some(p=>/\/(submit|cancel|acknowledge|register-retained|preview)$/.test(p)),false);}};
}
test('missing nonce and rejected pending read still permit explicit own read-only originals, four kinds/two sizes/three languages',{timeout:120000},async t=>{
 const browser=await chromium.launch({headless:true}),evidence=path.resolve(`output/history-inventory-browser-${Date.now()}`);await mkdir(evidence,{recursive:true});
 try{for(const kind of ['cart_points','cart_on_site','single_points','single_on_site'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${kind} ${width} ${locale}`,async()=>{
  const s=await mount(browser,kind,width,locale);try{assert.equal(s.privateCalls.length,0);await s.read();await s.section.locator('[data-history-original]').waitFor();assert.equal(s.privateCalls.length,1);
   assert.equal(await s.section.locator('a,input,textarea,select').count(),0);assert.equal(await s.section.getByRole('button').count(),1);assert.equal(await s.section.locator('[data-history-original]').count(),1);
   assert.equal(await s.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await s.preserved();
   if((kind==='cart_on_site'&&width===390&&locale==='es-ES')||(kind==='single_points'&&width===1280&&locale==='zh-CN'))await s.page.screenshot({path:path.join(evidence,`${kind}-${width}-${locale}.png`),fullPage:true});
  }catch(error){await s.page.screenshot({path:path.join(evidence,`failed-${kind}-${width}-${locale}.png`),fullPage:true}).catch(()=>{});throw error;}finally{await s.context.close();}
 });console.log(`HISTORY_INVENTORY_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
test('inventory paging/empty/closed/manual/failed/late identity are read-only and preserve host state',{timeout:90000},async t=>{
 const browser=await chromium.launch({headless:true});try{for(const mode of ['pages','empty','closed','manual','fail','malformed','identity','late'])await t.test(mode,async()=>{
  const s=await mount(browser,'cart_on_site');try{if(mode==='pages'){s.pages();await s.read();await s.section.locator('[data-history-original]').first().waitFor();assert.equal(await s.section.locator('[data-history-original]').count(),10);
    await s.section.getByRole('button',{name:s.text.next,exact:true}).click();await s.section.locator('[data-history-original]').waitFor();assert.equal(await s.section.locator('[data-history-original]').count(),1);assert.equal(s.privateCalls[1].p_after,op(10));assert.equal(await s.section.getByRole('button').count(),1);
   }else if(mode==='identity'||mode==='late'){let began;if(mode==='late')began=s.hold();await s.read();if(began)await began;else await s.section.locator('[data-history-original]').waitFor();s.guest();await s.page.evaluate(()=>window.dispatchEvent(new Event('faolla:service-identity-changed')));if(mode==='late')s.release();await s.page.getByText('请先登录本人账号查看结算原单。',{exact:true}).waitFor();assert.equal(await s.page.locator('[data-history-original]').count(),0);
   }else{s.mode(mode);await s.read();if(mode==='manual'){await s.section.locator('[data-history-original]').waitFor();assert.equal(await s.section.locator('[data-cart-summary]').count(),0);}else if(mode==='empty'){await s.section.getByRole('status').waitFor();assert.equal(await s.section.locator('[data-history-original]').count(),0);}else{await s.section.getByRole('alert').waitFor();assert.equal(await s.section.locator('[data-history-original]').count(),0);}}
   await s.preserved();
  }finally{s.release();await s.context.close();}
 });}finally{await browser.close();}
});
