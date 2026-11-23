import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import fixtures from './fixtures/member-checkout-cart-review.ts';
import service from '../src/lib/merchantCheckoutCartSubmission.server.ts';
import planner from '../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';
import results from '../src/lib/merchantCheckoutCartResult.ts';
const {cartReviewFixture}=fixtures,{previewCartSubmission}=service,{cartSubmissionIdentity,planCartSubmission}=planner,{parseCartCheckoutResult}=results;

// Actual component/controller, browser native Web Locks and nonce storage.
// Intercepted SYNTHETIC HTTP only; no running Next/auth/PostgREST, real account,
// database or physical phone. Financial SQL is accepted in a separate harness.
test('cart review, line coupons and original recovery in three languages at desktop/mobile sizes',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MemberCartCheckoutPanel}from'./src/components/checkout/MemberCartCheckoutPanel';
 import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';
 function App(){const[account,setAccount]=useState('50010105');window.__account=setAccount;
 window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));
 return <MemberCartCheckoutPanel siteId={window.__selection.siteId} accountId={account} initialSelection={window.__selection} initialCustomer={window.__customer} locale={window.__locale}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";',{from:path.resolve('cart-review-acceptance.css')})).css;
 const labels={zh:{review:'核对整车与优惠券',confirm:'确认整车结算',agreed:'已核对全部商品、积分或金额及逐项取消规则',recover:'读取原单',done:'整车原单',cancel:'取消整车原单',confirmCancel:'确认取消整车（不能只取消其中一个商品）',closed:'原单已取消',name:'姓名',login:'请登录本人账号后使用会员结算。'},
 en:{review:'Review cart & coupons',confirm:'Confirm cart checkout',agreed:'I reviewed every item, points or amount, and each cancellation policy',recover:'Read original',done:'Original cart checkout',cancel:'Cancel whole original cart',confirmCancel:'Confirm whole-cart cancellation (not an individual item)',closed:'Original cancelled',name:'Name',login:'Sign in with your own account to use member checkout.'},
 es:{review:'Revisar carrito y cupones',confirm:'Confirmar pedido completo',agreed:'He revisado todos los artículos, puntos o importe y las reglas de cancelación',recover:'Consultar original',done:'Pedido original del carrito',cancel:'Cancelar carrito original completo',confirmCancel:'Confirmar cancelación completa (no de un artículo individual)',closed:'Original cancelado',name:'Nombre',login:'Inicia sesión con tu cuenta para usar el pago de socios.'}};
 const evidence=path.resolve('output',`cart-review-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])await t.test(`${width} ${locale}`,async()=>{
  const method=width===390?'points':'on_site',x=await cartReviewFixture(method),text=labels[locale],context=await browser.newContext({viewport:{width,height:860}}),page=await context.newPage();
  const writes=[],reads=[],errors=[],foreign=[];let original=null,readMode='unconfirmed';
  page.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(({selection,customer,locale})=>{window.__selection=selection;window.__customer=customer;window.__locale=locale;},{selection:x.f.request,customer:x.customer,locale});
  const snapshotFor=body=>{const snapshot=x.snapshotFor(body);snapshot.quoteSnapshot.databaseNow=new Date().toISOString();return snapshot;};
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(!url.pathname.startsWith('/api/member-checkout/cart/')){foreign.push(request.url());return route.abort();}
   const body=request.postDataJSON(),headers={'cache-control':'no-store'};
   if(url.pathname.endsWith('/preview')){
    reads.push(body);const response=await previewCartSubmission({request:body,principal:x.f.principal,authorize:async()=>x.f.principal,enabled:()=>true},async()=>({data:{replayed:false,snapshot:snapshotFor(body)},error:null}));
    return route.fulfill({status:200,headers,json:{ok:true,...response}});
   }
   if(url.pathname.endsWith('/submit')){
    writes.push(body);const identity=cartSubmissionIdentity(body,x.f.principal),prepared=await planCartSubmission(snapshotFor(body),identity,x.f.principal),p=prepared.plan;
    original=parseCartCheckoutResult({...x.result,operationKey:identity.operationKey,resourceId:p.record.id,...p.terms,lines:p.lines.map(l=>({...l,couponCount:l.couponClaims.length}))},{siteId:x.f.siteId,operationKey:identity.operationKey});
    return route.fulfill({status:503,headers,json:{error:'checkout_unconfirmed'}});
   }
   if(url.pathname.endsWith('/recover'))return route.fulfill({status:200,headers,json:readMode==='unconfirmed'?{ok:true,state:'unconfirmed'}:{ok:true,state:'confirmed',original:{kind:'cart',result:original}}});
   if(url.pathname.endsWith('/cancel')){
    writes.push(body);original={...original,closed:true,cancellationAvailable:false,resource:{...original.resource,status:'cancelled'},cancellation:{pointsReturned:original.lines.reduce((s,l)=>s+(l.returnPoints?l.points??0:0),0),couponsReturned:original.lines.reduce((s,l)=>s+(l.returnCoupons?l.couponCount:0),0),stockReleased:2,cancelledAt:new Date().toISOString()}};
    return route.fulfill({status:503,headers,json:{error:'checkout_unconfirmed'}});
   }
   throw new Error('unexpected synthetic endpoint');
  });
  const mount=async()=>{await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{
   await page.goto('https://cart.synthetic.invalid/');await mount();await page.getByRole('button',{name:text.review,exact:true}).click();
   await page.locator('[data-cart-review-line]').first().waitFor();assert.equal(await page.locator('[data-cart-review-line]').count(),2);assert.ok(await page.getByRole('button',{name:text.confirm,exact:true}).isDisabled());
   const firstChoice=page.locator('[data-cart-review-line]').first().getByRole('checkbox').first();
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/cart/preview')),firstChoice.check()]);
   await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled&&document.querySelectorAll('[data-cart-review-line]').length===2);
   assert.equal(reads.length,2);assert.equal(reads[1].lines.flatMap(l=>l.couponClaims??[]).length,1);
   assert.equal(await page.getByRole('textbox',{name:text.name,exact:true}).inputValue(),x.customer.name);
   await page.getByRole('checkbox',{name:text.agreed,exact:true}).check();
   assert.ok(await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{const s=getComputedStyle(button);return s.color!==s.backgroundColor&&s.backgroundColor!=='rgba(0, 0, 0, 0)';}));
   await page.screenshot({path:path.join(evidence,`review-${width}-${locale}.png`),fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(button=>{button.click();button.click();});
   await page.getByRole('button',{name:text.recover,exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].lines.length,2);
   const key=`faolla-member-checkout-v2:${x.f.siteId}:50010105`,stored=await page.evaluate(key=>localStorage.getItem(key),key);
   assert.deepEqual(Object.keys(JSON.parse(stored)).sort(),['nonce','version']);assert.ok(!/Synthetic|synthetic@|offer|coupon|points|phone/.test(stored));assert.notEqual(reads[1].nonce,writes[0].nonce);
   await page.reload();await mount();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.confirm,exact:true}).count(),0);assert.equal(writes.length,1);
   readMode='confirmed';await page.getByRole('button',{name:text.recover,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(writes.length,1);
   await page.getByRole('button',{name:text.cancel,exact:true}).click();await page.getByRole('button',{name:text.confirmCancel,exact:true}).evaluate(button=>{button.click();button.click();});
   await page.getByRole('alert').waitFor();assert.equal(await page.locator('[data-cart-payment-status]').count(),0);assert.equal(writes.length,2);
   await page.getByRole('button',{name:text.recover,exact:true}).click();await page.getByText(text.closed,{exact:true}).waitFor();
   await page.screenshot({path:path.join(evidence,`closed-${width}-${locale}.png`),fullPage:true,animations:'disabled'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.evaluate(()=>window.__identity());await page.getByRole('alert').waitFor();assert.equal(await page.getByText(original.resourceId,{exact:true}).count(),0);
   await page.evaluate(()=>window.__account(null));await page.getByText(text.login,{exact:true}).waitFor();assert.equal(await page.getByText(original.resourceId,{exact:true}).count(),0);assert.equal(await page.getByText(x.customer.name,{exact:true}).count(),0);
   assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}.png`),fullPage:true});throw error;}
  finally{await context.close();}
 });console.log(`CART_REVIEW_BROWSER_EVIDENCE=${evidence}`);
 }finally{await browser.close();}
});
