import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual shared presentation, synthetic state only. No production route,
// user session, member write, provider call, or financial operation is used.
test('checkout and status presentation works on mobile/desktop in zh/en/es without making network or financial calls', {timeout:120000}, async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutPaymentOptions}from'./src/components/checkout/MerchantCheckoutPaymentOptions';
 import{MerchantSettlementBadge}from'./src/components/checkout/MerchantSettlementBadge';
 const base={version:1,siteId:'10909095',offerId:'abcdefab-abcd-4abc-8abc-abcdefabcdef',offerRevision:'87654321-4321-4321-8321-cba987654321',resourceKind:'booking',title:'Digital sports · 60 min',quantity:1,cashTotalMinor:10000,totalPoints:500,ownPointBalance:800,reservationCreated:false,options:[
  {method:'online',available:true,payNowMinor:3000,remainingMinor:7000,totalPoints:null},
  {method:'points',available:true,payNowMinor:null,remainingMinor:null,totalPoints:500},
  {method:'on_site',available:true,payNowMinor:0,remainingMinor:10000,totalPoints:null}]};
 const cash={version:1,method:'online',currency:'eur',closed:false,totalMinor:10000,initialDueMinor:3000,capturedMinor:3000,refundedMinor:0,refundPendingMinor:0,paymentPending:false,refundFailed:false,disputed:false};
 function Panel({scenario}){const[selected,setSelected]=useState(null);const[busy,setBusy]=useState(false);
  const quote=structuredClone(base);
  if(scenario==='guest'){quote.ownPointBalance=null;quote.options[1]={...quote.options[1],available:false,reason:'login_required'};}
  if(scenario==='insufficient'){quote.ownPointBalance=100;quote.options[1]={...quote.options[1],available:false,reason:'insufficient_points'};}
  if(scenario==='unready'){quote.options[0]={...quote.options[0],available:false,reason:'merchant_payments_unavailable'};}
  const confirm=scenario==='preview'?undefined:method=>{if(busy)return;window.__calls.push(method);setBusy(true);window.__release=()=>setBusy(false);};
  return <MerchantCheckoutPaymentOptions quote={quote} locale={window.__locale} selected={scenario==='forced'?'points':selected} busy={busy} onSelect={setSelected} onConfirm={confirm}/>;}
 function App(){const[scenario,setScenario]=useState('member');window.__scenario=setScenario;return <main className="preview">
  <header><p className="eyebrow">FAOLLA · CHECKOUT PREVIEW</p><h1>预约结算与付款状态</h1><p>开发预览 · 仅演示数据 · 不会扣款或扣积分</p></header>
  <div className="columns"><Panel key={scenario} scenario={scenario}/><section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
   <h2 className="mb-5 text-lg font-semibold text-slate-900">管理端结算摘要</h2>
   <div className="mb-5 border-b border-slate-100 pb-5"><p className="mb-2 text-sm font-medium text-slate-900">预约 · 待商户确认</p><MerchantSettlementBadge snapshot={cash} locale={window.__locale} showDetails/></div>
   <div className="mb-5 border-b border-slate-100 pb-5"><p className="mb-2 text-sm font-medium text-slate-900">产品 · 待处理</p><MerchantSettlementBadge snapshot={{version:1,method:'points',closed:false,totalPoints:500,debitedPoints:500,returnedPoints:0,returnPending:false}} locale={window.__locale} showDetails/></div>
   <div className="mb-5 border-b border-slate-100 pb-5"><p className="mb-2 text-sm font-medium text-slate-900">预约 · 已取消</p><MerchantSettlementBadge snapshot={{...cash,closed:true,refundedMinor:3000}} locale={window.__locale} showDetails/></div>
   <div data-invalid><MerchantSettlementBadge snapshot={null} locale={window.__locale}/></div>
  </section></div></main>;}
 window.__calls=[];createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MerchantCheckoutPaymentOptions.tsx";\n@source "./src/components/checkout/MerchantSettlementBadge.tsx";',{from:path.resolve('checkout-acceptance.css')})).css;
 const copy={zh:{heading:'选择结算方式',points:'积分兑换',online:'在线支付',confirm:'确认积分兑换',login:'登录后可查看会员积分',insufficient:'积分不足',preview:'结算暂未开放'},
  es:{heading:'Elige cómo pagar',points:'Canjear puntos',online:'Pagar online',confirm:'Confirmar canje',login:'Inicia sesión para ver tus puntos',insufficient:'Puntos insuficientes',preview:'Pago aún no disponible'},
  en:{heading:'Choose how to pay',points:'Redeem points',online:'Pay online',confirm:'Confirm redemption',login:'Sign in to view your points',insufficient:'Not enough points',preview:'Checkout not available yet'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','es-ES','en-GB']){
  const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[],unexpected=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
   if(route.request().url()==='https://checkout-preview.invalid/'&&route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   unexpected.push(route.request().url());return route.abort();
  });
  try{
   const text=copy[locale.slice(0,2)];await page.goto('https://checkout-preview.invalid/');
   await page.evaluate(value=>{window.__locale=value;},locale);
   await page.addStyleTag({content:css+'body{background:#f3f7f9;color:#142339;font-family:Arial,sans-serif}.preview{max-width:1120px;margin:0 auto;padding:28px 16px 48px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}header{margin-bottom:26px}h1{font-size:25px;font-weight:700;margin:8px 0}header p{font-size:13px;color:#62748a}.eyebrow{font-size:11px;letter-spacing:.2em;color:#087b78}@media(max-width:700px){.columns{grid-template-columns:1fr}.preview{padding:20px 12px}}'});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   const panel=page.getByRole('region',{name:text.heading}),button=panel.getByRole('button');
   await panel.waitFor();assert.equal(await button.isDisabled(),true);
   await page.getByRole('radio',{name:text.points,exact:true}).check();assert.equal(await button.textContent(),text.confirm);
   await button.click();await page.waitForFunction(()=>window.__calls.length===1);
   assert.equal(await button.isDisabled(),true);await button.evaluate(el=>el.click());
   assert.deepEqual(await page.evaluate(()=>window.__calls),['points']);
   await page.evaluate(()=>window.__release());await page.waitForFunction(()=>!document.querySelector('section button')?.disabled);
   assert.equal(await page.locator('[data-settlement-state="deposit_paid"]').count(),1);
   assert.equal(await page.locator('[data-settlement-state="points_redeemed"]').count(),1);
   assert.equal(await page.locator('[data-settlement-state="refunded"]').count(),1);
   assert.ok((await page.locator('[data-invalid]').innerText()).length>0);
   assert.equal(await button.isDisabled(),false);
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.evaluate(()=>window.__scenario('guest'));await page.getByText(text.login,{exact:true}).waitFor();
   assert.equal(await page.getByRole('radio',{name:text.points,exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__scenario('insufficient'));await page.getByText(text.insufficient,{exact:true}).waitFor();
   assert.equal(await page.getByRole('radio',{name:text.points,exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__scenario('unready'));await page.waitForFunction(()=>document.querySelector('input[value="online"]')?.disabled);
   assert.equal(await page.getByRole('radio',{name:text.online,exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__scenario('preview'));await page.getByRole('button',{name:text.preview,exact:true}).waitFor();
   await page.getByRole('radio',{name:text.points,exact:true}).check();assert.equal(await page.getByRole('button',{name:text.preview,exact:true}).isDisabled(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no narrow-screen overflow');
   assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  }finally{await context.close();}
 }}finally{await browser.close();}
});
