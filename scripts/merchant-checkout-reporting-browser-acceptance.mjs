import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Real read-only React component, synthetic intercepted API. Actual handler +
// SQL reporting/cancellation are validated separately in the owned PG cluster.
test('merchant current-page settlement report keeps original points/coupon facts, filters, exports and hides revoked identity',{timeout:120000},async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutSettlementPanel}from'./src/components/checkout/MerchantCheckoutSettlementPanel';
 const refs=[{kind:'order',id:'O-POINTS'},{kind:'booking',id:'B-COUPON'},{kind:'order',id:'O-LEGACY'},{kind:'booking',id:'B-REVIEW'}];
 function App(){const[identity,setIdentity]=useState('owner-synthetic');window.__identity=setIdentity;return <MerchantCheckoutSettlementPanel siteId="10909095" resources={refs} identityKey={identity} locale={window.__locale}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MerchantCheckoutSettlementPanel.tsx";\n@source "./src/components/checkout/MerchantSettlementBadge.tsx";',{from:path.resolve('checkout-reporting-acceptance.css')})).css;
 const labels={zh:{title:'结算核对',filter:'本页筛选',review:'需人工核对',closed:'已关闭',all:'全部',export:'导出本页',reload:'重新读取',login:'请使用商户负责人账号核验。',failure:'暂时无法核对结算，不能据此认定未付款或重新扣减。'},
 en:{title:'Settlement review',filter:'Current-page filter',review:'Needs review',closed:'Closed',all:'All',export:'Export this page',reload:'Reload',login:'Verify with the merchant owner account.',failure:'Settlement could not be verified. Do not assume unpaid or debit again.'},
 es:{title:'Revisión del pago',filter:'Filtro de esta página',review:'Revisar',closed:'Cerrados',all:'Todos',export:'Exportar esta página',reload:'Volver a leer',login:'Verifica con la cuenta del titular del comercio.',failure:'No se pudo verificar el pago. No lo consideres impagado ni vuelvas a descontar.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],foreign=[],requests=[];
  const text=labels[locale.slice(0,2)];let mode='ok',releaseRead;
  const base={version:1,siteId:'10909095',operationKey:'a'.repeat(64),resourceKind:'order',resourceId:'O-POINTS',totalPoints:100,couponCount:1,closed:false,
   resource:{status:'pending',updatedAt:'2026-11-23T12:00:00Z'},cancellationAvailable:false,cancellationPolicy:{returnPoints:true,returnCoupons:false,advanceMinutes:0,cancellableUntil:null},cancellation:null};
  const snapshot={version:1,siteId:'10909095',rows:[{kind:'order',id:'O-POINTS',termsMatch:true,result:base},
   {kind:'booking',id:'B-COUPON',termsMatch:true,result:{...base,operationKey:'b'.repeat(64),resourceKind:'booking',resourceId:'B-COUPON',totalPoints:0,couponCount:1,closed:true,resource:{...base.resource,status:'cancelled'},cancellationPolicy:{...base.cancellationPolicy,cancellableUntil:'2030-01-01T00:00:00Z'},cancellation:{pointsReturned:0,couponsReturned:1,stockReleased:1,cancelledAt:'2026-11-23T12:01:00Z'}}},
   {kind:'order',id:'O-LEGACY',termsMatch:false,result:null},
   {kind:'booking',id:'B-REVIEW',termsMatch:false,result:{...base,operationKey:'c'.repeat(64),resourceKind:'booking',resourceId:'B-REVIEW',resource:null,cancellationPolicy:{...base.cancellationPolicy,cancellableUntil:'2030-01-01T00:00:00Z'}}}]};
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://checkout-report.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   if(url.origin!=='https://checkout-report.invalid'){foreign.push(url.href);return route.abort();}
   assert.equal(url.pathname,'/api/merchant-checkout/settlements');assert.equal(request.method(),'POST');requests.push(request.postDataJSON());
   assert.deepEqual(request.postDataJSON(),{siteId:'10909095',resources:snapshot.rows.map(r=>({kind:r.kind,id:r.id}))});
   if(mode==='hold')await new Promise(resolve=>{releaseRead=resolve;});
   return mode==='error'?route.fulfill({status:503,json:{error:'checkout_reporting_unavailable'}}):route.fulfill({json:{ok:true,snapshot}});
  });
  try{
   await page.goto('https://checkout-report.invalid/');await page.evaluate(value=>{window.__locale=value;},locale);
   await page.addStyleTag({content:css+'body{margin:0;padding:16px;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('heading',{name:text.title,exact:true}).waitFor();await page.locator('[data-resource-id="O-POINTS"] [data-settlement-state="points_redeemed"]').waitFor();
   assert.equal(await page.locator('[data-resource-id="B-COUPON"] [data-settlement-state="coupon_returned"]').count(),1);
   assert.equal(await page.locator('[data-resource-id="O-LEGACY"] [data-settlement-state]').count(),0);
   assert.ok(!(await page.locator('[data-resource-id="O-POINTS"]').innerText()).includes('€'));
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/merchant-checkout-reporting-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.getByRole('combobox',{name:text.filter}).selectOption({label:text.review});assert.equal(await page.locator('article').count(),1);assert.equal(await page.locator('[data-resource-id="B-REVIEW"]').count(),1);
   await page.getByRole('combobox',{name:text.filter}).selectOption({label:text.closed});assert.equal(await page.locator('article').count(),1);
   const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:text.export,exact:true}).click();const download=await downloadPromise;
   const file=await fs.readFile(await download.path(),'utf8');assert.ok(file.includes('B-COUPON'));assert.ok(!file.includes('O-POINTS'));assert.ok(!/principal|couponUses|membershipId|operationKey/.test(file));
   await page.getByRole('combobox',{name:text.filter}).selectOption({label:text.all});
   mode='error';await page.getByRole('button',{name:text.reload,exact:true}).click();await page.getByText(text.failure,{exact:true}).waitFor();assert.equal(await page.locator('article').count(),0);assert.equal(await page.getByRole('button',{name:text.export,exact:true}).isDisabled(),true);
   mode='hold';await page.evaluate(()=>window.__identity('owner-other'));
   for(let i=0;!releaseRead&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(releaseRead);
   await page.evaluate(()=>window.__identity(null));await page.getByText(text.login,{exact:true}).waitFor();releaseRead();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('article').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);assert.ok(requests.length>=3);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/merchant-checkout-reporting-failure-${width}-${locale}.png`,fullPage:true});throw error;}
  finally{await context.close();}
 }}finally{await browser.close();}
});
