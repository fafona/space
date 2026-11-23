import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import test from 'node:test';
import {build} from 'esbuild';import postcss from 'postcss';import tailwind from '@tailwindcss/postcss';import {chromium} from 'playwright';
import fixtures from './fixtures/member-checkout-cart-review.ts';import http from '../src/lib/merchantCheckoutCartCollection.server.ts';import access from '../src/lib/merchantCheckoutOwnerAccess.server.ts';
// Actual report/customer components and actual new HTTP handler. Network,
// authority/service metadata and financial RPC are explicitly synthetic.
test('cart venue receipts are explicit, one-shot, owner-scoped and visible to the customer without invented online capture',{timeout:120000},async t=>{
 const script=(await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MerchantCheckoutSettlementPanel}from'./src/components/checkout/MerchantCheckoutSettlementPanel';import{MemberCartResultPanel}from'./src/components/checkout/MemberCartResultPanel';
 const api=(p,i)=>fetch(p,i);function App(){const[identity,I]=useState('synthetic-owner'),[customer,C]=useState(false);window.__identity=I;window.__customer=C;
 return customer?<MemberCartResultPanel siteId={window.__site} operationKey={window.__operation} identityKey={identity} locale={window.__locale}/>:<MerchantCheckoutSettlementPanel siteId={window.__site} resources={window.__resources} identityKey={identity} ownerScope={window.__owner} locale={window.__locale} apiClient={api}/>;}createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',logLevel:'silent',define:{'process.env':'{}'}})).outputFiles[0].text;
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "./src/components/checkout/*.tsx";',{from:path.resolve('cart-receipt-fixture.css')})).css;
 const words={zh:{open:'登记整车到店收款',confirm:'确认整车全额已收',paid:'商户登记已收款',reload:'重新读取',unpaid:'待到店付款 · 尚未登记收款',review:'原单需人工核对',cancel:'取消整车原单'},en:{open:'Record cart venue receipt',confirm:'Confirm full cart amount received',paid:'Cash receipt recorded by merchant',reload:'Reload',unpaid:'Pay at venue — no receipt recorded',review:'Original needs review',cancel:'Cancel original cart'},es:{open:'Registrar cobro del carrito',confirm:'Confirmar cobro completo del carrito',paid:'Cobro registrado por el comercio',reload:'Volver a leer',unpaid:'Pago en local — sin cobro registrado',review:'El original necesita revisión',cancel:'Cancelar carrito original'}};
 const evidence=path.resolve('output',`cart-collection-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const [locale,mode]of[['zh','fresh'],['en','fresh'],['es','fresh'],['zh','lost'],['zh','identity'],['zh','review']])await t.test(`${width} ${locale} ${mode}`,async()=>{
  const origin='https://cart-receipt-browser.invalid',f=await fixtures.cartReviewFixture('on_site'),points=(await fixtures.cartReviewFixture()).result,siteId=f.f.siteId,text=words[locale];
  let current={...f.result,...(mode==='review'?{reviewRequired:true,cancellationAvailable:false}:{})},enabled=false,release;const writes=[],errors=[],foreign=[];
  const owner={type:'owner',siteId,authUserId:'synthetic-owner',principalKey:'owner:synthetic-owner',authorizationVersion:'owner',authorizationSource:'database',businessPermissions:[],collaborationPermissions:[],displayName:'Synthetic',email:'owner@synthetic.invalid'};
  const receipt=()=>({version:1,siteId,operationKey:current.operationKey,resourceKind:'order',resourceId:current.resourceId,replayed:false,amountMinor:current.dueMinor,currency:'eur',recordedAt:'2026-11-23T12:00:00Z'});
  const d={enabled:()=>true,actor:async()=>owner,site:async()=>f.f.site,call:async(name,args)=>{
   if(name.endsWith('read_v1'))return{data:structuredClone(current),error:null};assert.equal(name,'faolla_checkout_cart_collect_v1');writes.push(args);
   if(mode==='identity')await new Promise(r=>{release=r;});current={...current,cancellationAvailable:false,collection:{amountMinor:current.dueMinor,currency:'eur',recordedAt:receipt().recordedAt}};return{data:receipt(),error:null};
  }};
  const ownerScope=(await access.authorizeCheckoutOwner(new Request(origin),siteId,d)).identityKey;
  const covered={...f.result,resourceId:'covered-original',operationKey:'b'.repeat(64),dueMinor:0,discountMinor:f.result.grossMinor,couponCount:2,lines:f.result.lines.map(l=>({...l,dueMinor:0,discountMinor:l.grossMinor,couponCount:1}))};
  const resources=[current,points,covered].map(r=>({kind:'order',id:r.resourceId}));points.resourceId='points-original';resources[1].id='points-original';
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const q=route.request(),u=new URL(q.url());if(u.origin!==origin){foreign.push(u.href);return route.abort();}
   if(q.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(u.pathname==='/api/merchant-checkout/settlements')return route.fulfill({json:{ok:true,canRecordOnSiteReceipt:true,canRecordCartReceipt:enabled,snapshot:{version:3,siteId,rows:[current,points,covered].map(cart=>({kind:'order',id:cart.resourceId,result:null,cart,termsMatch:!cart.reviewRequired}))}}});
   if(u.pathname==='/api/member-checkout/cart/result')return route.fulfill({json:{ok:true,state:'confirmed',original:{kind:'cart',result:current}}});
   assert.equal(u.pathname,'/api/merchant-checkout/cart/collect');assert.deepEqual(q.postDataJSON(),{siteId,operationKey:current.operationKey,expectedUpdatedAt:current.resource.updatedAt,expectedDueMinor:2500,received:true});
   const response=await http.handleCartCollection(new Request(q.url(),{method:'POST',headers:{origin,'content-type':'application/json','x-checkout-owner-scope':ownerScope},body:q.postData()}),d);
   if(mode==='lost')return route.fulfill({status:503,json:{error:'checkout_unconfirmed'}});return route.fulfill({status:response.status,json:await response.json()}).catch(()=>{});
  });
  try{
   await page.goto(origin);await page.evaluate(v=>{Object.assign(window,v);},{__site:siteId,__operation:current.operationKey,__resources:resources,__locale:locale,__owner:ownerScope});await page.addStyleTag({content:css+'body{margin:0;font-family:Arial;background:#f3f6f9}'});await page.addScriptTag({content:script});
   await page.locator('[data-resource-id]').first().waitFor();assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);assert.equal(writes.length,0);
   enabled=true;await page.getByRole('button',{name:text.reload,exact:true}).click();await page.locator('[data-resource-id]').first().waitFor();
   if(mode==='review'){assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);await page.getByText(text.review,{exact:true}).waitFor();assert.equal(await page.getByText(text.paid,{exact:true}).count(),0);return;}
   assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),1);await page.getByRole('button',{name:text.open,exact:true}).click();await page.getByRole('region',{name:text.confirm,exact:true}).waitFor();
   await page.screenshot({path:path.join(evidence,`confirm-${width}-${locale}-${mode}.png`),fullPage:true});await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(b=>{b.click();b.click();});
   if(mode==='identity'){for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));assert.ok(release);assert.equal(writes.length,1);await page.evaluate(()=>window.__identity(null));release();await page.waitForFunction(()=>!document.querySelector('[data-resource-id]'));assert.equal(await page.locator('[data-cart-collection]').count(),0);return;}
   if(mode==='lost'){await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-resource-id]').count(),0);assert.equal(writes.length,1);await page.getByRole('button',{name:text.reload,exact:true}).click();}
   await page.getByText(text.paid,{exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(await page.getByRole('button',{name:text.open,exact:true}).count(),0);assert.equal(await page.getByText(text.unpaid,{exact:true}).count(),0);
   await page.evaluate(()=>window.__customer(true));await page.getByText(text.paid,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.cancel,exact:true}).count(),0);assert.equal(writes.length,1);
   await page.screenshot({path:path.join(evidence,`paid-${width}-${locale}-${mode}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}-${mode}.png`),fullPage:true});throw error;}finally{release?.();assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);await context.close();}
 });console.log(`CART_COLLECTION_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
