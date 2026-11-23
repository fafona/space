import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual new UI/controllers + native storage/Web Locks, synthetic intercepted
// HTTP only. NOT a deployed Next.js/PostgREST or physical-phone acceptance.
test('on-site customer and merchant presentation in desktop/mobile Chinese, English and Spanish',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MemberOnSiteStartPanel}from'./src/components/checkout/MemberOnSiteStartPanel';
 import{MemberOnSiteResultPanel}from'./src/components/checkout/MemberOnSiteResultPanel';
 import{MerchantCheckoutSettlementPanel}from'./src/components/checkout/MerchantCheckoutSettlementPanel';
 import{MemberCheckoutRecordEntry}from'./src/components/checkout/MemberCheckoutRecordEntry';
 function App(){const[account,setAccount]=useState('50010105'),[screen,setScreen]=useState('start');window.__account=setAccount;window.__screen=setScreen;
 if(screen==='result')return <MemberOnSiteResultPanel siteId="10909095" operationKey={'a'.repeat(64)} identityKey={account} locale={window.__locale}/>;
 if(screen==='merchant')return <MerchantCheckoutSettlementPanel siteId="10909095" resources={[{kind:window.__kind,id:'synthetic-original'}]} identityKey={account} locale={window.__locale} apiClient={(url,options)=>fetch(url,options)}/>;
 if(screen==='history')return <MemberCheckoutRecordEntry active={!!account} accountId={account||''} siteId="10909095" kind={window.__kind} id="synthetic-original" locale={window.__locale}/>;
 return <MemberOnSiteStartPanel siteId="10909095" accountId={account} locale={window.__locale} initialSelection={{offerId:'11111111-1111-4111-8111-111111111111',offerRevision:'22222222-2222-4222-8222-222222222222',quantity:1,...(window.__kind==='booking'?{appointmentAt:'2030-01-01T12:00'}:{})}}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";\n@source "./src/components/booking/BookingDateTimeInput.tsx";',{from:path.resolve('checkout-onsite-acceptance.css')})).css;
 const labels={zh:{name:'姓名',email:'联系邮箱',phone:'联系电话',note:'备注',title:'称呼',quote:'核对金额与优惠券',confirm:'确认提交 · 到店付款',recover:'核对原单',done:'原单已确认',other:'本设备其他页面有原单，请先核对。',unpaid:'待到店付款',cancel:'取消本单',confirmCancel:'确认取消本单',closed:'原单已关闭',reload:'重新读取原单',review:'原单需人工核对'},
  en:{name:'Name',email:'Contact email',phone:'Phone',note:'Note',title:'Title',quote:'Review amount & coupons',confirm:'Submit · Pay at venue',recover:'Check original checkout',done:'Original checkout confirmed',other:'Another page has an original checkout. Review it first.',unpaid:'Pay at venue — unpaid',cancel:'Cancel checkout',confirmCancel:'Confirm cancellation',closed:'Original checkout closed',reload:'Reload original',review:'Original checkout needs review'},
  es:{name:'Nombre',email:'Correo de contacto',phone:'Teléfono',note:'Nota',title:'Tratamiento',quote:'Revisar importe y cupones',confirm:'Enviar · Pagar en el local',recover:'Consultar pedido original',done:'Pedido original confirmado',other:'Otra página tiene un pedido original. Revísalo primero.',unpaid:'Pendiente de pago en el local',cancel:'Cancelar pedido',confirmCancel:'Confirmar cancelación',closed:'Pedido original cerrado',reload:'Volver a leer el original',review:'Revisar el pedido original'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])for(const kind of ['booking','order'])await t.test(`${width} ${locale} ${kind}`,async()=>{
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],foreign=[],writes=[],reads=[];let release,mode='hold',closed=false,needsReview=false;
  const text=labels[locale.slice(0,2)],at='2026-11-23T12:00:00Z',scope={siteId:'10909095',operationKey:'a'.repeat(64)};
  const cancelled=()=>({version:2,method:'on_site',...scope,resourceKind:kind,resourceId:'synthetic-original',closed:true,pointsReturned:0,cashReturnedMinor:0,couponsReturned:1,stockReleased:1,cancelledAt:at});
  const result=()=>({version:2,...scope,terms:{version:2,method:'on_site',resourceKind:kind,resourceId:'synthetic-original',currency:'eur',grossMinor:1000,discountMinor:200,dueMinor:800,capturedMinor:0,totalPoints:null,couponCount:1,paymentState:'unpaid'},
   closed,termsMatch:!needsReview,resource:{status:closed?'cancelled':kind==='booking'?'active':'pending',updatedAt:at},collection:null,cancellation:closed?cancelled():null,cancellationAvailable:!closed&&!needsReview,cancellationPolicy:{returnCoupons:true,advanceMinutes:kind==='booking'?60:0,cancellableUntil:kind==='booking'?'2030-01-01T11:00:00Z':null}});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://cash-checkout.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   if(url.origin!=='https://cash-checkout.invalid'){foreign.push(url.href);return route.abort();}
   if(url.pathname==='/api/member-checkout/resource'){assert.equal(request.method(),'GET');return route.fulfill({json:{ok:true,result:null,onSite:result()}});}
   assert.equal(request.method(),'POST');const body=request.postDataJSON();
   if(url.pathname.endsWith('/preview')){reads.push(body);const count=body.couponClaims?.length??0;return route.fulfill({json:{ok:true,replayed:false,quote:{version:1,method:'on_site',siteId:body.siteId,offerId:body.offerId,offerRevision:body.offerRevision,quantity:body.quantity,resourceKind:kind,title:'Digital sports',grossMinor:1000,discountMinor:200*count,dueMinor:1000-200*count,capturedMinor:0,totalPoints:null,couponCount:count,selected:body.couponClaims??[],
     coupons:[{couponId:'coupon-one',claimEventId:'claim-one',title:'Member coupon',kind:'amount_off',validUntil:null,available:true,singleUse:true,pointsDiscount:0,cashDiscountMinor:200,coveredQuantity:0}],confirmationHash:'b'.repeat(64),reservationCreated:false,cancellationPolicy:{returnCoupons:true,advanceMinutes:60},
     bookingForm:kind==='booking'?{store:'CyberSports361',item:'Digital sports',titles:['Mx'],timeZone:'Europe/Madrid'}:null,slot:kind==='booking'?{appointmentAt:body.appointmentAt,timeZone:'Europe/Madrid',reserved:false}:null}}});}
   if(url.pathname.endsWith('/recover'))return route.fulfill({json:mode==='confirmed'?{ok:true,state:'confirmed',original:{method:'on_site',result:result()}}:{ok:true,state:'unconfirmed'}});
   if(url.pathname.endsWith('/submit')){writes.push(body);await new Promise(resolve=>{release=resolve;});return route.fulfill({status:503,json:{error:'checkout_unconfirmed'}});}
   if(url.pathname.endsWith('/result'))return route.fulfill({json:{ok:true,result:result()}});
   if(url.pathname.endsWith('/cancel')){writes.push(body);closed=true;return width===390?route.fulfill({status:503,json:{error:'checkout_unconfirmed'}}):route.fulfill({json:{ok:true,replayed:false,cancellation:cancelled()}});}
   assert.equal(url.pathname,'/api/merchant-checkout/settlements');return route.fulfill({json:{ok:true,snapshot:{version:2,siteId:scope.siteId,rows:[{kind,id:'synthetic-original',result:null,onSite:result(),termsMatch:true}]}}});
  });
  const mount=async()=>{await page.evaluate(({locale,kind})=>{window.__locale=locale;window.__kind=kind;},{locale,kind});await page.addStyleTag({content:css+'body{margin:0;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{
   await page.goto('https://cash-checkout.invalid/');await mount();await page.getByLabel(text.name,{exact:true}).fill('Private synthetic');await page.getByLabel(text.email,{exact:true}).fill('private@example.invalid');await page.getByLabel(text.phone,{exact:true}).fill('000000000');await page.getByLabel(text.note,{exact:true}).fill('Private note');
   await page.getByRole('button',{name:text.quote,exact:true}).click();await page.getByRole('heading',{name:'Digital sports × 1',exact:true}).waitFor();if(kind==='booking')await page.getByLabel(text.title,{exact:true}).selectOption('Mx');
   await page.getByRole('checkbox',{name:'Member coupon',exact:true}).check();await page.getByRole('button',{name:text.confirm,exact:true}).waitFor();
   const peer=await context.newPage();await peer.goto('https://cash-checkout.invalid/');
   await peer.evaluate(()=>new Promise(ready=>{navigator.locks.request('faolla-member-checkout-v2:10909095:50010105',async()=>{ready();await new Promise(release=>{window.__release=release;});});}));
   await page.getByRole('button',{name:text.confirm,exact:true}).click();await page.getByText(text.other,{exact:true}).waitFor();assert.equal(writes.length,0);await peer.evaluate(()=>window.__release());await peer.close();
   await page.getByRole('button',{name:text.quote,exact:true}).click();await page.getByRole('button',{name:text.confirm,exact:true}).waitFor();
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/onsite-checkout-ready-${width}-${locale}-${kind}.png`,fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   for(let i=0;!release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);assert.equal(writes.length,1);assert.equal(writes[0].method,'on_site');assert.deepEqual(writes[0].couponClaims,[{couponId:'coupon-one',claimEventId:'claim-one'}]);assert.notEqual(reads[0].nonce,writes[0].nonce);
   const stored=await page.evaluate(()=>localStorage.getItem('faolla-member-checkout-v2:10909095:50010105'));assert.deepEqual(Object.keys(JSON.parse(stored)).sort(),['nonce','version']);assert.ok(!/Private|private@|coupon|1000/.test(stored));release();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();
   await page.reload();await mount();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();assert.equal(writes.length,1);mode='confirmed';await page.getByRole('button',{name:text.recover,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();await page.getByText(text.unpaid,{exact:true}).waitFor();
   await page.evaluate(()=>window.__screen('history'));await page.locator('[data-checkout-record-entry] button').click();await page.getByText(text.unpaid,{exact:true}).waitFor();assert.match(await page.locator('[data-checkout-record-entry] a').getAttribute('href'),/\/on-site\/a{64}/);
   await page.evaluate(()=>window.__screen('merchant'));await page.getByText(text.unpaid,{exact:true}).waitFor();await page.screenshot({path:`output/onsite-checkout-merchant-${width}-${locale}-${kind}.png`,fullPage:true,animations:'disabled'});
   await page.evaluate(()=>window.__screen('result'));await page.getByRole('button',{name:text.cancel,exact:true}).click();await page.getByRole('button',{name:text.confirmCancel,exact:true}).evaluate(button=>{button.click();button.click();});
   if(width===390){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:text.confirmCancel,exact:true}).count(),0);assert.equal(await page.locator('[data-on-site-summary]').count(),0);assert.equal(writes.length,2);await page.getByRole('button',{name:text.reload,exact:true}).click();}
   await page.getByText(text.closed,{exact:true}).waitFor();assert.equal(writes.length,2);
   await page.screenshot({path:`output/onsite-checkout-closed-${width}-${locale}-${kind}.png`,fullPage:true,animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   needsReview=true;await page.getByRole('button',{name:text.reload,exact:true}).click();await page.getByText(text.review,{exact:true}).waitFor();
   assert.equal(await page.getByText(text.closed,{exact:true}).count(),0);assert.equal(await page.getByText(text.unpaid,{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).count(),0);assert.equal(writes.length,2);
   await page.evaluate(()=>window.__account(null));assert.equal(await page.getByText('synthetic-original',{exact:true}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/onsite-checkout-failure-${width}-${locale}-${kind}.png`,fullPage:true});throw error;}
  finally{await context.close();}
 });}finally{await browser.close();}
});
