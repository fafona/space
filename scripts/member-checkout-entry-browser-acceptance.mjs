import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual BlockRenderer -> BookingBlock / unchanged ProductBlock + gateway ->
// actual CheckoutStartClient/controller. All HTTP is synthetic interception;
// this is not a live Next.js/database/provider acceptance claim.
let cached;
async function assets(){return cached??=Promise.all([
 build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';import{createRoot}from'react-dom/client';
 import Renderer from'./src/components/blocks/BlockRenderer';import Entry from'./src/components/checkout/MemberCheckoutSourceEntry';
 import Start from'./src/app/member-checkout/[siteId]/start/CheckoutStartClient';
 const root=createRoot(document.getElementById('root'));let props={active:true,siteId:'10909095',kind:window.__kind,blockId:'b1',viewport:window.__viewport};
 const booking={id:'b1',type:'booking',props:{bookingStoreOptions:['Store'],bookingItemOptions:['Play','Party'],bookingTitleOptions:['Mx'],bookingAvailableTimeRanges:['09:00-18:00']}};
 const product={id:'b1',type:'product',props:{heading:'Products',products:[{id:'p1',name:'Product',price:'12.50'}]}};
 window.__render=(patch={})=>{props={...props,...patch};const q=new URLSearchParams(location.search);
 root.render(window.__mode==='start'?<Start siteId="10909095" initialSelection={{siteId:'10909095',offerId:q.get('offerId'),offerRevision:q.get('offerRevision'),quantity:Number(q.get('quantity')), ...(q.has('appointmentAt')?{appointmentAt:q.get('appointmentAt')}:{})}}/>:
 window.__mode==='entry'?<Entry {...props} bookingSelection={{store:'Store',item:'Play',appointmentAt:'2030-01-01T12:00'}}/>:
 <Renderer blocks={[window.__kind==='booking'?booking:product]} bookingSiteId={props.siteId} bookingSiteName="Synthetic" bookingInteractive={props.active} productCartEnabled={true} bookingViewport={props.viewport} forceMobileViewport={props.viewport==='mobile'}/>);};window.__render();`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'local-only-context',setup(b){
  const mocks={
   '@/components/I18nProvider':"export const useI18n=()=>({locale:window.__locale});",
   '@/components/PublicTrafficProvider':"export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};",
   '@/lib/authSessionRecovery':"export const resolveFrontendAuthPayload=async()=>({authenticated:false});",
   'next/navigation':"const params=new URLSearchParams();export const useSearchParams=()=>params;export const useRouter=()=>({push:()=>{throw Error('unexpected router write')}});",
   'next/dynamic':"import React,{lazy,Suspense}from'react';export default loader=>{const Child=lazy(loader);return props=><Suspense fallback={null}><Child {...props}/></Suspense>};",
   'next/image':"import React from'react';export default ({fill,unoptimized,priority,...props})=><img {...props}/>;",
   'next/link':"import React from'react';export default props=><a {...props}/>;"
  };
  b.onResolve({filter:/^(?:@\/components\/(?:I18nProvider|PublicTrafficProvider)|@\/lib\/authSessionRecovery|next\/(?:navigation|dynamic|image|link))$/},a=>({path:a.path,namespace:'entry-context'}));
  b.onLoad({filter:/.*/,namespace:'entry-context'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
 }}]}),
 postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout"; @source "./src/components/booking/BookingDateTimeInput.tsx"; @source "./src/components/blocks/BookingBlock.tsx"; @source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('entry-browser.css')})
]).then(([js,css])=>({js:js.outputFiles[0].text,css:css.css}));}
const origin='https://checkout-entry.invalid',siteId='10909095',offerId='11111111-1111-4111-8111-111111111111',offerRevision='22222222-2222-4222-8222-222222222222';
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>';
const labels={zh:{product:'选择兑换商品',quantity:'兑换数量',quote:'核对积分与券',name:'姓名',title:'称呼',email:'联系邮箱',phone:'联系电话',confirm:'确认兑换并提交',done:'兑换已确认'},en:{product:'Product to redeem',quantity:'Quantity to redeem',quote:'Review points & coupons',name:'Name',title:'Title',email:'Contact email',phone:'Phone',confirm:'Confirm redemption & submit',done:'Redemption confirmed'},es:{product:'Producto a canjear',quantity:'Cantidad a canjear',quote:'Revisar puntos y cupones',name:'Nombre',title:'Tratamiento',email:'Correo de contacto',phone:'Teléfono',confirm:'Confirmar canje y enviar',done:'Canje confirmado'}};
async function mount(page,a,{kind,viewport,locale,mode='blocks'}){
 await page.evaluate(values=>Object.assign(window,values),{__kind:kind,__viewport:viewport,__locale:locale,__mode:mode});
 await page.addStyleTag({content:a.css+'body{margin:0;padding:12px;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:a.js});
}
function descriptor(kind){return {offerId,offerRevision,title:'Configured play',maxQuantity:kind==='booking'?1:3,source:kind==='booking'?{kind,store:'Store',item:'Play'}:{kind,productId:'p1'}};}

test('actual booking/product public paths hand off stable selection without a legacy submit, then quote, choose coupons and submit once in twelve device/language journeys',{timeout:180000},async()=>{
 const a=await assets(),browser=await chromium.launch({headless:true});
 try{for(const kind of ['booking','order'])for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const viewport=width===390?'mobile':'desktop',context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],unexpected=[],writes=[],entries=[];
  const text=labels[locale.slice(0,2)],quantity=kind==='booking'?1:2;
  page.setDefaultTimeout(10000);context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){unexpected.push(url.href);return route.abort();}
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/api/member-checkout/entry'){const query=request.postDataJSON();assert.deepEqual(query,{siteId,kind,blockId:'b1',viewport});entries.push(query);return route.fulfill({json:{ok:true,entry:{query,siteId,accountId:'50010105',offers:[descriptor(kind)]}}});}
   if(url.pathname==='/api/bookings/workbench/public')return route.fulfill({json:{ok:true,settings:{timeZone:'Europe/Madrid'}}});
   if(url.pathname==='/api/orders/catalog/public')return route.fulfill({json:{ok:true,catalog:{revision:1,updatedAt:'2026-11-23T00:00:00Z',pricePrefix:'€',categories:[],products:[{id:'p1',code:'P1',name:'Product',description:'',price:'12.50',imageUrl:'',thumbnailUrl:'',tag:'',availability:'available'}]}}});
   if(url.pathname==='/api/personal-favorites')return route.fulfill({json:{authenticated:true,accountId:'50010105'}});
   if(url.pathname==='/api/member-checkout/preview'){const body=request.postDataJSON();assert.equal(body.quantity,quantity);return route.fulfill({json:{ok:true,confirmationHash:'b'.repeat(64),quote:{version:1,siteId,offerId,offerRevision,resourceKind:kind,quantity,title:'Configured play',ownPointBalance:500,reservationCreated:false,options:[{method:'points',available:true,totalPoints:100*quantity-20*(body.couponClaims?.length??0),couponCount:body.couponClaims?.length??0}],coupons:{previewOnly:true,selected:body.couponClaims??[],returnOnCancel:true,points:[{couponId:'c1',claimEventId:'claim1',title:'20 points',kind:'points_voucher',validUntil:null,available:true,singleUse:true,pointsDiscount:20,cashDiscountMinor:0,coveredQuantity:0}]}},bookingForm:kind==='booking'?{store:'Store',item:'Play',titles:['Mx'],timeZone:'Europe/Madrid'}:null,cancellationPolicy:{returnPoints:true,returnCoupons:true,advanceMinutes:60},slot:kind==='booking'?{appointmentAt:body.appointmentAt,timeZone:'Europe/Madrid',reserved:false}:null}});}
   if(url.pathname==='/api/member-checkout/submit'){const body=request.postDataJSON();writes.push(body);assert.equal(body.method,'points');assert.equal(body.quantity,quantity);assert.deepEqual(body.couponClaims,[{couponId:'c1',claimEventId:'claim1'}]);return route.fulfill({json:{ok:true,replayed:false,result:{version:1,siteId,operationKey:'a'.repeat(64),resourceKind:kind,resourceId:'original-result',totalPoints:100*quantity-20,couponCount:1,closed:false,resource:{status:kind==='booking'?'active':'pending',updatedAt:'2026-11-23T12:00:00Z'},cancellation:null,cancellationAvailable:false,cancellationPolicy:null}}});}
   unexpected.push(`${request.method()} ${url.pathname}`);return route.abort();
  });
  try{
   await page.goto(origin);await mount(page,a,{kind,viewport,locale});
   const entry=page.locator('[data-checkout-source-entry]');await entry.waitFor();
   if(kind==='booking'){await page.getByPlaceholder('YYYY-MM-DD').fill('2030-01-01');await page.getByPlaceholder('HH:MM').fill('12:00');await page.locator('input[type=email]').fill('keep@example.invalid');}
   else{await entry.getByLabel(text.product,{exact:true}).selectOption(offerId);await entry.getByLabel(text.quantity,{exact:true}).fill('2');}
   const link=entry.getByRole('link');await link.waitFor();const href=await link.getAttribute('href'),url=new URL(href,origin);
   assert.equal(url.searchParams.get('quantity'),String(quantity));assert.equal(url.searchParams.get('uiLocale'),locale);assert.ok(!/keep@|coupon|memberId|price|points/.test(href));
   assert.equal(url.searchParams.get('appointmentAt'),kind==='booking'?'2030-01-01T12:00':null);assert.equal(writes.length,0);
   await fs.mkdir('output',{recursive:true});await entry.screenshot({path:`output/checkout-source-${kind}-${width}-${locale}.png`});
   const popupPromise=page.waitForEvent('popup');await link.click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');await mount(popup,a,{kind,viewport,locale,mode:'start'});
   await popup.getByRole('button',{name:text.quote,exact:true}).click();await popup.getByRole('checkbox',{name:'20 points',exact:true}).check();
   await popup.getByLabel(text.name,{exact:true}).fill('Synthetic');if(kind==='booking')await popup.getByLabel(text.title,{exact:true}).selectOption('Mx');
   await popup.getByLabel(text.email,{exact:true}).fill('member@example.invalid');await popup.getByLabel(text.phone,{exact:true}).fill('000000000');
   await popup.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});await popup.getByText(text.done,{exact:true}).waitFor();
   assert.equal(writes.length,1);assert.equal(await popup.locator(`a[href^="/member-checkout/${siteId}/${'a'.repeat(64)}"]`).getAttribute('href'),`/member-checkout/${siteId}/${'a'.repeat(64)}?uiLocale=${locale}`);
   if(kind==='booking')assert.equal(await page.locator('input[type=email]').inputValue(),'keep@example.invalid');
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.ok(entries.length>=1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  }catch(error){await page.screenshot({path:`output/checkout-source-failed-${kind}-${width}-${locale}.png`,fullPage:true}).catch(()=>{});throw error;}
  finally{await context.close();}
 }}finally{await browser.close();}
});

test('entry remains invisible when disabled/inactive/failed, rejects wrong scope and discards late identity responses',{timeout:60000},async()=>{
 const a=await assets(),browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:850}}),page=await context.newPage();
 const errors=[],requests=[];let mode='disabled',release,started;page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});assert.equal(url.pathname,'/api/member-checkout/entry');const query=req.postDataJSON();requests.push(query);
  if(mode==='held'){started?.();await new Promise(resolve=>{release=resolve;});return route.fulfill({json:{ok:true,entry:{query,siteId,accountId:'50010105',offers:[descriptor('order')]}}}).catch(()=>{});}
  return route.fulfill(mode==='failed'?{status:503,json:{error:'unavailable'}}:{json:{ok:true,entry:mode==='wrong'||mode==='valid'?{query:mode==='wrong'?{...query,viewport:'desktop'}:query,siteId,accountId:'50010105',offers:[descriptor('order')]}:null}});
 });
 try{
  await page.goto(origin);await mount(page,a,{kind:'order',viewport:'mobile',locale:'zh-CN',mode:'entry'});await page.waitForFunction(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('/api/member-checkout/entry')));assert.equal(await page.locator('[data-checkout-source-entry]').count(),0);
  mode='valid';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('[data-checkout-source-entry]').waitFor();
  for(const next of ['failed','wrong']){mode=next;await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/member-checkout/entry')),page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);await page.locator('[data-checkout-source-entry]').waitFor({state:'detached'});}
  mode='held';const began=new Promise(resolve=>{started=resolve;});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await began;
  const releaseOld=release;mode='disabled';await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/member-checkout/entry')),page.evaluate(()=>window.dispatchEvent(new Event('faolla:service-identity-changed')))]);releaseOld();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('[data-checkout-source-entry]').count(),0);
  const count=requests.length;await page.evaluate(()=>window.__render({active:false}));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(requests.length,count);assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close();}
});

test('default-off actual public modules retain ordinary booking submit and the original cart across both sizes',{timeout:60000},async()=>{
 const a=await assets(),browser=await chromium.launch({headless:true});
 try{for(const kind of ['booking','order'])for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),unexpected=[],writes=[];let discovered;
  const discovery=new Promise(resolve=>{discovered=resolve;});
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/api/member-checkout/entry'){discovered();return route.fulfill({json:{ok:true,entry:null}});}
   if(url.pathname==='/api/bookings/workbench/public')return route.fulfill({json:{ok:true,settings:{timeZone:'Europe/Madrid'}}});
   if(url.pathname==='/api/orders/catalog/public')return route.fulfill({json:{ok:true,catalog:{revision:1,updatedAt:'2026-11-23T00:00:00Z',pricePrefix:'€',categories:[],products:[{id:'p1',code:'P1',name:'Product',description:'',price:'12.50',imageUrl:'',thumbnailUrl:'',tag:'',availability:'available'}]}}});
   if(url.pathname==='/api/bookings'&&request.method()==='POST'){const body=request.postDataJSON();writes.push(body);assert.equal(body.lookupRequest,undefined);return route.fulfill({json:{ok:true,editToken:'synthetic-edit',booking:{...body,id:'legacy-original',status:'active',createdAt:'2026-11-23T12:00:00Z',updatedAt:'2026-11-23T12:00:00Z',appointmentTimeZone:'Europe/Madrid'}}});}
   unexpected.push(`${request.method()} ${url.pathname}`);return route.abort();
  });
  try{await page.goto(origin);await mount(page,a,{kind,viewport:width===390?'mobile':'desktop',locale:'zh-CN'});await discovery;
   assert.equal(await page.locator('[data-checkout-source-entry]').count(),0);
   if(kind==='booking'){await page.getByPlaceholder('YYYY-MM-DD').fill('2030-01-01');await page.getByPlaceholder('HH:MM').fill('12:00');await page.getByLabel('姓名',{exact:true}).fill('Synthetic');await page.locator('input[type=email]').fill('synthetic@example.invalid');await page.getByLabel('电话',{exact:true}).fill('000000000');await page.getByRole('button',{name:'提交预约',exact:true}).click();await page.getByText('预约提交成功',{exact:true}).waitFor();assert.equal(writes.length,1);}
   else{await page.getByRole('button',{name:'增加购买数量',exact:true}).click();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:'提交订单',exact:true}).waitFor();assert.equal(writes.length,0);assert.equal(await page.getByText('Product',{exact:true}).count()>=1,true);}
   assert.deepEqual(unexpected,[]);
  }finally{await context.close();}
 }}finally{await browser.close();}
});
