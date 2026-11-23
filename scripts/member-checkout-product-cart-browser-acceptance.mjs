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
const {cartReviewFixture}=fixtureModule,{cartSubmissionIdentity,planCartSubmission}=plannerModule,{previewCartSubmission}=previewModule,{parseCartCheckoutResult}=resultModule;
// Actual ProductBlock, gated wrapper, review/controller, native storage/locks.
// Synthetic intercepted transport and session/catalog stubs, never live users,
// running Next/PostgREST, physical phone, Stripe or production data.
test('real product cart integration preserves originals, drafts and exact selections',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import Products from'./src/components/checkout/MemberProductCartBlock';
 import{SERVICE_IDENTITY_CHANGED}from'./src/components/service-center/serviceCenterClient';
 function App(){const[products,setProducts]=useState(window.__products),[loading,setLoading]=useState(false);window.__setProducts=setProducts;window.__setLoading=setLoading;window.__identity=()=>window.dispatchEvent(new Event(SERVICE_IDENTITY_CHANGED));return <Products products={products} runtimeSiteId={window.__site} runtimeBlockId="products" runtimeCatalogViewport={innerWidth<600?'mobile':'desktop'} runtimeOrderManagementEnabled={true} runtimeUseOperatingCatalog={loading} runtimeCatalogOverride={loading?{status:'loading',catalog:null}:undefined} productPricePrefix="€"/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-session-only',setup(b){
  b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));
  b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));
  b.onResolve({filter:/authSessionRecovery$/},()=>({path:'session',namespace:'synthetic'}));
  b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'js',contents:p==='i18n'?`export const useI18n=()=>({locale:window.__locale});`:p==='traffic'?`export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};`:p==='session'?`export const resolveFrontendAuthPayload=async()=>null;`:`export default function Image(){return null;}`}));
 }}]});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/*.tsx";\n@source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('product-cart-acceptance.css')})).css;
 const evidence=path.resolve('output',`product-cart-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});
 const copy={zh:{begin:'核对会员积分与券',retry:'重新核验',review:'核对整车与优惠券',confirm:'确认整车结算',agreed:'已核对全部商品、积分或金额及逐项取消规则',done:'整车原单',name:'姓名',recover:'读取原单',ack:'已核对原单，开始另一单',kept:'已核对原单。联系人与未提交商品保留在购物车中。'},
 en:{begin:'Review member points & coupons',retry:'Recheck',review:'Review cart & coupons',confirm:'Confirm cart checkout',agreed:'I reviewed every item, points or amount, and each cancellation policy',done:'Original cart checkout',name:'Name',recover:'Read original',ack:'Reviewed — start another',kept:'Original checked. Contacts and unsubmitted products remain in the cart.'},
 es:{begin:'Revisar puntos y cupones',retry:'Verificar',review:'Revisar carrito y cupones',confirm:'Confirmar pedido completo',agreed:'He revisado todos los artículos, puntos o importe y las reglas de cancelación',done:'Pedido original del carrito',name:'Nombre',recover:'Consultar original',ack:'Revisado — empezar otro',kept:'Original verificado. Se conservan los contactos y productos no enviados.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh','en','es'])for(const mode of locale==='zh'?['fresh','lost','storage','source','legacy','empty','foreign','identity']:['fresh'])await t.test(`${width} ${locale} ${mode}`,async()=>{
  const x=await cartReviewFixture(width===390?'points':'on_site'),text=copy[locale],context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  const products=x.result.lines.map(l=>({id:l.productId,name:l.title,code:l.productId,price:'10',description:'Synthetic product',imageUrl:'',thumbnailUrl:'',tag:''}));products.push({id:'keep',name:'Unselected product',code:'keep',price:'5'});
  const key=`merchant-space:product-cart:v1:${x.f.siteId}:products`,nonceKey=`faolla-member-checkout-v2:${x.f.siteId}:${x.f.principal.accountId}`;
  const items=products.map((p,i)=>({productId:p.id,product:p,quantity:1,checked:i<2,unitPrice:Number(p.price),unitPriceText:`€${p.price}`}));
  await context.addInitScript(({site,products,key,items,customer,locale,mode,nonceKey})=>{window.__site=site;window.__products=products;window.__locale=locale;
   if(!localStorage.getItem('synthetic-seeded')){localStorage.setItem(key,JSON.stringify({items,customer,clientRequestId:mode==='legacy'?'original-legacy-request':''}));localStorage.setItem('synthetic-seeded','1');
    if(mode==='empty')localStorage.setItem(nonceKey,JSON.stringify({version:1,nonce:'33333333-3333-4333-8333-333333333333'}));}
  },{site:x.f.siteId,products,key,items,customer:x.customer,locale,mode,nonceKey});
  const writes=[],errors=[],foreign=[];let original=mode==='empty'?x.result:null,confirmed=false;
  page.on('pageerror',e=>errors.push(e.message));
  const snapshotFor=body=>{const v=x.snapshotFor(body);v.quoteSnapshot.databaseNow=new Date().toISOString();return v;};
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.pathname==='/api/member-checkout/cart/entry'){const query=request.postDataJSON();return route.fulfill({status:200,json:{ok:true,entry:{siteId:x.f.siteId,accountId:x.f.principal.accountId,query,offers:mode==='empty'?[]:x.result.lines.map(l=>({offerId:l.offerId,offerRevision:l.offerRevision,title:l.title,maxQuantity:99,...(width===1280?{onSiteOnly:true}:{}),source:{kind:'order',productId:l.productId}}))}}});}
   if(!url.pathname.startsWith('/api/member-checkout/cart/')){foreign.push(url.pathname);return route.abort();}
   const body=request.postDataJSON();
   if(url.pathname.endsWith('/preview')){const result=await previewCartSubmission({request:body,principal:x.f.principal,authorize:async()=>x.f.principal,enabled:()=>true},async()=>({data:{replayed:false,snapshot:snapshotFor(body)},error:null}));return route.fulfill({status:200,json:{ok:true,...result}});}
   if(url.pathname.endsWith('/submit')){writes.push(body);const identity=cartSubmissionIdentity(body,x.f.principal),prepared=await planCartSubmission(snapshotFor(body),identity,x.f.principal),p=prepared.plan;
    original=parseCartCheckoutResult({...x.result,operationKey:identity.operationKey,resourceId:p.record.id,...p.terms,lines:p.lines.map(l=>({...l,couponCount:l.couponClaims.length}))},{siteId:x.f.siteId,operationKey:identity.operationKey});
    return mode==='lost'?route.fulfill({status:503,json:{error:'checkout_unconfirmed'}}):route.fulfill({status:200,json:{ok:true,replayed:false,result:original}});}
   if(url.pathname.endsWith('/recover'))return route.fulfill({status:200,json:original&&(mode!=='lost'||confirmed)?{ok:true,state:'confirmed',original:{kind:'cart',result:original}}:{ok:true,state:'unconfirmed'}});
   throw new Error('unexpected synthetic route');
  });
  const mount=async()=>{await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{await page.goto('https://cart.synthetic.invalid/');await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();
   if(mode==='legacy'){await page.getByText('购物车保留着原普通订单编号，请先核对该订单，不能另建会员结算。',{exact:true}).waitFor();assert.equal(writes.length,0);assert.equal(await page.getByRole('button',{name:'确认整车结算',exact:true}).count(),0);return;}
   if(mode==='empty'){await page.getByRole('button',{name:text.retry,exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:text.review,exact:true}).count(),0);assert.equal(writes.length,0);assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).items.length,3);return;}
   await page.getByRole('button',{name:text.begin,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'提交订单',exact:true}).count(),0);
   if(mode==='source'){await page.evaluate(products=>window.__setProducts(products.filter(p=>p.id==='keep')),products);await page.waitForTimeout(80);
    const retained=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(retained.items.length,3);assert.equal(retained.customer.email,x.customer.email);
    await page.evaluate(products=>window.__setProducts(products),products);}
   await page.getByRole('button',{name:text.begin,exact:true}).click();await page.getByRole('button',{name:text.review,exact:true}).waitFor();
   await page.getByRole('textbox',{name:text.name,exact:true}).fill('Updated contact');
   if(mode==='fresh'){await page.getByRole('button',{name:locale==='zh'?'返回购物车修改':locale==='es'?'Volver al carrito':'Back to cart',exact:true}).click();
    await page.getByRole('button',{name:text.begin,exact:true}).waitFor();assert.equal(JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key)).customer.name,'Updated contact');assert.equal(writes.length,0);
    await page.getByRole('button',{name:text.begin,exact:true}).click();await page.getByRole('textbox',{name:text.name,exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:text.name,exact:true}).inputValue(),'Updated contact');}
   await page.getByRole('button',{name:text.review,exact:true}).click();await page.locator('[data-cart-review-line]').first().waitFor();
   await page.getByRole('checkbox',{name:text.agreed,exact:true}).check();
   if(mode==='storage')await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('merchant-space:product-cart:v1:'))throw new DOMException('synthetic denied');return set.call(this,k,v);};});
   if(mode==='foreign')await page.evaluate(key=>localStorage.setItem(key,'{"foreign":"must be preserved"}'),key);
   await page.getByRole('button',{name:text.confirm,exact:true}).evaluate(b=>{b.click();b.click();});
   if(mode==='storage'||mode==='foreign'){await page.getByRole('alert').waitFor();assert.equal(writes.length,0);assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);
    if(mode==='foreign')assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),'{"foreign":"must be preserved"}');}
   else{await page.waitForFunction(k=>localStorage.getItem(k)!==null,nonceKey);assert.equal(writes.length,1);assert.equal(writes[0].lines.length,2);
    let draft=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(draft.items.length,3);assert.equal(draft.customer.name,'Updated contact');assert.equal(draft.customer.email,x.customer.email);
    if(mode==='lost'){await page.getByRole('alert').waitFor();await page.reload();await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:text.retry,exact:true}).click();await page.getByRole('button',{name:text.recover,exact:true}).waitFor();confirmed=true;await page.getByRole('button',{name:text.recover,exact:true}).click();}
    await page.getByRole('heading',{name:text.done,exact:true}).waitFor();
    if(mode==='identity'){await page.evaluate(()=>window.__identity());await page.waitForFunction(()=>!document.querySelector('[data-member-cart-checkout]'));assert.equal(writes.length,1);assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);return;}
    assert.ok(await page.getByRole('button',{name:'删除',exact:true}).first().isDisabled());
    if(mode==='fresh'){await page.evaluate(()=>window.__setLoading(true));await page.getByText('正在同步最新商品目录…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'删除',exact:true}).count(),3);
     await page.evaluate(()=>window.__setLoading(false));await page.getByRole('button',{name:'返回商品列表',exact:true}).click();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('heading',{name:text.done,exact:true}).waitFor();assert.equal(writes.length,1);}
    await page.screenshot({path:path.join(evidence,`${width}-${locale}-${mode}-original.png`),fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:text.ack,exact:true}).click();await page.getByText(text.kept,{exact:true}).waitFor();
    draft=JSON.parse(await page.evaluate(k=>localStorage.getItem(k),key));assert.equal(draft.items.length,mode==='lost'?3:1);assert.equal(draft.items.at(-1).productId,'keep');assert.equal(draft.customer.name,'Updated contact');assert.equal(await page.evaluate(k=>localStorage.getItem(k),nonceKey),null);assert.equal(writes.length,1);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${locale}-${mode}.png`),fullPage:true});throw error;}finally{try{assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);}finally{await context.close();}}
 });console.log(`PRODUCT_CART_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
