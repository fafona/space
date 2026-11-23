import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual owner component and DTO parsers. Intercepted synthetic HTTP only;
// not live Next.js/PostgREST, production authorization or a physical phone.
test('owner receipt confirmation remains explicit, single-dispatch and separate from business completion in six localized layouts',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MerchantCheckoutSettlementPanel}from'./src/components/checkout/MerchantCheckoutSettlementPanel';
 const api=(url,options)=>fetch(url,options);function App(){const[identity,setIdentity]=useState('synthetic-owner');window.__identity=setIdentity;return <MerchantCheckoutSettlementPanel siteId="10909095" identityKey={identity} ownerScope="${'f'.repeat(64)}" resources={[{kind:'order',id:'cash-original'},{kind:'order',id:'coupon-original'}]} locale={window.__locale} apiClient={api}/>;}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";',{from:path.resolve('checkout-receipt-acceptance.css')})).css;
 const labels={zh:{reload:'重新读取',open:'登记到店收款',confirm:'确认已收到全额',unpaid:'待到店付款',paid:'商户登记已收款'},en:{reload:'Reload',open:'Record venue receipt',confirm:'Confirm full amount received',unpaid:'Pay at venue — unpaid',paid:'Cash receipt recorded by merchant'},es:{reload:'Volver a leer',open:'Registrar cobro en el local',confirm:'Confirmar importe total recibido',unpaid:'Pendiente de pago en el local',paid:'Cobro registrado por el comercio'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES'])await t.test(`${width} ${locale}`,async()=>{
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],foreign=[],writes=[];let enabled=false,collected=false,release;
  const text=labels[locale.slice(0,2)],at='2026-11-23T12:00:00Z',siteId='10909095',operationKey='a'.repeat(64);
  const result=(covered=false)=>({version:2,siteId,operationKey:covered?'b'.repeat(64):operationKey,terms:{version:2,method:'on_site',resourceKind:'order',resourceId:covered?'coupon-original':'cash-original',currency:'eur',grossMinor:1000,discountMinor:covered?1000:200,dueMinor:covered?0:800,capturedMinor:0,totalPoints:null,couponCount:1,paymentState:covered?'coupon_covered':'unpaid'},closed:false,termsMatch:true,resource:{status:'completed',updatedAt:at},cancellation:null,cancellationAvailable:false,cancellationPolicy:{returnCoupons:true,advanceMinutes:0,cancellableUntil:null},collection:!covered&&collected?{amountMinor:800,currency:'eur',recordedAt:at}:null});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://receipt-checkout.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.origin!=='https://receipt-checkout.invalid'){foreign.push(url.href);return route.abort();}
   assert.equal(request.method(),'POST');assert.equal(request.headers()['x-checkout-owner-scope'],'f'.repeat(64));
   if(url.pathname==='/api/merchant-checkout/settlements')return route.fulfill({json:{ok:true,canRecordOnSiteReceipt:enabled,snapshot:{version:2,siteId,rows:[false,true].map(covered=>({kind:'order',id:covered?'coupon-original':'cash-original',result:null,onSite:result(covered),termsMatch:true}))}}});
   assert.equal(url.pathname,'/api/merchant-checkout/on-site/collect');writes.push(request.postDataJSON());await new Promise(resolve=>{release=resolve;});collected=true;
   return width===390?route.fulfill({status:503,json:{error:'checkout_unconfirmed'}}):route.fulfill({json:{ok:true,receipt:{version:1,siteId,operationKey,resourceKind:'order',resourceId:'cash-original',amountMinor:800,currency:'eur',recordedAt:at,replayed:false}}});
  });
  try{
   await page.goto('https://receipt-checkout.invalid/');await page.evaluate(locale=>{window.__locale=locale;},locale);await page.addStyleTag({content:css+'body{margin:0;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByText(text.unpaid,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);assert.equal(writes.length,0);
   enabled=true;await page.getByRole('button',{name:text.reload,exact:true}).click();await page.getByRole('button',{name:text.open,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),1);
   await page.getByRole('button',{name:text.open,exact:true}).click();await page.getByRole('region',{name:text.confirm,exact:true}).waitFor();
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/onsite-receipt-confirm-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   for(let i=0;!release&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);assert.equal(writes.length,1);assert.deepEqual(writes[0],{siteId,operationKey,expectedUpdatedAt:at,expectedDueMinor:800,received:true});release();
   if(width===390){await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-on-site-summary]').count(),0);assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);await page.getByRole('button',{name:text.reload,exact:true}).click();}
   await page.getByText(text.paid,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);assert.equal(await page.getByText(text.unpaid,{exact:true}).count(),0);assert.equal(writes.length,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`output/onsite-receipt-recorded-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.evaluate(()=>window.__identity(null));assert.equal(await page.locator('[data-on-site-summary]').count(),0);assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/onsite-receipt-failed-${width}-${locale}.png`,fullPage:true});throw error;}finally{await context.close();}
 });}finally{await browser.close();}
});
