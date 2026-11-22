import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

test('member coupon selection, due totals and incomplete-commit guard work on mobile/desktop in three languages',{timeout:120000},async()=>{
 const bundle=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutPaymentOptions}from'./src/components/checkout/MerchantCheckoutPaymentOptions';
 import{MerchantCheckoutCouponPicker}from'./src/components/checkout/MerchantCheckoutCouponPicker';
 import{MerchantSettlementBadge}from'./src/components/checkout/MerchantSettlementBadge';
 const choices=[{couponId:'demo-coupon',claimEventId:'demo-claim',title:'Demo points coupon',kind:'points_voucher',validUntil:'2026-12-31T00:00:00Z',available:true,pointsDiscount:200,cashDiscountMinor:0,coveredQuantity:0,singleUse:true},
 {couponId:'wrong-coupon',claimEventId:'wrong-claim',title:'Demo cash coupon',kind:'amount_off',validUntil:null,available:false,reason:'wrong_units',pointsDiscount:0,cashDiscountMinor:0,coveredQuantity:0,singleUse:true}];
 function App(){const[selected,setSelected]=useState(null),[claims,setClaims]=useState([]),[busy,setBusy]=useState(false);window.__busy=setBusy;
 const quote={version:1,siteId:'10909095',offerId:'abcdefab-abcd-4abc-8abc-abcdefabcdef',offerRevision:'87654321-4321-4321-8321-cba987654321',resourceKind:'booking',title:'Digital sports · 60 min',quantity:1,cashTotalMinor:10000,totalPoints:500,ownPointBalance:800,reservationCreated:false,
  options:[{method:'points',available:true,totalPoints:claims.length?300:500,payNowMinor:null,remainingMinor:null},
  {method:'on_site',available:!claims.length,...(claims.length?{reason:'coupon_not_applicable'}:{}),totalPoints:null,payNowMinor:0,remainingMinor:10000}],
  coupons:{selected:claims,points:choices,on_site:[],returnOnCancel:true,previewOnly:true}};
 return <main className="preview"><header><p translate="no">FAOLLA · CHECKOUT PREVIEW</p><h1>会员预约 · 积分与优惠券</h1><small>仅演示数据，不核销优惠券、不扣积分</small></header>
 <MerchantCheckoutPaymentOptions quote={quote} locale={window.__locale} selected={selected} busy={busy} onSelect={setSelected} onConfirm={()=>window.__calls++}
  couponSection={<MerchantCheckoutCouponPicker choices={choices} selected={claims} locale={window.__locale} busy={busy} onChange={value=>{window.__selections.push(value);setClaims(value);}}/>}/>
 <aside className="mt-5 rounded-2xl bg-white p-4" data-voucher-status><MerchantSettlementBadge locale={window.__locale} showDetails snapshot={{version:1,method:'points',closed:false,totalPoints:0,debitedPoints:0,returnedPoints:0,returnPending:false,coupons:{redeemedCount:1,returnedCount:0,returnPending:false}}}/></aside></main>;}
 window.__calls=0;window.__selections=[];createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MerchantCheckoutPaymentOptions.tsx";\n@source "./src/components/checkout/MerchantCheckoutCouponPicker.tsx";\n@source "./src/components/checkout/MerchantSettlementBadge.tsx";',{from:path.resolve('checkout-coupon-acceptance.css')})).css;
 const copy={zh:{region:'选择结算方式',points:'积分兑换',preview:'用券结算尚未开放',clear:'不使用优惠券',confirm:'确认积分兑换'},
 en:{region:'Choose how to pay',points:'Redeem points',preview:'Coupon checkout not available yet',clear:'Use no coupon',confirm:'Confirm redemption'},
 es:{region:'Elige cómo pagar',points:'Canjear puntos',preview:'Canje con cupón aún no disponible',clear:'No usar cupón',confirm:'Confirmar canje'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
   if(route.request().isNavigationRequest()&&route.request().url()==='https://coupon-checkout.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   requests.push(route.request().url());return route.abort();
  });
  try{
   const text=copy[locale.slice(0,2)];await page.goto('https://coupon-checkout.invalid/');await page.evaluate(value=>{window.__locale=value;},locale);
   await page.addStyleTag({content:css+'body{background:#f3f7f9;font-family:Arial,sans-serif;color:#142339}.preview{max-width:650px;margin:0 auto;padding:24px 14px}header{margin-bottom:22px}header p{font-size:11px;letter-spacing:.16em;color:#087b78}h1{font-size:24px;font-weight:bold;margin:8px 0}small{color:#64748b}'});
   await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('region',{name:text.region}).waitFor();
   assert.equal(await page.locator('[data-voucher-status] [data-settlement-state="coupon_redeemed"]').count(),1);
   await page.getByRole('radio',{name:text.points,exact:true}).check();
   assert.equal(await page.getByRole('button',{name:text.confirm,exact:true}).isDisabled(),false);
   assert.equal(await page.getByRole('checkbox',{name:'Demo cash coupon',exact:true}).isDisabled(),true);
   await page.getByRole('checkbox',{name:'Demo points coupon',exact:true}).check();
   const guarded=page.getByRole('button',{name:text.preview,exact:true});await guarded.waitFor();assert.equal(await guarded.isDisabled(),true);
   await guarded.evaluate(button=>button.click());assert.equal(await page.evaluate(()=>window.__calls),0);
   assert.deepEqual(await page.evaluate(()=>window.__selections.at(-1)),[{couponId:'demo-coupon',claimEventId:'demo-claim'}]);
   assert.equal(await page.getByText('−200',{exact:false}).count(),1);
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-coupons-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   await page.evaluate(()=>window.__busy(true));await page.waitForFunction(()=>document.querySelector('input[type="checkbox"]')?.disabled);
   assert.equal(await page.getByRole('button',{name:text.clear,exact:true}).isDisabled(),true);
   await page.evaluate(()=>window.__busy(false));await page.getByRole('button',{name:text.clear,exact:true}).click();
   assert.equal(await page.getByRole('button',{name:text.confirm,exact:true}).isDisabled(),false);
   assert.equal(await page.getByRole('checkbox',{name:'Demo points coupon',exact:true}).isChecked(),false);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert.equal(await page.evaluate(()=>window.__calls),0);
  }finally{await context.close();}
 }}finally{await browser.close();}
});
