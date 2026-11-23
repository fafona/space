import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import test from 'node:test';
import {build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
import fixtureModule from'./fixtures/member-checkout-cart-review.ts';import plannerModule from'../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';
import previewModule from'../src/lib/merchantCheckoutCartSubmission.server.ts';import resultModule from'../src/lib/merchantCheckoutCartResult.ts';
const{cartReviewFixture}=fixtureModule,{cartSubmissionIdentity,planCartSubmission}=plannerModule,{previewCartSubmission}=previewModule,{parseCartCheckoutResult}=resultModule;
// Real ProductBlock + gated wrapper/panel/controller/native locks/storage.
// Only transport/session/catalog are synthetic. No live Next/PostgREST,
// production users/data, physical phones, Stripe or mail.
test('gated actual cart resolves cross-device originals and lost acknowledgement without duplicate finance',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Products from'./src/components/checkout/MemberProductCartBlock';
 import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));
 createRoot(document.getElementById('root')).render(<Products products={window.__products} runtimeSiteId={window.__site} runtimeBlockId="products" runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled={true} productPricePrefix="€"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-session-only',setup(b){
  b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));
  b.onResolve({filter:/authSessionRecovery$/},()=>({path:'session',namespace:'synthetic'}));b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'js',contents:p==='i18n'?`export const useI18n=()=>({locale:window.__locale});`:p==='traffic'?`export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};`:p==='session'?`export const resolveFrontendAuthPayload=async()=>null;`:`export default function Image(){return null;}`}));
 }}]});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";\n@source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('intent-cart-acceptance.css')})).css;
 const evidence=path.resolve('output',`intent-cart-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});
 const copy={zh:{begin:'核对会员积分与券',retry:'重新核验',review:'核对整车与优惠券',confirm:'确认整车结算',agreed:'已核对全部商品、积分或金额及逐项取消规则',done:'整车原单',recover:'读取原单',ack:'已核对原单，开始另一单',kept:'已核对原单。联系人与未提交商品保留在购物车中。'},
 en:{begin:'Review member points & coupons',retry:'Recheck',review:'Review cart & coupons',confirm:'Confirm cart checkout',agreed:'I reviewed every item, points or amount, and each cancellation policy',done:'Original cart checkout',recover:'Read original',ack:'Reviewed — start another',kept:'Original checked. Contacts and unsubmitted products remain in the cart.'},
 es:{begin:'Revisar puntos y cupones',retry:'Verificar',review:'Revisar carrito y cupones',confirm:'Confirmar pedido completo',agreed:'He revisado todos los artículos, puntos o importe y las reglas de cancelación',done:'Pedido original del carrito',recover:'Consultar original',ack:'Revisado — empezar otro',kept:'Original verificado. Se conservan los contactos y productos no enviados.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])for(const mode of locale==='zh'?['fresh','ackLost','remote','reload','metadataFail','postMetadataFail','identity','changed']:['fresh'])await t.test(`${width} ${locale} ${mode}`,async()=>{
  const x=await cartReviewFixture(width===390?'points':'on_site'),text=copy[locale],context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const products=x.result.lines.map(l=>({id:l.productId,name:l.title,code:l.productId,price:'10',description:'Synthetic product',imageUrl:'',thumbnailUrl:'',tag:''}));products.push({id:'keep',name:'Unselected product',code:'keep',price:'5'});
  const key=`merchant-space:product-cart:v1:${x.f.siteId}:products`,nonceKey=`faolla-member-checkout-v2:${x.f.siteId}:${x.f.principal.accountId}`;
  const items=products.map((p,i)=>({productId:p.id,product:p,quantity:1,checked:i<2,unitPrice:Number(p.price),unitPriceText:`€${p.price}`}));
  await context.addInitScript(({site,products,key,items,customer,locale})=>{window.__site=site;window.__products=products;window.__locale=locale;
   if(!localStorage.getItem('synthetic-seeded')){localStorage.setItem(key,JSON.stringify({items,customer,clientRequestId:''}));localStorage.setItem('synthetic-seeded','1');}
  },{site:x.f.siteId,products,key,items,customer:x.customer,locale});
  const writes=[],acks=[],errors=[],foreign=[];let original=mode==='remote'?x.result:null,acknowledged=false,hash='a'.repeat(64);
  page.on('pageerror',e=>errors.push(e.message));
  const reviewed=()=>({operationKey:original.operationKey,generation:1,reviewHash:hash,reviewRequired:false,original:{kind:'cart',result:original},acknowledged});
  const snapshotFor=body=>{const v=x.snapshotFor(body);v.quoteSnapshot.databaseNow=new Date().toISOString();return v;};
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.pathname==='/api/member-checkout/cart/entry'){const query=request.postDataJSON();return route.fulfill({status:200,json:{ok:true,intent:true,entry:{siteId:x.f.siteId,accountId:x.f.principal.accountId,query,
    offers:x.result.lines.map(l=>({offerId:l.offerId,offerRevision:l.offerRevision,title:l.title,maxQuantity:99,...(width===1280?{onSiteOnly:true}:{}),source:{kind:'order',productId:l.productId}}))}}});}
   if(!/^\/api\/member-checkout\/(cart|intent)\//.test(url.pathname)){foreign.push(url.pathname);return route.abort();}
   assert.equal(request.headers()['x-checkout-account-scope'],x.f.principal.accountId);const body=request.postDataJSON();
   if(url.pathname.endsWith('intent/pending'))return route.fulfill(mode==='metadataFail'?{status:503,json:{error:'checkout_intent_unavailable'}}:{status:200,json:{ok:true,snapshot:{version:1,siteId:x.f.siteId,pending:original&&!acknowledged?reviewed():null}}});
   if(url.pathname.endsWith('intent/review'))return route.fulfill(mode==='postMetadataFail'?{status:409,json:{error:'checkout_original_pending'}}:{status:200,json:{ok:true,review:original?reviewed():null}});
   if(url.pathname.endsWith('intent/acknowledge')){assert.equal(body.operationKey,original.operationKey);assert.equal(body.reviewHash,hash);assert.equal(acks.length,0);acks.push(body);acknowledged=true;
    const draft=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(draft.items.length,['remote','reload'].includes(mode)?3:1,'draft must be durably processed/preserved BEFORE ack dispatch');
    return route.fulfill(mode==='ackLost'?{status:503,json:{error:'checkout_intent_unconfirmed'}}:{status:200,json:{ok:true,acknowledgement:{version:1,siteId:x.f.siteId,operationKey:original.operationKey,generation:1,acknowledged:true,replayed:false}}});}
   if(url.pathname.endsWith('/preview')){const result=await previewCartSubmission({request:body,principal:x.f.principal,authorize:async()=>x.f.principal,enabled:()=>true},async()=>({data:{replayed:false,snapshot:snapshotFor(body)},error:null}));return route.fulfill({status:200,json:{ok:true,...result}});}
   if(url.pathname.endsWith('/submit')){assert.equal(original,null);writes.push(body);const identity=cartSubmissionIdentity(body,x.f.principal),prepared=await planCartSubmission(snapshotFor(body),identity,x.f.principal),p=prepared.plan;
    original=parseCartCheckoutResult({...x.result,operationKey:identity.operationKey,resourceId:p.record.id,...p.terms,lines:p.lines.map(l=>({...l,couponCount:l.couponClaims.length}))},{siteId:x.f.siteId,operationKey:identity.operationKey});
    return route.fulfill({status:200,json:{ok:true,replayed:false,result:original}});}
   if(url.pathname.endsWith('/recover'))return route.fulfill({status:200,json:original?{ok:true,state:'confirmed',original:{kind:'cart',result:original}}:{ok:true,state:'unconfirmed'}});
   throw new Error('unexpected synthetic intent route');
  });
  const mount=async()=>{await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{await page.goto('https://cart.synthetic.invalid/');await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:text.begin,exact:true}).click();
   if(mode==='metadataFail'){await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:text.review,exact:true}).count(),0);assert.equal(writes.length,0);assert.equal(acks.length,0);
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).items.length,3);return;}
   if(mode!=='remote'){await page.getByRole('button',{name:text.review,exact:true}).click();await page.locator('[data-cart-review-line]').first().waitFor();await page.getByRole('checkbox',{name:text.agreed,exact:true}).check();
    await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(b=>{b.click();b.click();});}
   if(mode==='postMetadataFail'){await page.getByRole('alert').waitFor();assert.equal(writes.length,1);assert.equal(acks.length,0);assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
    assert.equal(await page.getByRole('button',{name:text.ack,exact:true}).count(),0);assert.equal(await page.locator('[data-cart-payment-status]').count(),0);assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).items.length,3);
    await page.screenshot({path:path.join(evidence,`${width}-${locale}-${mode}-unknown.png`),fullPage:true,animations:'disabled'});return;}
   await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(writes.length,mode==='remote'?0:1);assert.equal(acks.length,0);
   if(mode==='remote')assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
   else assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
   if(mode==='identity'){await page.evaluate(()=>window.__identity());await page.waitForFunction(()=>!document.querySelector('[data-member-cart-checkout]'));assert.equal(acks.length,0);assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);return;}
   if(mode==='reload'){await page.reload();await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:text.retry,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(acks.length,0);}
   if(mode==='changed'){hash='b'.repeat(64);await page.getByRole('button',{name:text.ack,exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(acks.length,0);assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).items.length,3);}
   await page.screenshot({path:path.join(evidence,`${width}-${locale}-${mode}-original.png`),fullPage:true,animations:'disabled'});
   await page.getByRole('button',{name:text.ack,exact:true}).click();
   if(mode==='ackLost'){await page.getByRole('alert').waitFor();assert.equal(acks.length,1);assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
    await page.reload();await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:text.retry,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();await page.getByRole('button',{name:text.ack,exact:true}).click();}
   await page.getByText(text.kept,{exact:true}).waitFor();assert.equal(acks.length,1);assert.equal(writes.length,mode==='remote'?0:1);
   const draft=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(draft.items.length,['remote','reload'].includes(mode)?3:1);assert.equal(draft.customer.email,x.customer.email);
   assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}-${mode}.png`),fullPage:true});throw error;}
  finally{try{assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);}finally{await context.close();}}
 });console.log(`INTENT_CART_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
