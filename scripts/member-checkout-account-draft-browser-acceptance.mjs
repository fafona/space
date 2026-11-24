import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import fixtureModule from './fixtures/member-checkout-cart-review.ts';
import plannerModule from '../src/lib/merchantCheckoutCartSubmissionPlan.server.ts';
import previewModule from '../src/lib/merchantCheckoutCartSubmission.server.ts';
import resultModule from '../src/lib/merchantCheckoutCartResult.ts';
const {cartReviewFixture}=fixtureModule,{cartSubmissionIdentity,planCartSubmission}=plannerModule,
  {previewCartSubmission}=previewModule,{parseCartCheckoutResult}=resultModule;
// Actual ProductBlock/wrapper/panel/controller + native locks/localStorage.
// Synthetic intercepted identity/catalog/HTTP only; no live user, DB or charge.
test('owned actual cart isolates identity and serializes every draft writer with financial checkout',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';
 import Products from'./src/components/checkout/MemberProductCartBlock';import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';
 window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));
 createRoot(document.getElementById('root')).render(<Products products={window.__products} runtimeSiteId={window.__site} runtimeBlockId="products" runtimeOrderManagementEnabled={true} productPricePrefix="€"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-ports',setup(b){
  b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));
  b.onResolve({filter:/authSessionRecovery$/},()=>({path:'session',namespace:'synthetic'}));b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'js',contents:p==='i18n'?`export const useI18n=()=>({locale:window.__locale});`:p==='traffic'?`export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};`:p==='session'?`export const resolveFrontendAuthPayload=async()=>{window.__oldProfileCalls=(window.__oldProfileCalls||0)+1;return null;};`:`export default function Image(){return null;}`}));
 }}]});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";\n@source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('owned-cart-acceptance.css')})).css;
 const evidence=path.resolve('output',`account-cart-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});
 const copy={zh:{begin:'核对会员积分与券',retry:'重新核验',review:'核对整车与优惠券',confirm:'确认整车结算',agreed:'已核对全部商品、积分或金额及逐项取消规则',done:'整车原单',ack:'已核对原单，开始另一单',kept:'已核对原单。联系人与未提交商品保留在购物车中。'},
 en:{begin:'Review member points & coupons',retry:'Recheck',review:'Review cart & coupons',confirm:'Confirm cart checkout',agreed:'I reviewed every item, points or amount, and each cancellation policy',done:'Original cart checkout',ack:'Reviewed — start another',kept:'Original checked. Contacts and unsubmitted products remain in the cart.'},
 es:{begin:'Revisar puntos y cupones',retry:'Verificar',review:'Revisar carrito y cupones',confirm:'Confirmar pedido completo',agreed:'He revisado todos los artículos, puntos o importe y las reglas de cancelación',done:'Pedido original del carrito',ack:'Revisado — empezar otro',kept:'Original verificado. Se conservan los contactos y productos no enviados.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])for(const mode of locale==='zh'?['fresh','accounts','crossTab','storage','legacyOriginal','wrongOwner','ackLost','staleDraft','retainedNonce','ackDraftChanged','ackDraftLost','ackDraftUnreadable','ackLostDraftChanged','ackLostSamePage']:['fresh','ackDraftChanged'])await t.test(`${width} ${locale} ${mode}`,async()=>{
  const method=width===1280&&mode.startsWith('ack')&&mode!=='ackLost'?'on_site':'points';
  const x=await cartReviewFixture(method),text=copy[locale],context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  let account=x.f.principal.accountId,original=null,acknowledged=false,changedDraft=null,savedDraft=null;const requests=[],acks=[],errors=[],foreign=[];
  const products=x.result.lines.map(l=>({id:l.productId,name:l.title,code:l.productId,price:'10',description:'Synthetic',imageUrl:'',thumbnailUrl:'',tag:''}));products.push({id:'keep',name:'Unselected product',code:'keep',price:'5',description:'',imageUrl:'',thumbnailUrl:'',tag:''});
  const scope={siteId:x.f.siteId,blockId:'products',accountId:account},key=`merchant-space:product-cart:v2:${x.f.siteId}:products:${account}`,legacyKey=`merchant-space:product-cart:v1:${x.f.siteId}:products`,nonceKey=`faolla-member-checkout-v2:${x.f.siteId}:${account}`;
  const items=products.map((p,i)=>({productId:p.id,product:p,quantity:1,checked:i<2,unitPrice:Number(p.price),unitPriceText:`€${p.price}`})),customer={name:'Owned synthetic contact',phone:x.customer.phone,email:x.customer.email,note:x.customer.note};
  const legacy=JSON.stringify({items,customer:{name:'Private prior user',email:'do-not-import@synthetic.invalid'},clientRequestId:mode==='legacyOriginal'?'unreviewed-old-order':''});
  const envelope=JSON.stringify({version:1,scope:mode==='wrongOwner'?{...scope,accountId:'59999999'}:scope,revision:1,data:{items,customer,clientRequestId:''}});
  await context.addInitScript(({site,products,key,legacyKey,envelope,legacy,locale,mode})=>{
   window.__site=site;window.__products=products;window.__locale=locale;
   if(!localStorage.getItem('synthetic-owned-seeded')){localStorage.setItem(legacyKey,legacy);if(mode!=='accounts')localStorage.setItem(key,envelope);localStorage.setItem('synthetic-owned-seeded','1');}
  },{site:x.f.siteId,products,key,legacyKey,envelope,legacy,locale,mode});
  const reviewed=()=>({operationKey:original.operationKey,generation:1,reviewHash:'a'.repeat(64),reviewRequired:false,original:{kind:'cart',result:original},acknowledged});
  const snapshotFor=body=>{const s=x.snapshotFor(body);s.quoteSnapshot.databaseNow=new Date().toISOString();return s;};
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.pathname==='/api/member-checkout/cart/entry')return route.fulfill({status:200,json:{ok:true,intent:true,ownedDraft:true,entry:{siteId:x.f.siteId,accountId:account,query:request.postDataJSON(),offers:x.result.lines.map(l=>({offerId:l.offerId,offerRevision:l.offerRevision,title:l.title,maxQuantity:99,...(method==='on_site'?{onSiteOnly:true}:{}),source:{kind:'order',productId:l.productId}}))}}});
   if(!/^\/api\/member-checkout\/(cart|intent)\//.test(url.pathname)){foreign.push(url.pathname);return route.abort();}
   assert.equal(request.headers()['x-checkout-account-scope'],account);const body=request.postDataJSON();
   if(url.pathname.endsWith('intent/pending'))return route.fulfill({status:200,json:{ok:true,snapshot:{version:1,siteId:x.f.siteId,pending:original&&!acknowledged?reviewed():null}}});
   if(url.pathname.endsWith('intent/review'))return route.fulfill({status:200,json:{ok:true,review:original?reviewed():null}});
   if(url.pathname.endsWith('intent/acknowledge')){acks.push(body);acknowledged=true;assert.equal(acks.length,1);
    savedDraft=await page.evaluate(k=>localStorage.getItem(k),key);const saved=JSON.parse(savedDraft);assert.equal(saved.data.items.length,1,'owned draft durable before server ack');
    if(mode==='ackDraftChanged')changedDraft=await page.evaluate(k=>{const value=JSON.parse(localStorage.getItem(k));value.revision++;value.data.customer.name='Newer local contact';const raw=JSON.stringify(value);localStorage.setItem(k,raw);return raw;},key);
    if(mode==='ackDraftLost')await page.evaluate(k=>localStorage.removeItem(k),key);
    if(mode==='ackDraftUnreadable')await page.evaluate(k=>{const get=Storage.prototype.getItem;window.__draftGet=get;Storage.prototype.getItem=function(name){if(name===k)throw new DOMException('synthetic read refusal');return get.call(this,name);};},key);
    return route.fulfill(['ackLost','ackLostDraftChanged','ackLostSamePage'].includes(mode)?{status:503,json:{error:'checkout_intent_unconfirmed'}}:{status:200,json:{ok:true,acknowledgement:{version:1,siteId:x.f.siteId,operationKey:original.operationKey,generation:1,acknowledged:true,replayed:false}}});}
   if(url.pathname.endsWith('/preview'))return route.fulfill({status:200,json:{ok:true,...await previewCartSubmission({request:body,principal:x.f.principal,authorize:async()=>x.f.principal,enabled:()=>true},async()=>({data:{replayed:false,snapshot:snapshotFor(body)},error:null}))}});
   if(url.pathname.endsWith('/submit')){requests.push(body);assert.equal(original,null);const id=cartSubmissionIdentity(body,x.f.principal),p=(await planCartSubmission(snapshotFor(body),id,x.f.principal)).plan;
    const saved=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(saved.data.customer.email,body.customer.email);
    original=parseCartCheckoutResult({...x.result,operationKey:id.operationKey,resourceId:p.record.id,...p.terms,lines:p.lines.map(l=>({...l,couponCount:l.couponClaims.length}))},{siteId:x.f.siteId,operationKey:id.operationKey});
    return route.fulfill({status:200,json:{ok:true,replayed:false,result:original}});}
   if(url.pathname.endsWith('/recover'))return route.fulfill({status:200,json:{ok:true,state:'confirmed',original:{kind:'cart',result:original}}});
   throw new Error('unexpected owned synthetic route');
  });
  const settled=async p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const mount=async p=>{p.on('pageerror',e=>errors.push(e.message));await p.goto('https://owned.synthetic.invalid/');await p.addStyleTag({content:css});const reply=p.waitForResponse(r=>r.url().endsWith('/api/member-checkout/cart/entry'));await p.addScriptTag({content:bundle.outputFiles[0].text});await reply;await settled(p);};
  const identity=async()=>{const reply=page.waitForResponse(r=>r.url().endsWith('/api/member-checkout/cart/entry'));await page.evaluate(()=>window.__identity());await reply;await settled(page);};
  const open=async p=>{await p.getByRole('button',{name:'打开购物车',exact:true}).click();await p.locator('[data-cart-member-entry]').waitFor();};
  try{await mount(page);await open(page);
   await page.waitForFunction(begin=>document.querySelector('[data-cart-draft-error]')||[...document.querySelectorAll('button')].some(b=>b.textContent===begin),text.begin);
   if(mode!=='wrongOwner'&&await page.locator('[data-cart-draft-error]').count())assert.fail(await page.locator('[data-cart-draft-error]').first().getAttribute('data-cart-draft-error'));
   if(mode==='accounts'){
    await page.getByRole('button',{name:text.begin,exact:true}).waitFor();assert.equal(await page.getByText('Private prior user',{exact:true}).count(),0);assert.equal(await page.getByText('购物车还是空的，先从产品列表里加购吧。',{exact:true}).count(),1);
    await page.getByRole('button',{name:'返回商品列表',exact:true}).click();await page.getByRole('button',{name:'增加购买数量',exact:true}).first().click();
    await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)||'null')?.data.items.length===1,key);
    account='50010106';await identity();await open(page);await page.getByRole('button',{name:text.begin,exact:true}).waitFor();
    assert.equal(await page.getByText('购物车还是空的，先从产品列表里加购吧。',{exact:true}).count(),1);assert.equal(await page.evaluate(k=>localStorage.getItem(k.replace(/\d{8}$/,'50010106')),key),null);
    account=scope.accountId;await identity();await open(page);await page.getByRole('button',{name:text.begin,exact:true}).waitFor();assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).data.items.length,1);return;
   }
   if(mode==='wrongOwner'){await page.getByRole('status').filter({hasText:'购物车尚未可靠保存'}).waitFor();assert.equal(await page.getByText(customer.name,{exact:true}).count(),0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),envelope);return;}
   await page.getByRole('button',{name:text.begin,exact:true}).waitFor();
   if(mode==='retainedNonce'){
    await page.evaluate(k=>localStorage.setItem(k,JSON.stringify({version:1,nonce:'33333333-3333-4333-8333-333333333333'})),nonceKey);
    await page.getByRole('button',{name:'+',exact:true}).first().click();await page.locator('[data-cart-draft-error="checkout_other_tab"]').waitFor();
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),envelope);assert.equal(requests.length,0);assert.equal(acks.length,0);return;
   }
   if(mode==='legacyOriginal'){await page.getByRole('alert').filter({hasText:'原普通订单编号'}).waitFor();await page.getByRole('button',{name:text.begin,exact:true}).click();assert.equal(await page.locator('[data-member-cart-checkout]').count(),0);return;}
   if(mode==='crossTab'){
    const other=await context.newPage();await mount(other);await open(other);await other.getByRole('button',{name:text.begin,exact:true}).waitFor();
    await page.getByRole('button',{name:'+',exact:true}).first().click();await page.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).data.items[0].quantity===2,key);
    await other.getByRole('button',{name:'打开购物车',exact:true}).click();await other.getByRole('button',{name:text.retry,exact:true}).waitFor();const reply=other.waitForResponse(r=>r.url().endsWith('/api/member-checkout/cart/entry'));await other.getByRole('button',{name:text.retry,exact:true}).click();await reply;await settled(other);await open(other);await other.getByRole('button',{name:text.begin,exact:true}).waitFor();
    const qty=other.locator('input[inputmode="numeric"]').first();assert.equal(await qty.inputValue(),'2');await other.getByRole('button',{name:'+',exact:true}).first().click();
    await other.waitForFunction(k=>JSON.parse(localStorage.getItem(k)).data.items[0].quantity===3,key);await other.close();return;
   }
   await page.getByRole('button',{name:text.begin,exact:true}).click();await page.getByRole('button',{name:text.review,exact:true}).click();await page.locator('[data-cart-review-line]').first().waitFor();
   if(mode==='storage')await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('merchant-space:product-cart:v2:'))throw new DOMException('synthetic refusal');return set.call(this,k,v);};});
   let intervening=null;
   if(mode==='staleDraft'){intervening=await page.evaluate(k=>{const value=JSON.parse(localStorage.getItem(k));value.revision++;value.data.customer.name='Newer local contact';const raw=JSON.stringify(value);localStorage.setItem(k,raw);return raw;},key);}
   await page.getByRole('checkbox',{name:text.agreed,exact:true}).check();await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(b=>{b.click();b.click();});
   if(mode==='storage'||mode==='staleDraft'){await page.getByRole('alert').waitFor();assert.equal(requests.length,0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),intervening??envelope);return;}
   await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(requests.length,1);assert.equal(original.method,method);
   if(method==='on_site')assert.equal(original.capturedMinor,0,'draft acknowledgement is never cash collection');
   await page.getByRole('button',{name:text.ack,exact:true}).evaluate(b=>{b.click();b.click();});
   if(['ackLostDraftChanged','ackLostSamePage'].includes(mode)){
    await page.getByRole('alert').waitFor();assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
    if(mode==='ackLostDraftChanged')changedDraft=await page.evaluate(k=>{const value=JSON.parse(localStorage.getItem(k));value.revision++;value.data.customer.note='Keep newer note';const raw=JSON.stringify(value);localStorage.setItem(k,raw);return raw;},key);
    await page.getByRole('button',{name:'读取原单',exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();
    await page.getByRole('button',{name:text.ack,exact:true}).click();
   }
   if(['ackDraftChanged','ackDraftLost','ackDraftUnreadable','ackLostDraftChanged'].includes(mode)){
    await page.waitForFunction(()=>!document.querySelector('[data-member-cart-checkout]')||document.querySelector('[data-member-cart-checkout] [role="alert"]'));
    assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null,'a changed retained draft must not release the original reference');
    await page.getByRole('alert').filter({hasText:locale==='zh'?'购物车草稿已变化':locale==='es'?'El carrito guardado cambió':'The saved cart changed'}).waitFor();
    assert.equal(await page.getByRole('button',{name:text.confirm,exact:true}).count(),0);assert.equal(await page.locator('[data-cart-payment-status]').count(),0);
    if(mode==='ackDraftUnreadable'){await page.evaluate(()=>{Storage.prototype.getItem=window.__draftGet;});changedDraft=savedDraft;}
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),changedDraft);assert.equal(acks.length,1);assert.equal(requests.length,1);
    await page.screenshot({path:path.join(evidence,`${width}-${locale}-${mode}-retained.png`),fullPage:true,animations:'disabled'});return;
   }
   if(mode==='ackLost'){await page.getByRole('alert').waitFor();assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);await page.reload();await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await open(page);await page.getByRole('button',{name:text.retry,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();await page.getByRole('button',{name:text.ack,exact:true}).click();}
   await page.getByText(text.kept,{exact:true}).waitFor();assert.equal(acks.length,1);assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
   const saved=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(saved.data.items.length,1);assert.equal(saved.data.customer.email,x.customer.email);assert.equal(saved.revision,mode==='ackLost'?4:3,'same-frame clicks must not repeat draft preparation or cleanup');
   assert.equal(await page.evaluate(k=>localStorage.getItem(k),legacyKey),legacy);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   await page.screenshot({path:path.join(evidence,`${width}-${locale}-${mode}.png`),fullPage:true,animations:'disabled'});
  }catch(error){const diagnostic=page.locator('[data-cart-draft-error]');console.log('OWNED_DRAFT_ERROR',await diagnostic.count()?await diagnostic.first().getAttribute('data-cart-draft-error'):null);await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}-${mode}.png`),fullPage:true});throw error;}
  finally{try{assert.equal(await page.evaluate(()=>window.__oldProfileCalls||0),0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),legacyKey),legacy);assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);}finally{await context.close();}}
 });console.log(`ACCOUNT_CART_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
