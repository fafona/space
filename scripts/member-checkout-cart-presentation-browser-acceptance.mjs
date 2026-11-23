import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import fixtures from './fixtures/member-checkout-cart-review.ts';
const {cartReviewFixture}=fixtures;

// Actual components / safe parsers, synthetic intercepted HTTP only.
// Not real owner/personal sessions, Next/PostgREST or a physical-phone test.
test('cart merchant report, personal history and original cancellation across six localized layouts',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutSettlementPanel}from'./src/components/checkout/MerchantCheckoutSettlementPanel';
 import{MemberCheckoutRecordEntry}from'./src/components/checkout/MemberCheckoutRecordEntry';
 import{MemberCartResultPanel}from'./src/components/checkout/MemberCartResultPanel';
 const api=(url,options)=>fetch(url,options);
 function App(){const[screen,setScreen]=useState('merchant'),[identity,setIdentity]=useState('50010105');window.__screen=setScreen;window.__identity=setIdentity;
 if(screen==='history')return <MemberCheckoutRecordEntry active={!!identity} accountId={identity||''} siteId={window.__site} kind="order" id={window.__points.resourceId} locale={window.__locale}/>;
 if(screen==='result')return <MemberCartResultPanel siteId={window.__site} operationKey={window.__points.operationKey} identityKey={identity} locale={window.__locale}/>;
 return <MerchantCheckoutSettlementPanel siteId={window.__site} resources={window.__resources} identityKey={identity} ownerScope={'f'.repeat(64)} locale={window.__locale} apiClient={api}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";',{from:path.resolve('cart-presentation-acceptance.css')})).css;
 const labels={zh:{filter:'本页筛选',reload:'重新读取',unpaid:'待到店付款 · 尚未登记收款',closed:'原单已关闭',review:'原单需人工核对',receipt:'登记到店收款',check:'核对原单结算',history:'查看结算与取消规则',result:'整车结算原单',cancel:'取消整车原单',confirm:'确认取消整车',reloadOriginal:'重新读取原单',login:'请登录查看本人原单。'},
 en:{filter:'Current-page filter',reload:'Reload',unpaid:'Pay at venue — no receipt recorded',closed:'Original closed',review:'Original needs review',receipt:'Record venue receipt',check:'Check original settlement',history:'Settlement & cancellation policy',result:'Original cart checkout',cancel:'Cancel original cart',confirm:'Confirm whole-cart cancellation',reloadOriginal:'Reload original',login:'Sign in to view your own original.'},
 es:{filter:'Filtro de esta página',reload:'Volver a leer',unpaid:'Pago en local — sin cobro registrado',closed:'Original cerrado',review:'El original necesita revisión',receipt:'Registrar cobro en el local',check:'Consultar pago original',history:'Pago y política de cancelación',result:'Pedido original del carrito',cancel:'Cancelar carrito original',confirm:'Confirmar cancelación completa',reloadOriginal:'Volver a leer el original',login:'Inicia sesión para ver tu original.'}};
 const evidence=path.resolve('output',`cart-presentation-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${width} ${locale}`,async()=>{
  const x=await cartReviewFixture(),y=await cartReviewFixture('on_site'),text=labels[locale],points={...x.result,lines:x.result.lines.map((l,i)=>({...l,returnPoints:i===0}))},cash={...y.result,resourceId:'cash-cart',resource:{...y.result.resource,status:'completed'},cancellationAvailable:false};
  const close=r=>({...r,closed:true,cancellationAvailable:false,resource:{...r.resource,status:'cancelled'},cancellation:{pointsReturned:r.lines.reduce((s,l)=>s+(l.returnPoints?l.points??0:0),0),couponsReturned:0,stockReleased:2,cancelledAt:new Date().toISOString()}});
  const cancelled={...close(points),resourceId:'previous-closed-cart',operationKey:'c'.repeat(64)},resources=[{kind:'order',id:points.resourceId},{kind:'order',id:cash.resourceId},{kind:'order',id:cancelled.resourceId},{kind:'order',id:'legacy-order'}];
  const context=await browser.newContext({viewport:{width,height:920}}),page=await context.newPage(),errors=[],foreign=[],writes=[];let current=points,needsReview=false;
  page.on('pageerror',e=>errors.push(e.message));await context.addInitScript(({site,points,resources,locale})=>{window.__site=site;window.__points=points;window.__resources=resources;window.__locale=locale;},{site:x.f.siteId,points,resources,locale});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://cart-presentation.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.origin!=='https://cart-presentation.invalid'){foreign.push(url.href);return route.abort();}
   if(url.pathname==='/api/merchant-checkout/settlements'){
    assert.equal(request.method(),'POST');assert.equal(request.headers()['x-checkout-owner-scope'],'f'.repeat(64));
    const cashView=needsReview?{...cash,reviewRequired:true}:cash;
    return route.fulfill({json:{ok:true,canRecordOnSiteReceipt:true,snapshot:{version:3,siteId:x.f.siteId,rows:[points,cashView,cancelled].map(cart=>({kind:'order',id:cart.resourceId,termsMatch:!cart.reviewRequired,result:null,cart:{...cart,memberId:'PRIVATE',claimEvents:'PRIVATE'}})).concat([{kind:'order',id:'legacy-order',termsMatch:false,result:null}])}}});
   }
   if(url.pathname==='/api/member-checkout/resource'){
    assert.equal(request.method(),'GET');assert.equal(request.headers()['x-checkout-account-scope'],'50010105');return route.fulfill({json:{ok:true,result:null,cart:points}});
   }
   if(url.pathname==='/api/member-checkout/cart/result')return route.fulfill({json:{ok:true,state:'confirmed',original:{kind:'cart',result:current}}});
   assert.equal(url.pathname,'/api/member-checkout/cart/cancel');writes.push(request.postDataJSON());current=close(points);
   return width===390?route.fulfill({status:503,json:{error:'checkout_unconfirmed'}}):route.fulfill({json:{ok:true,replayed:false,result:{...current,lines:current.lines.map(l=>({...l,title:'Wrong immutable product'}))}}});
  });
  try{
   await page.goto('https://cart-presentation.invalid/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('combobox',{name:text.filter,exact:true}).waitFor();assert.equal(await page.locator('[data-resource-id]').count(),4);assert.equal(await page.getByRole('button',{name:text.receipt,exact:true}).count(),0);
   await page.getByText(text.unpaid,{exact:true}).waitFor();assert.equal(await page.getByText(text.closed,{exact:true}).count(),1);
   const filter=page.getByRole('combobox',{name:text.filter,exact:true});await filter.selectOption('linked');assert.equal(await page.locator('[data-resource-id]').count(),3);await filter.selectOption('closed');assert.equal(await page.locator('[data-resource-id]').count(),1);
   await filter.selectOption('unlinked');assert.equal(await page.locator('[data-resource-id]').count(),1);await filter.selectOption('all');
   await page.screenshot({path:path.join(evidence,`merchant-${width}-${locale}.png`),fullPage:true,animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.ok(!(await page.locator('body').innerText()).includes('PRIVATE'));
   needsReview=true;await page.getByRole('button',{name:text.reload,exact:true}).click();await page.getByRole('heading',{name:text.review,exact:true}).waitFor();assert.equal(await page.getByText(text.unpaid,{exact:true}).count(),0);await filter.selectOption('review');assert.equal(await page.locator('[data-resource-id]').count(),1);
   await page.evaluate(()=>window.__screen('history'));await page.getByRole('button',{name:text.check,exact:true}).click();await page.locator('[data-checkout-record-entry] [data-cart-summary]').waitFor();assert.match(await page.getByRole('link',{name:text.history,exact:true}).getAttribute('href'),/\/cart\/[a-f0-9]{64}\?uiLocale=/);
   await page.evaluate(()=>window.__screen('result'));await page.getByRole('heading',{name:text.result,exact:true}).waitFor();await page.locator('[data-member-cart-result] [data-cart-summary]').waitFor();
   await page.getByRole('button',{name:text.cancel,exact:true}).click();await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   await page.getByRole('alert').waitFor();assert.equal(writes.length,1);assert.equal(await page.locator('[data-member-cart-result] [data-cart-summary]').count(),0);assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).count(),0);
   await page.getByRole('button',{name:text.reloadOriginal,exact:true}).click();await page.getByText(text.closed,{exact:true}).waitFor();assert.equal(writes.length,1);
   await page.screenshot({path:path.join(evidence,`original-${width}-${locale}.png`),fullPage:true,animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.evaluate(()=>window.__identity(null));await page.getByText(text.login,{exact:true}).waitFor();assert.equal(await page.getByText(points.resourceId,{exact:true}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}.png`),fullPage:true});throw error;}finally{await context.close();}
 });console.log(`CART_PRESENTATION_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});
