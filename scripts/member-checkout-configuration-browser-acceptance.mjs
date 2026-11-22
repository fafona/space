import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

// Actual merchant settings controller + form. Intercept every request; synthetic
// config storage only. Real PostgreSQL CAS is verified separately, not inferred
// from a green browser journey or a simulated successful save.
test('checkout configuration form preserves draft/unknown outcomes on mobile/desktop in zh/en/es',{timeout:120000},async()=>{
 const bundle=await build({stdin:{contents:`import React from'react';import{createRoot}from'react-dom/client';
 import{MerchantCheckoutConfigurationPanel}from'./src/components/checkout/MerchantCheckoutConfigurationPanel';
 createRoot(document.getElementById('root')).render(<MerchantCheckoutConfigurationPanel siteId="10909095" locale={window.__locale}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'}});
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/checkout/MerchantCheckoutConfigurationPanel.tsx";',{from:path.resolve('checkout-configuration-acceptance.css')})).css;
 const labels={zh:{heading:'预约与商品结算设置',source:'绑定项目',cash:'单价（欧元）',points:'每份所需积分',quantity:'单次最多数量',duration:'服务时长（分钟，可选）',stock:'关联现有兑换库存（可选）',zone:'预约所在时区',rp:'取消后退回本单实际扣除的积分',rc:'取消后退回原券',save:'保存设置',saved:'已保存新版本',reload:'重新读取',refresh:'核对并使用当前来源',onsite:'允许到店付款',enable:'启用此结算项目',invalid:'请填写有效的价格、积分、数量和取消规则。',unknown:'保存结果尚未确认。请先重新读取并核对原项目，不要重复创建。'},
 en:{heading:'Booking & product checkout',source:'Linked item',cash:'Unit price (EUR)',points:'Points per unit',quantity:'Maximum quantity',duration:'Duration (minutes, optional)',stock:'Link redemption stock (optional)',zone:'Booking time zone',rp:'Return points actually debited for this checkout',rc:'Return original coupons on cancellation',save:'Save settings',saved:'New version saved',reload:'Reload',refresh:'Confirm current source',onsite:'Allow payment on arrival',enable:'Enable this offer',invalid:'Enter valid prices, points, quantity and cancellation choices.',unknown:'Save result is unconfirmed. Reload and review the original item; do not create it again.'},
 es:{heading:'Pago de reservas y productos',source:'Artículo vinculado',cash:'Precio unitario (EUR)',points:'Puntos por unidad',quantity:'Cantidad máxima',duration:'Duración (minutos, opcional)',stock:'Vincular existencias de canje (opcional)',zone:'Zona horaria de la reserva',rp:'Devolver los puntos realmente canjeados',rc:'Devolver los cupones originales al cancelar',save:'Guardar ajustes',saved:'Nueva versión guardada',reload:'Volver a leer',refresh:'Confirmar origen actual',onsite:'Permitir pago en el local',enable:'Activar esta oferta',invalid:'Introduce precios, puntos, cantidades y políticas válidos.',unknown:'No se ha confirmado el guardado. Vuelve a leer y revisar la oferta original; no la crees otra vez.'}};
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1280])for(const locale of ['zh-CN','en-GB','es-ES']){
  const context=await browser.newContext({viewport:{width,height:1100}}),page=await context.newPage(),errors=[],foreign=[];
  const text=labels[locale.slice(0,2)],writes=[];let snapshot={version:null,offers:[]},mode='hold',release,sourceVersion='b'.repeat(64);
  const id='12345678-1234-4234-8234-123456789abc',revision='87654321-4321-4321-8321-cba987654321',version='abcdefab-abcd-4abc-8abc-abcdefabcdef';
  const options=()=>({sources:[{key:'a'.repeat(64),sourceVersion,title:'Demo play · 60 min',kind:'booking',viewport:'mobile',blockId:'demo-booking',store:'Demo store',item:'Demo play',cashMinor:null}],stockItems:[{id:'demo-stock',title:'Demo stock',points:500}],vouchers:[{id:'demo-voucher',title:'Demo voucher',kind:'exchange_voucher'}],defaultTimeZone:'Europe/Madrid',countryCode:'ES',canPoints:true,canCoupons:true});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest()&&url.href==='https://checkout-settings.invalid/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'});
   if(url.origin!=='https://checkout-settings.invalid'||url.pathname!=='/api/merchant-checkout/configuration'){foreign.push(url.href);return route.abort();}
   assert.equal(url.searchParams.get('siteId'),'10909095');
   if(request.method()==='GET')return route.fulfill({json:{ok:true,snapshot,options:options()}});
   assert.equal(request.method(),'PUT');const body=request.postDataJSON();writes.push(body);
   if(mode==='hold')await new Promise(resolve=>{release=resolve;});
   if(mode==='lost')return route.fulfill({status:503,json:{error:'checkout_configuration_unconfirmed'}});
   const edit=body.edit;assert.deepEqual(Object.keys(body).sort(),['edit','expectedVersion']);
   const offer={version:1,id:edit.offerId??id,revision,siteId:'10909095',enabled:edit.enabled,title:edit.title,maxQuantity:edit.maxQuantity,
    source:{kind:'booking',blockId:'demo-booking',serviceId:edit.offerId??id,timeZone:edit.timeZone},cash:{currency:'eur',unitAmountMinor:edit.cashMinor,initialPolicy:{mode:'full'}},unitPoints:edit.unitPoints,allowOnSite:edit.allowOnSite,couponReturnOnCancel:edit.couponReturnOnCancel,
    checkoutBinding:{sourceKey:edit.sourceKey,sourceVersion:edit.sourceVersion,viewport:'mobile',store:'Demo store',item:'Demo play',stockItemId:edit.stockItemId,voucherCouponIds:edit.voucherCouponIds,durationMinutes:edit.durationMinutes,pointsReturnOnCancel:edit.pointsReturnOnCancel,cancellationAdvanceMinutes:edit.cancellationAdvanceMinutes}};
   snapshot={version,offers:[offer]};return route.fulfill({json:{ok:true,snapshot}});
  });
  try{
   await page.goto('https://checkout-settings.invalid/');await page.evaluate(value=>{window.__locale=value;},locale);
   await page.addStyleTag({content:css+'body{margin:0;background:#f3f6f9;font-family:Arial,sans-serif}'});await page.addScriptTag({content:bundle.outputFiles[0].text});
   await page.getByRole('heading',{name:text.heading,exact:true}).waitFor();await page.getByLabel(text.source,{exact:true}).selectOption('a'.repeat(64));
   await page.getByRole('button',{name:text.save,exact:true}).click();await page.getByText(text.invalid,{exact:true}).waitFor();assert.equal(writes.length,0);
   await page.getByLabel(text.cash,{exact:true}).fill('100.00');await page.getByLabel(text.points,{exact:true}).fill('500');
   await page.getByLabel(text.quantity,{exact:true}).fill('2');await page.getByLabel(text.duration,{exact:true}).fill('60');
   assert.equal(await page.getByLabel(text.zone,{exact:true}).inputValue(),'Europe/Madrid');
   await page.getByLabel(text.stock,{exact:true}).selectOption('demo-stock');assert.equal(await page.getByLabel(text.points,{exact:true}).isDisabled(),true);
   await page.getByLabel(text.rp,{exact:true}).selectOption('yes');await page.getByLabel(text.rc,{exact:true}).selectOption('yes');
   await page.getByRole('checkbox',{name:'Demo voucher',exact:true}).check();await page.getByRole('checkbox',{name:text.onsite,exact:true}).check();await page.getByRole('checkbox',{name:text.enable,exact:true}).check();
   await page.getByRole('button',{name:text.save,exact:true}).evaluate(button=>{button.click();button.click();});
   await page.waitForFunction(()=>document.querySelector('button[type="submit"]')?.disabled);while(!release)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal(writes.length,1);assert.equal(writes[0].edit.cashMinor,10000);assert.equal(writes[0].edit.unitPoints,500);assert.equal(writes[0].edit.couponReturnOnCancel,true);
   mode='ok';release();await page.getByText(text.saved,{exact:true}).waitFor();assert.equal(snapshot.offers.length,1);
   await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-settings-${width}-${locale}.png`,fullPage:true,animations:'disabled'});
   mode='lost';await page.getByLabel(text.cash,{exact:true}).fill('110.00');await page.getByRole('button',{name:text.save,exact:true}).click();
   await page.getByText(text.unknown,{exact:true}).waitFor();assert.equal(writes.length,2);assert.equal(await page.getByRole('button',{name:text.save,exact:true}).isDisabled(),true);
   assert.equal(await page.getByLabel(text.cash,{exact:true}).inputValue(),'110.00');
   sourceVersion='c'.repeat(64);await page.getByRole('button',{name:text.reload,exact:true}).click();await page.getByRole('button',{name:text.refresh,exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:text.save,exact:true}).isDisabled(),true);assert.equal(await page.getByLabel(text.cash,{exact:true}).inputValue(),'110.00');
   await page.getByRole('button',{name:text.refresh,exact:true}).click();mode='ok';await page.getByRole('button',{name:text.save,exact:true}).click();await page.getByText(text.saved,{exact:true}).waitFor();
   assert.equal(writes.length,3);assert.equal(writes[2].edit.offerId,id);assert.equal(writes[2].edit.sourceVersion,sourceVersion);assert.equal(snapshot.offers.length,1);
   assert.equal(await page.getByLabel(text.source,{exact:true}).isDisabled(),true);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
  }catch(error){await fs.mkdir('output',{recursive:true});await page.screenshot({path:`output/member-checkout-settings-failure-${width}-${locale}.png`,fullPage:true});
   console.log(JSON.stringify({width,locale,errors,foreign,body:(await page.locator('body').innerText()).slice(0,1500)}));throw error;
  }finally{await context.close();}
 }}finally{await browser.close();}
});
