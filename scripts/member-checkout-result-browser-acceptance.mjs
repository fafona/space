import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
// Real controller + UI, synthetic intercepted HTTP only. Separate PostgreSQL
// acceptance tests cover actual route handler/adapter/cancellation transaction.
test('customer original checkout keeps one cancellation on unknown results and hides stale identity data in zh/en/es mobile/desktop',{timeout:120000},async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
  import{MemberCheckoutResultPanel}from'./src/components/checkout/MemberCheckoutResultPanel';
  function App(){const[identity,setIdentity]=useState('personal-synthetic');window.__setIdentity=setIdentity;return <MemberCheckoutResultPanel siteId="10909095" operationKey={'a'.repeat(64)} identityKey={identity} locale={window.__locale}/>;}
  createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MemberCheckoutResultPanel.tsx";\n@source "./src/components/checkout/MerchantSettlementBadge.tsx";',{from:path.resolve('checkout-result-acceptance.css')})).css;
 const labels={zh:{title:'预约与订单结算',cancel:'取消本单',confirm:'确认取消本单',reload:'重新读取',unknown:'取消结果尚未确认。请重新读取原单；不要重复提交。',returned:'积分已退回',login:'请登录后查看本人原单。'},
 en:{title:'Booking & order settlement',cancel:'Cancel checkout',confirm:'Confirm cancellation',reload:'Reload',unknown:'Cancellation is unconfirmed. Reload the original checkout; do not submit again.',returned:'Points returned',login:'Sign in to view your own checkout.'},
 es:{title:'Pago de reservas y pedidos',cancel:'Cancelar pedido',confirm:'Confirmar cancelación',reload:'Volver a leer',unknown:'La cancelación no está confirmada. Vuelve a leer el pedido; no lo envíes otra vez.',returned:'Puntos devueltos',login:'Inicia sesión para ver tu pedido.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],foreign=[],writes=[];
  const text=labels[locale.slice(0,2)];let mode='hold-write',releaseWrite,releaseRead,reads=0;
  let result={version:1,siteId:'10909095',operationKey:'a'.repeat(64),resourceKind:'booking',resourceId:'synthetic-booking',totalPoints:100,couponCount:1,closed:false,
   resource:{status:'confirmed',updatedAt:'2026-11-22T12:00:00Z'},cancellationAvailable:true,cancellationPolicy:{returnPoints:true,returnCoupons:true,advanceMinutes:60,cancellableUntil:'2030-01-01T12:00:00Z'},cancellation:null};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://checkout-result.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   if(url.origin!=='https://checkout-result.invalid'){foreign.push(url.href);return route.abort();}
   if(url.pathname==='/api/member-checkout/result'){
    reads++;if(mode==='hold-read')await new Promise(resolve=>{releaseRead=resolve;});
    return route.fulfill({json:{ok:true,result}});
   }
   assert.equal(url.pathname,'/api/member-checkout/cancel');assert.equal(request.method(),'POST');writes.push(request.postDataJSON());
   if(mode==='hold-write')await new Promise(resolve=>{releaseWrite=resolve;});
   return route.fulfill({status:503,json:{error:'checkout_unconfirmed'}});
  });
  try{
   await page.goto('https://checkout-result.invalid/');await page.evaluate(value=>{window.__locale=value;},locale);
   await page.addStyleTag({content:css+'body{margin:0;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('heading',{name:text.title,exact:true}).waitFor();await page.getByText('synthetic-booking',{exact:false}).waitFor();assert.equal(reads,1);
   await page.getByRole('button',{name:text.cancel,exact:true}).click();
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-result-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.disabled));
   for(let i=0;!releaseWrite&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseWrite);assert.equal(writes.length,1);
   assert.deepEqual(writes[0],{siteId:'10909095',operationKey:'a'.repeat(64),expectedUpdatedAt:'2026-11-22T12:00:00Z'});
   releaseWrite();await page.getByText(text.unknown,{exact:true}).waitFor();assert.equal(reads,1);assert.equal(writes.length,1);
   assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).isDisabled(),true);
   result={...result,closed:true,cancellationAvailable:false,resource:{...result.resource,status:'cancelled'},cancellation:{pointsReturned:100,couponsReturned:1,stockReleased:1,cancelledAt:'2026-11-22T12:01:00Z'}};
   mode='ok';await page.getByRole('button',{name:text.reload,exact:true}).click();await page.locator('[data-settlement-state="points_returned"]').waitFor();
   assert.equal(reads,2);assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).count(),0);assert.equal(writes.length,1);
   // A late old-account read must not restore private details after sign-out.
   mode='hold-read';await page.evaluate(()=>window.__setIdentity('second-identity'));
   for(let i=0;!releaseRead&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseRead);
   await page.evaluate(()=>window.__setIdentity(null));await page.getByText(text.login,{exact:true}).waitFor();releaseRead();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(await page.getByText('synthetic-booking',{exact:false}).count(),0);assert.equal(writes.length,1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-result-failure-${width}-${locale}.png`,fullPage:true});throw error;
  }finally{await context.close();}
 }}finally{await browser.close();}
});
