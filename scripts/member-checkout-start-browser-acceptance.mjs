import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual new UI/controller, native localStorage/Web Locks, intercepted synthetic
// HTTP. This does not claim deployed Next.js or a real PostgreSQL browser loop.
test('member checkout quotes coupons, sends once, survives reload and hides old identity in six desktop/mobile language journeys',{timeout:120000},async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MemberCheckoutStartPanel}from'./src/components/checkout/MemberCheckoutStartPanel';
 function App(){const[account,setAccount]=useState('50010105');window.__account=setAccount;return <MemberCheckoutStartPanel siteId="10909095" accountId={account} initialSelection={{offerId:'11111111-1111-4111-8111-111111111111',offerRevision:'22222222-2222-4222-8222-222222222222',quantity:1,appointmentAt:'2030-01-01T12:00'}} locale={window.__locale}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MemberCheckoutStartPanel.tsx";\n@source "./src/components/checkout/MerchantCheckoutCouponPicker.tsx";\n@source "./src/components/checkout/MerchantSettlementBadge.tsx";\n@source "./src/components/booking/BookingDateTimeInput.tsx";',{from:path.resolve('checkout-start-acceptance.css')})).css;
 const labels={zh:{quote:'核对积分与券',name:'姓名',title:'称呼',email:'联系邮箱',phone:'联系电话',note:'备注',confirm:'确认兑换并提交',recover:'核对原单',done:'兑换已确认',login:'请先登录，核对本人的会员积分和券。',other:'本设备其他页面有结算操作，请先核对原单。'},
 en:{quote:'Review points & coupons',name:'Name',title:'Title',email:'Contact email',phone:'Phone',note:'Note',confirm:'Confirm redemption & submit',recover:'Check original checkout',done:'Redemption confirmed',login:'Sign in to review your own member points and coupons.',other:'Another page on this device has a checkout. Check the original first.'},
 es:{quote:'Revisar puntos y cupones',name:'Nombre',title:'Tratamiento',email:'Correo de contacto',phone:'Teléfono',note:'Nota',confirm:'Confirmar canje y enviar',recover:'Consultar pedido original',done:'Canje confirmado',login:'Inicia sesión para consultar tus puntos y cupones de socio.',other:'Otra página de este dispositivo tiene un canje. Consulta primero el original.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],foreign=[],writes=[],recoveries=[];
  const text=labels[locale.slice(0,2)];let release,mode='hold-write';
  const result={version:1,siteId:'10909095',operationKey:'a'.repeat(64),resourceKind:'booking',resourceId:'synthetic-original-booking',totalPoints:80,couponCount:1,closed:false,
   resource:{status:'active',updatedAt:'2026-11-23T12:00:00Z'},cancellationAvailable:false,cancellationPolicy:null,cancellation:null};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://checkout-start.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   if(url.origin!=='https://checkout-start.invalid'){foreign.push(url.href);return route.abort();}
   assert.equal(request.method(),'POST');const body=request.postDataJSON();
   if(url.pathname.endsWith('/preview'))return route.fulfill({json:{ok:true,confirmationHash:'b'.repeat(64),quote:{version:1,siteId:body.siteId,offerId:body.offerId,offerRevision:body.offerRevision,
    resourceKind:'booking',quantity:body.quantity,title:'Digital sports · 60 min',ownPointBalance:500,reservationCreated:false,options:[{method:'points',available:true,totalPoints:100-20*(body.couponClaims?.length??0),couponCount:body.couponClaims?.length??0}],
    coupons:{previewOnly:true,selected:body.couponClaims??[],returnOnCancel:true,points:[{couponId:'coupon-one',claimEventId:'claim-one',title:'20 points',kind:'points_voucher',validUntil:null,available:true,singleUse:true,pointsDiscount:20,cashDiscountMinor:0,coveredQuantity:0}]}},
    bookingForm:{store:'CyberSports361',item:'Digital sports',titles:['Mx'],timeZone:'Europe/Madrid'},cancellationPolicy:{returnPoints:true,returnCoupons:true,advanceMinutes:60},slot:{appointmentAt:body.appointmentAt,timeZone:'Europe/Madrid',reserved:false}}});
   if(url.pathname.endsWith('/recover')){recoveries.push(body);return route.fulfill({json:mode==='confirmed'?{ok:true,state:'confirmed',result}:{ok:true,state:'unconfirmed'}});}
   assert.equal(url.pathname,'/api/member-checkout/submit');writes.push(body);await new Promise(resolve=>{release=resolve;});return route.fulfill({status:503,json:{error:'checkout_unconfirmed'}});
  });
  const mount=async()=>{await page.evaluate(value=>{window.__locale=value;},locale);await page.addStyleTag({content:css+'body{margin:0;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{
   await page.goto('https://checkout-start.invalid/');await mount();await page.getByRole('button',{name:text.quote,exact:true}).click();
   await page.getByText('Digital sports · 60 min × 1',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'20 points',exact:true}).check();
   await page.getByLabel(text.name,{exact:true}).fill('Private synthetic');await page.getByLabel(text.title,{exact:true}).selectOption('Mx');await page.getByLabel(text.email,{exact:true}).fill('private@example.invalid');
   await page.getByLabel(text.phone,{exact:true}).fill('000000000');await page.getByLabel(text.note,{exact:true}).fill('Private note');
   // A REAL second same-origin page owns the native Web Lock. Even a ready
   // quote in our page must not send a financial request through that lock.
   const peer=await context.newPage();await peer.goto('https://checkout-start.invalid/');
   await peer.evaluate(()=>new Promise(ready=>{navigator.locks.request('faolla-member-checkout-v2:10909095:50010105',async()=>{ready();await new Promise(release=>{window.__releaseNativeLock=release;});});}));
   await page.getByRole('button',{name:text.confirm,exact:true}).click();await page.getByText(text.other,{exact:true}).waitFor();assert.equal(writes.length,0);
   await peer.evaluate(()=>window.__releaseNativeLock());await peer.close();await page.getByRole('button',{name:text.quote,exact:true}).click();await page.getByRole('button',{name:text.confirm,exact:true}).waitFor();
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-start-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   for(let i=0;!release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);assert.equal(writes.length,1);
   const stored=await page.evaluate(()=>localStorage.getItem('faolla-member-checkout-v2:10909095:50010105'));assert.deepEqual(Object.keys(JSON.parse(stored)).sort(),['nonce','version']);assert.ok(!/Private|private@|points|coupon/.test(stored));
   assert.equal(writes[0].method,'points');assert.deepEqual(writes[0].couponClaims,[{couponId:'coupon-one',claimEventId:'claim-one'}]);const nonce=writes[0].nonce;
   release();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();assert.equal(writes.length,1);
   await page.reload();await mount();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(recoveries.length,1);assert.equal(recoveries[0].nonce,nonce);
   assert.equal(await page.getByRole('button',{name:text.confirm,exact:true}).count(),0);
   mode='confirmed';await page.getByRole('button',{name:text.recover,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(recoveries[1].nonce,nonce);
   await page.screenshot({path:`output/member-checkout-start-confirmed-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.evaluate(()=>window.__account(null));await page.getByText(text.login,{exact:true}).waitFor();assert.equal(await page.getByText('synthetic-original-booking',{exact:true}).count(),0);
   assert.equal(writes.length,1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-start-failure-${width}-${locale}.png`,fullPage:true});throw error;}
  finally{await context.close();}
 }}finally{await browser.close();}
});
