import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import cartFixtures from './fixtures/member-checkout-cart-review.ts';
import checkoutBoundary from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
import ordersRoute from '../src/app/api/orders/route-handler.ts';

// Real manager/list/service components; cart cancellation also calls the actual
// merchant PATCH/bridge with injected synthetic identity and RPC. ALL HTTP is
// intercepted. Not a live account, Next server or production authorization.
// Mobile orders use the same px-4 parent as AdminClient's business content;
// the component's -mx-4 sticky toolbar intentionally cancels that padding.
const origin='https://checkout-manager.invalid',site='10909095',owner='a'.repeat(64),stamp='2026-11-23T12:00:00Z';
const booking={id:'B-synthetic',siteId:site,siteName:'Synthetic',status:'active',createdAt:stamp,updatedAt:stamp,merchantTouchedAt:stamp,appointmentAt:'2030-01-01T12:00',appointmentTimeZone:'Europe/Madrid',store:'Main',item:'Play',title:'Mx',customerName:'Synthetic',email:'synthetic@example.invalid',phone:'123',note:'',customerAccountId:'50010105',customerUserId:'synthetic-user',customerEmailLogs:[],timeline:[]};
const order={id:'O-synthetic',siteId:site,siteName:'Synthetic',status:'pending',createdAt:stamp,updatedAt:stamp,merchantTouchedAt:stamp,customer:{name:'Synthetic',email:'synthetic@example.invalid',phone:'123',note:''},items:[{productId:'p',name:'Play',code:'P',description:'',imageUrl:'',tag:'',quantity:1,unitPrice:0,unitPriceText:'0',subtotal:0}],pricePrefix:'€',totalAmount:0,totalQuantity:1,customerAccountId:'50010105',customerUserId:'synthetic-user'};
const result=r=>({version:1,siteId:site,operationKey:'b'.repeat(64),resourceKind:r.kind,resourceId:r.id,totalPoints:100,couponCount:1,closed:false,resource:{status:r.kind==='booking'?'active':'pending',updatedAt:stamp},cancellationAvailable:false,cancellationPolicy:{returnPoints:true,returnCoupons:false,advanceMinutes:0,cancellableUntil:r.kind==='booking'?'2030-01-01T00:00:00Z':null},cancellation:null});
let assets;
async function compile(){return assets??=(async()=>{
 const script=(await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import BookingDesktop from './src/components/admin/MerchantBookingManagerDialog';import BookingMobile from './src/components/admin/MerchantBookingMobilePanel';
 import OrderDesktop from './src/components/admin/MerchantOrderManagerDialog';import OrderMobile from './src/components/admin/MerchantOrderMobilePanel';
 import ServiceOrders from './src/components/service-center/ServiceOrders';import{MerchantCheckoutManagerIntegration as Integration}from'./src/components/checkout/MerchantCheckoutManagerIntegration';
 const api=(p,i)=>fetch(p,i),common={siteId:'${site}',siteName:'Synthetic',open:true,mode:'inline',onClose:()=>{}};
 function App(){const[active,A]=useState(true),[employee,E]=useState(false),[revision,R]=useState('one'),[account,C]=useState('50010105');window.__active=A;window.__employee=E;window.__revision=R;window.__account=C;
 const props={...common,...(employee?{permissions:['bookings.view','orders.view'],apiClient:api}:{})};
 if(window.__target==='booking-desktop')return <BookingDesktop {...props}/>;if(window.__target==='booking-mobile')return <BookingMobile {...common}/>;
 if(window.__target==='order-desktop')return <OrderDesktop {...props}/>;if(window.__target==='order-mobile')return <div className="px-4"><OrderMobile {...common}/></div>;
 if(window.__target==='service')return <ServiceOrders active={active} siteId='${site}' siteName='Synthetic' identity={{authenticated:!!account,accountId:account,profile:{},memberships:[],favoriteSites:[]}} refreshIdentity={async()=>{}}/>;
 return <Integration active={active} employeeMode={employee} siteId='${site}' resources={Array.from({length:121},(_,i)=>({kind:'order',id:'O-G'+i}))} revision={revision} locale={window.__locale}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'unrelated-workbench-and-i18n',setup(b){
 b.onResolve({filter:/^@\/components\/admin\/(BookingWorkbenchDialog|OrderWorkbenchPanel)$/},args=>({path:args.path,namespace:'workbench'}));
 b.onLoad({filter:/.*/,namespace:'workbench'},()=>({contents:'export default function Workbench(){return null}',loader:'js'}));
 b.onResolve({filter:/^@\/components\/I18nProvider$/},args=>({path:args.path,namespace:'locale'}));b.onLoad({filter:/.*/,namespace:'locale'},()=>({contents:'export const useI18n=()=>({locale:window.__locale});',loader:'js'}));
 b.onResolve({filter:/^@\/lib\/performanceTelemetry$/},args=>({path:args.path,namespace:'perf'}));b.onLoad({filter:/.*/,namespace:'perf'},()=>({contents:'export const fetchWithAdminPerformance=(p,i)=>fetch(p,i);',loader:'js'}));
 }}]})).outputFiles[0].text;
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/service-center/ServiceOrders.tsx"; @source "./src/components/admin/MerchantBookingManagerDialog.tsx"; @source "./src/components/admin/MerchantBookingMobilePanel.tsx"; @source "./src/components/admin/MerchantOrderManagerDialog.tsx"; @source "./src/components/admin/MerchantOrderMobilePanel.tsx";',{from:path.resolve('checkout-manager-fixture.css')})).css;
 return{script,css};})();}
async function mount(browser,target,{width=1280,locale='zh-CN',enabled=true,cart=false}={}){
 const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],unexpected=[],reads=[];let mode='ok',release;
 const synthetic=cart?await cartFixtures.cartReviewFixture(width===390?'points':'on_site'):null;
 let cartOrder=synthetic?{...synthetic.prepared.plan.record,id:order.id,siteId:site}:null;
 let cartResult=synthetic?{...synthetic.result,siteId:site,resourceId:order.id,resource:{status:'pending',updatedAt:cartOrder.updatedAt}}:null;
 const writes=[],ownerActor={type:'owner',siteId:site,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner',authorizationSource:'database',businessPermissions:[],collaborationPermissions:[],displayName:'Synthetic',email:'owner@synthetic.invalid'};
 const boundaryDeps={enabled:()=>true,cartEnabled:()=>true,actor:async()=>ownerActor,cartSite:async()=>({...synthetic.f.site,id:site}),rpc:()=>async(name,args)=>{
  if(name==='faolla_checkout_cart_resource_link_v1')return{data:{siteId:site,kind:'order',id:order.id,operationKey:cartResult.operationKey,record:cartOrder,cart:cartResult,refundRequired:false},error:null};
  assert.equal(name,'faolla_checkout_cart_merchant_cancel_v1');assert.equal(args.p_actor_key,ownerActor.principalKey);assert.equal(Object.hasOwn(args,'p_principal_key'),false);writes.push(args);
  cartOrder={...cartOrder,status:'cancelled'};cartResult={...cartResult,closed:true,cancellationAvailable:false,resource:{...cartResult.resource,status:'cancelled'},cancellation:{pointsReturned:cartResult.totalPoints??0,couponsReturned:0,stockReleased:2,cancelledAt:stamp}};
  return{data:{replayed:false,result:cartResult},error:null};
 }};
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date(stamp));
 await context.route('**/*',async route=>{
  const q=route.request(),u=new URL(q.url());if(u.origin!==origin){unexpected.push(q.url());return route.abort();}
  if(q.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
  if(u.pathname==='/api/merchant-checkout/settlements'){
   reads.push({method:q.method(),body:q.postDataJSON()});
   if(q.method()==='GET')return route.fulfill({json:{ok:true,access:enabled?{siteId:site,identityKey:owner}:null}});
   assert.equal(q.method(),'POST');assert.equal(q.headers()['x-checkout-owner-scope'],owner);const scope=q.postDataJSON();assert.equal(scope.siteId,site);assert.ok(scope.resources.length<=50);
   if(mode==='hold')await new Promise(resolve=>{release=resolve;});
   return mode==='error'?route.fulfill({status:503,json:{error:'unavailable'}}):route.fulfill({json:{ok:true,snapshot:{version:cart?3:1,siteId:site,rows:scope.resources.map(r=>({...r,termsMatch:true,result:cart?null:result(r),...(cart?{cart:cartResult}:{})}))}}});
  }
  if(u.pathname==='/api/member-checkout/resource'){
   assert.equal(q.method(),'GET');assert.equal(q.headers()['x-checkout-account-scope'],'50010105');reads.push({method:'RESOURCE'});
   if(mode==='hold')await new Promise(resolve=>{release=resolve;});
   return mode==='error'?route.fulfill({status:503,json:{error:'unavailable'}}):route.fulfill({json:{ok:true,result:mode==='unlinked'?null:result({kind:u.searchParams.get('kind'),id:u.searchParams.get('id')})}});
  }
  if(u.pathname==='/api/orders'||u.pathname==='/api/bookings'){
   if(cart&&q.method()==='PATCH'){
    const body=q.postDataJSON();assert.equal(body.siteId,site);assert.equal(body.orderId,order.id);assert.equal(body.status,'cancelled');
    const response=await ordersRoute.handleMerchantOrderPatch(new Request(q.url(),{method:'PATCH',headers:{origin,'content-type':'application/json'},body:q.postData()}),{
     resolveAdminSession:async()=>({merchantId:site,actor:ownerActor,assertAuthorizationCurrent:async()=>{}}),isManagementEnabled:async()=>true,
     checkoutBridge:input=>checkoutBoundary.bridgeLegacyCheckoutMutation(input,boundaryDeps),updateOrder:async()=>{throw Error('cart cancellation must not reach raw legacy writer');}
    });return route.fulfill({status:response.status,json:await response.json()});
   }
   assert.equal(q.method(),'GET','this integration test cannot perform legacy business mutations');
   const personal=u.searchParams.get('scope')==='personal',hint=personal&&enabled?{checkoutEntries:{accountId:'50010105',siteIds:[site]}}:{};
   return route.fulfill({json:{ok:true,[u.pathname.endsWith('bookings')?'bookings':'orders']:u.pathname.endsWith('bookings')?[booking]:[cart?cartOrder:order],...(cart?{order:cartOrder}:{}),hasMore:false,offset:0,...hint}});
  }
  if(u.pathname==='/api/bookings/workbench')return route.fulfill({json:{ok:true,settings:{}}});
  if(u.pathname==='/api/merchant-admin/manager-preferences')return route.fulfill({json:{preferences:{booking:{selectedStatuses:['active','confirmed','completed','no_show','cancelled'],historyVisibility:'none',sortMode:'appointment_desc'},order:{selectedStatuses:['pending','confirmed','completed','cancelled'],historyVisibility:'none',sortMode:'created_desc'}},stored:{booking:true,order:true}}});
  unexpected.push(q.method()+' '+u.pathname);return route.abort();
 });
 const a=await compile();await page.goto(origin+'/');await page.evaluate(v=>{window.__target=v.target;window.__locale=v.locale;},{target,locale});await page.addStyleTag({content:a.css+'body{margin:0;font-family:Arial;background:#f3f6f9}'});await page.addScriptTag({content:a.script});
 return{page,context,reads,errors,unexpected,writes,setMode:v=>{mode=v;},release:()=>{assert.ok(release);release();},waitHeld:async()=>{for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);}};
}

test('actual desktop/mobile order cancel button reaches actual merchant PATCH cart bridge without a raw legacy write',{timeout:120000},async t=>{
 const evidence=path.resolve('output',`cart-owner-management-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-US','es-ES'])await t.test(`${width} ${locale}`,async()=>{
  const m=await mount(browser,width===390?'order-mobile':'order-desktop',{width,locale,cart:true});try{
   await m.page.getByText(order.id,{exact:false}).first().waitFor();await m.page.getByRole('button',{name:'取消',exact:true}).first().click();
   await m.page.getByRole('button',{name:'恢复待确认',exact:true}).first().waitFor();assert.equal(m.writes.length,1);
   const overflow=await m.page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,classes:e.className,text:e.textContent?.slice(0,70),right:e.getBoundingClientRect().right}))}));
   assert.ok(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));assert.deepEqual(m.errors,[]);assert.deepEqual(m.unexpected,[]);
   await m.page.screenshot({path:path.join(evidence,`cancelled-${width}-${locale}.png`),fullPage:true});
  }catch(error){await m.page.screenshot({path:path.join(evidence,`failure-${width}-${locale}.png`),fullPage:true});throw error;}finally{await m.context.close();}
 });console.log(`CART_OWNER_MANAGEMENT_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
test('actual four manager views discover the default-off owner gate and read only explicitly expanded current records',{timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true});try{
 for(const target of ['booking-desktop','booking-mobile','order-desktop','order-mobile'])for(const enabled of [false,true]){
  const m=await mount(browser,target,{width:target.endsWith('mobile')?390:1280,enabled});try{
   await m.page.getByText(target.startsWith('booking')?/Synthetic\s*Mx/:order.id,{exact:false}).first().waitFor();
   if(!enabled){await m.page.waitForResponse(()=>false,{timeout:100}).catch(()=>{});assert.equal(await m.page.locator('[data-checkout-manager]').count(),0);assert.equal(m.reads.filter(r=>r.method==='POST').length,0);}
   else{assert.equal(m.reads.filter(r=>r.method==='POST').length,0);await m.page.getByRole('button',{name:'核对结算状态',exact:true}).click();await m.page.locator('[data-settlement-state="points_redeemed"]').waitFor();const r=m.reads.find(r=>r.method==='POST');assert.deepEqual(r.body.resources,[{kind:target.startsWith('booking')?'booking':'order',id:target.startsWith('booking')?booking.id:order.id}]);
    await fs.mkdir('output',{recursive:true});await m.page.screenshot({path:`output/checkout-integrated-${target}.png`,fullPage:true});
    if(target.endsWith('desktop')){const before=m.reads.length;await m.page.evaluate(()=>window.__employee(true));await m.page.waitForFunction(()=>!document.querySelector('[data-checkout-manager]'));await m.page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(m.reads.length,before);}
   }
   assert.deepEqual(m.errors,[]);assert.deepEqual(m.unexpected,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await m.page.screenshot({path:`output/checkout-integrated-failure-${target}-${enabled}.png`,fullPage:true});throw new Error(`${target}/${enabled}: ${error.message}; browser=${JSON.stringify(m.errors)}; unexpected=${JSON.stringify(m.unexpected)}`,{cause:error});}finally{await m.context.close();}
 }
 }finally{await browser.close();}
});
test('grouped settlement UI covers every rendered key, isolates identities/errors and never dispatches financial writes',{timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1280])for(const locale of ['zh-CN','en-US','es-ES']){
  const m=await mount(browser,'groups',{width,locale}),button=locale.startsWith('zh')?'核对结算状态':locale.startsWith('es')?'Revisar pagos':'Review settlements',next=locale.startsWith('zh')?'下一组':locale.startsWith('es')?'Grupo siguiente':'Next group';try{
   await m.page.getByRole('button',{name:button,exact:true}).waitFor();assert.equal(m.reads.filter(r=>r.method==='POST').length,0);
   await m.page.getByRole('button',{name:button,exact:true}).click();await m.page.locator('[data-resource-id="O-G0"]').waitFor();assert.equal(await m.page.locator('[data-resource-id]').count(),50);
   await m.page.getByRole('button',{name:next,exact:true}).click();await m.page.locator('[data-resource-id="O-G50"]').waitFor();
   await m.page.getByRole('button',{name:next,exact:true}).click();await m.page.locator('[data-resource-id="O-G120"]').waitFor();assert.equal(await m.page.locator('[data-resource-id]').count(),21);
   m.setMode('error');await m.page.getByRole('button',{name:locale.startsWith('zh')?'重新读取':locale.startsWith('es')?'Volver a leer':'Reload',exact:true}).click();await m.page.getByRole('alert').waitFor();assert.equal(await m.page.locator('[data-resource-id]').count(),0);
   await m.page.evaluate(()=>window.__employee(true));await m.page.waitForFunction(()=>!document.querySelector('[data-checkout-manager]'));
   assert.ok(await m.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(m.errors,[]);assert.deepEqual(m.unexpected,[]);
  }finally{await m.context.close();}
 }}finally{await browser.close();}
});
test('actual customer service records open only their own original result, preserve policy links and hide late account responses',{timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1280])for(const locale of ['zh-CN','en-US','es-ES']){
  const m=await mount(browser,'service',{width,locale}),entry=m.page.locator('[data-checkout-record-entry]').first();try{
   await entry.getByRole('button').waitFor();assert.equal(m.reads.filter(r=>r.method==='RESOURCE').length,0);
   await entry.getByRole('button').click();await entry.locator('[data-settlement-state="points_redeemed"]').waitFor();assert.match(await entry.locator('a').getAttribute('href'),new RegExp('^/member-checkout/'+site+'/[a-f0-9]{64}\\?uiLocale='));
   await fs.mkdir('output',{recursive:true});await m.page.screenshot({path:`output/checkout-record-entry-${width}-${locale}.png`,fullPage:true});
   m.setMode('unlinked');await entry.getByRole('button').click();await entry.getByText(locale.startsWith('zh')?'未关联新结算账本，请查看原记录；不据此判断是否付款。':locale.startsWith('es')?'Sin vínculo al nuevo registro. Consulta el original; no se deduce si está pagado.':'No new-ledger link. Use the original record; no payment status is inferred.',{exact:true}).waitFor();assert.equal(await entry.locator('[data-settlement-state]').count(),0);
   m.setMode('error');await entry.getByRole('button').click();await entry.getByRole('status').waitFor();assert.equal(await entry.locator('a').count(),0);
   m.setMode('hold');await entry.getByRole('button').click();await m.waitHeld();await m.page.evaluate(()=>window.__account('50010106'));m.release();await m.page.waitForFunction(()=>!document.querySelector('[data-checkout-record-entry]'));
   assert.ok(await m.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(m.errors,[]);assert.deepEqual(m.unexpected,[]);
  }finally{await m.context.close();}
 }}finally{await browser.close();}
});
