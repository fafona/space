import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import routeModule from '../src/app/api/orders/route-handler.ts';
import creatorModule from '../src/lib/merchantOrders.server.ts';
import boundaryModule from '../src/lib/merchantCheckoutLegacyBoundary.server.ts';
// Actual ordinary ProductBlock (no new adapter), POST, creator and guard port.
// Synthetic auth/catalog and RPC only. No running Next/PostgREST/live users.
test('ordinary cart preserves original request, products and customer on protected failures',{timeout:120000},async t=>{
 const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';import Products from'./src/components/blocks/ProductBlock';
 createRoot(document.getElementById('root')).render(<Products products={window.__products} runtimeSiteId="10909994" runtimeBlockId="products" runtimeOrderManagementEnabled={true} productPricePrefix="€"/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-only',setup(b){
  b.onResolve({filter:/(?:^|\/)I18nProvider$/},()=>({path:'i18n',namespace:'synthetic'}));b.onResolve({filter:/PublicTrafficProvider$/},()=>({path:'traffic',namespace:'synthetic'}));
  b.onResolve({filter:/authSessionRecovery$/},()=>({path:'auth',namespace:'synthetic'}));b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'synthetic'}));
  b.onLoad({filter:/.*/,namespace:'synthetic'},({path:p})=>({loader:'js',contents:p==='i18n'?`export const useI18n=()=>({locale:'zh'});`:p==='traffic'?`export const usePublicTraffic=()=>null;export const usePublicTrafficExposure=()=>{};`:p==='auth'?`export const resolveFrontendAuthPayload=async()=>({authenticated:true,accountType:'personal'});`:`export default function Image(){return null;}`}));
 }}]});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/blocks/ProductBlock.tsx";',{from:path.resolve('ordinary-intent-acceptance.css')})).css;
 const evidence=path.resolve('output',`ordinary-order-intent-browser-${Date.now()}`);await fs.mkdir(evidence,{recursive:true});const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const mode of ['pending','review','lost','legacy'])await t.test(`${width} ${mode}`,async()=>{
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),key='merchant-space:product-cart:v1:10909994:products';
  const product={id:'p',name:'Synthetic product',code:'P',description:'',price:'10',imageUrl:'',thumbnailUrl:'',tag:''},customer={name:'Synthetic contact',email:'synthetic@example.invalid',phone:'000',note:'Keep original note'};
  await context.addInitScript(({key,product,customer})=>{window.__products=[product];if(!localStorage.getItem('seeded')){localStorage.setItem('seeded','1');localStorage.setItem(key,JSON.stringify({items:[{productId:product.id,product,quantity:2,checked:true,unitPrice:10,unitPriceText:'€10'}],customer,clientRequestId:''}));}},{key,product,customer});
  const errors=[],foreign=[],requests=[];let stored=[],commits=0,notifications=0;
  page.on('pageerror',e=>errors.push(e.message));
  const client={from:()=>{throw Error('no direct writes');},rpc:async(name,args)=>{commits++;assert.equal(name,mode==='legacy'?'faolla_commit_order_membership_v1':'faolla_checkout_legacy_order_commit_v1');
   if(['pending','review'].includes(mode))return{data:null,error:{message:mode==='pending'?'checkout_original_pending':'checkout_intent_review_required'}};
   stored=args.p_mutation.orders.next;if(mode==='lost')throw Error('synthetic lost acknowledgement');return{data:{updatedAt:new Date().toISOString()},error:null};}};
  const createDeps={createClient:()=>client,loadOrders:async()=>({siteId:'10909994',orders:stored,storageRows:[],updatedAt:null}),mirrorOrders:async()=>({status:'disabled',count:0}),
   saveOrders:(client,input)=>boundaryModule.saveCheckoutAwareMerchantOrders(client,input,{enabled:()=>true,intentEnabled:()=>mode!=='legacy',cartEnabled:()=>true,rpc:()=>async(name,args)=>{assert.equal(name,'faolla_member_checkout_reporting_v3');return{data:{version:3,siteId:'10909994',rows:args.p_resources.map(r=>({...r,result:null,termsMatch:false}))},error:null};}})};
  await page.route('**/*',async r=>{const request=r.request(),url=new URL(request.url());
   if(url.pathname==='/')return r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
   if(url.pathname!=='/api/orders'||request.method()!=='POST'){foreign.push(url.pathname);return r.abort();}
   const body=request.postDataJSON();requests.push(body);const origin=url.origin;
   const response=await routeModule.handleMerchantOrderPost(new Request(origin+'/api/orders',{method:'POST',headers:{origin,'content-type':'application/json',dnt:'1'},body:JSON.stringify(body)}),{
    loadSnapshotSite:async()=>({id:'10909994',permissionConfig:{allowProductBlock:true,allowOrderManagement:true}}),loadOperatingCatalog:async()=>null,
    loadPublishedSite:async()=>({siteId:'10909994',slug:'synthetic',blocks:[{id:'products',type:'product',props:{productPricePrefix:'€',products:[product]}}]}),
    resolvePersonalSession:async()=>({accountId:'59000001',userId:'synthetic-user',email:customer.email,user:{},servicePaused:false}),
    createOrder:input=>creatorModule.createMerchantOrderRecord(input,createDeps),notifyOrderCreated:async()=>{notifications++;}});
   return r.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  const mount=async()=>{await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});};
  try{await page.goto('https://ordinary.synthetic.invalid/');await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();
   await page.getByRole('button',{name:'提交订单',exact:true}).click();
   if(mode==='legacy'){await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).items.length===0,key);assert.equal(stored.length,1);assert.equal(commits,1);assert.equal(notifications,1);}
   else{const message=mode==='pending'?'有一笔结算原单尚未核对，请先查看本人原单，不要从旧入口重复下单。':mode==='review'?'原结算需人工核对，暂不能另外下单；请联系商户核对原单。':'下单结果尚未确认，请重新读取原订单，不要再次提交。';
    await page.getByText(message,{exact:true}).last().waitFor();let draft=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));assert.equal(draft.items.length,1);assert.equal(draft.items[0].quantity,2);assert.equal(draft.customer.name,customer.name);assert.equal(draft.customer.note,customer.note);assert.equal(draft.clientRequestId,requests[0].clientRequestId);assert.ok(draft.clientRequestId);assert.equal(notifications,0);assert.equal(commits,1);
    await page.screenshot({path:path.join(evidence,`${width}-${mode}.png`),fullPage:true,animations:'disabled'});
    await page.reload();await mount();await page.getByRole('button',{name:'打开购物车',exact:true}).click();await page.getByRole('button',{name:'提交订单',exact:true}).click();
    if(mode==='lost'){await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).items.length===0,key);assert.equal(commits,1);assert.equal(stored.length,1);assert.equal(notifications,1);}
    else{await page.getByText(message,{exact:true}).last().waitFor();assert.equal(commits,2);assert.equal(stored.length,0);draft=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),key));assert.equal(draft.items[0].quantity,2);assert.equal(draft.customer.name,customer.name);}
    assert.equal(requests[1].clientRequestId,requests[0].clientRequestId);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await page.screenshot({path:path.join(evidence,`failure-${width}-${mode}.png`),fullPage:true});throw error;}finally{await context.close();}
 });console.log(`ORDINARY_ORDER_INTENT_BROWSER_EVIDENCE=${evidence}`);}finally{await browser.close();}
});
