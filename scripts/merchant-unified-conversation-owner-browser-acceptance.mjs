// Actual owner AdminClient, both layouts. All IO is synthetic and intercepted;
// no production login, database, message, service worker or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const origin='https://127.0.0.1:3131',siteId='99990001',threadId='11111111-1111-4111-8111-111111111111';
const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import AdminClient from './src/app/admin/AdminClient';import{I18nProvider}from'./src/components/I18nProvider';
 import{createDefaultMerchantPermissionConfig,createDefaultMerchantSortConfig}from'./src/data/platformControlStore';
 window.__defaults={permissionConfig:createDefaultMerchantPermissionConfig(),sortConfig:createDefaultMerchantSortConfig()};
 createRoot(document.getElementById('root')).render(<I18nProvider initialLocale="zh-CN"><AdminClient forcedScope="site-${siteId}" startInLoadingState/></I18nProvider>);
`},bundle:true,write:false,outfile:'owner-conversations.js',platform:'browser',format:'iife',jsx:'automatic',logLevel:'silent',define:{'process.env':'{}','process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_SUPABASE_URL':JSON.stringify(origin),'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"synthetic-owner-anon"','process.env.NEXT_PUBLIC_SUPABASE_DISABLE_AUTO_REFRESH':'"1"'}})).outputFiles[0].text;
const utilities=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/app/admin/AdminClient.tsx";\n@source "./src/components/service-center";',{from:path.resolve('owner-conversations.css')})).css;
const css=utilities+'\n'+(await readFile('src/app/globals.css','utf8')).replace(/^@import[^\n]+/gm,'');

test('actual owner desktop and mobile use the existing single list for account and visitor replies',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});
  const errors=[],sends=[],denied=[],messages=[{id:'1',requestId:threadId,sender:'guest',text:'Actual owner visitor fixture',createdAt:'2026-11-16T12:00:00Z'}];let readThrough=0;
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  await context.addInitScript(()=>localStorage.setItem('merchant-space:locale:v1','zh-CN'));
  const thread=()=>({id:threadId,siteId,guestNumber:'12345678',guestName:'游客12345678',updatedAt:'2026-11-16T12:00:00Z',unread:readThrough?0:1,lastMessage:messages.at(-1)});
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script>'+script.replaceAll('</script>','<\\/script>')+'</script>'});
   if(url.pathname==='/api/merchant-guest-chat'){
    assert.equal(url.searchParams.get('siteId')??request.postDataJSON()?.siteId,siteId);
    if(request.method()==='GET')return route.fulfill({json:url.searchParams.has('threadId')?{ok:true,thread:thread(),messages,before:null}:{ok:true,threads:[thread()],nextOffset:null}});
    const body=request.postDataJSON();assert.equal(body.threadId,threadId);
    if(body.action==='read'){readThrough=Number(body.through);return route.fulfill({json:{ok:true}});}
    assert.equal(body.action,'send');sends.push(body);messages.push({id:String(messages.length+1),requestId:body.messageId,sender:'merchant',text:body.text,createdAt:'2026-11-16T12:01:00Z'});return route.fulfill({json:{ok:true,threadId,messageId:body.messageId}});
   }
   if(request.method()!=='GET'){denied.push(url.pathname);return route.fulfill({status:403,json:{ok:false,error:'synthetic_write_denied'}});}
   if(url.pathname==='/api/auth/merchant-session')return route.fulfill({json:{authenticated:true,merchantId:siteId,merchantIds:[siteId],user:{id:'11111111-1111-4111-8111-999999999999',email:'owner@example.invalid'}}});
   if(url.pathname==='/api/merchant-chat-business-card')return route.fulfill({json:{profile:{id:url.searchParams.get('merchantId')||siteId,name:'Synthetic owner venue',merchantName:'Synthetic owner venue',domainPrefix:'synthetic',domain:'synthetic.example.invalid',category:'娱乐',industry:'娱乐',location:{country:'ES',province:'Sevilla',city:'Sevilla'},contactName:'Synthetic contact',contactPhone:'000000000',contactAddress:'Synthetic test address',contactEmail:'owner@example.invalid',status:'active',createdAt:'2026-01-01T00:00:00Z',serviceExpiresAt:null,...await page.evaluate(()=>window.__defaults)},chatBusinessCard:null}});
   if(['/api/site-published','/api/merchant-draft'].includes(url.pathname))return route.fulfill({json:{siteId,blocks:[],updatedAt:null}});
   if(url.pathname==='/api/app-web-version')return route.fulfill({json:{ok:true,buildId:'synthetic-owner',releasedAt:null}});
   if(url.pathname==='/api/support-messages')return route.fulfill({json:{ok:true,messages:[],unreadCount:0}});
   if(url.pathname==='/api/merchant-peer-messages')return route.fulfill({json:{ok:true,currentMerchantId:siteId,contacts:[{merchantId:'12345678',merchantName:'Registered customer',savedAt:'2026-11-16T10:00:00Z',updatedAt:'2026-11-16T10:00:00Z',lastMessage:null}],threads:[],readState:{peerLastRead:{}}}});
   if(url.pathname==='/api/bookings')return route.fulfill({json:{ok:true,bookings:[]}});
   if(url.pathname==='/api/orders')return route.fulfill({json:{ok:true,orders:[]}});
   return route.fulfill({status:404,json:{ok:false,error:'synthetic_not_available'}});
  });
  try{
   await page.goto(origin+'/'+siteId);
   if(width>=768)await page.getByRole('button',{name:'会话',exact:true}).click();
   await page.getByRole('button').filter({hasText:'游客12345678'}).first().waitFor();
   assert.equal(await page.getByRole('tab',{name:'账号会话',exact:true}).count(),0);assert.equal(await page.getByRole('tab',{name:'游客会话',exact:true}).count(),0);
   const account=page.getByRole('button').filter({hasText:'Registered customer'}).first(),visitor=page.getByRole('button').filter({hasText:'游客12345678'}).first();
   if(process.env.FAOLLA_GUEST_QA_DIR)await page.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`owner-list-${width}.png`)});
   await account.click();
   const composer=width>=768?page.locator('[data-support-auto-resize="desktop"]'):page.locator('[data-support-auto-resize="mobile"]');
   await composer.fill('Keep owner account draft');
   if(width<768)await page.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await visitor.click();await page.getByLabel('聊天记录').getByText('Actual owner visitor fixture',{exact:true}).waitFor();
   await page.getByLabel('输入消息').fill('Actual owner reply fixture');await page.getByRole('button',{name:'发送',exact:true}).filter({visible:true}).click();await page.getByLabel('聊天记录').getByText('Actual owner reply fixture',{exact:true}).waitFor();
   if(process.env.FAOLLA_GUEST_QA_DIR)await page.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`owner-guest-${width}.png`)});
   if(width<768)await page.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await account.click();assert.equal(await composer.inputValue(),'Keep owner account draft');
   assert.equal(sends.length,1);assert.equal(sends[0].threadId,threadId);assert.equal(sends[0].text,'Actual owner reply fixture');assert.ok(readThrough>=1);assert.deepEqual(errors,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(process.env.FAOLLA_GUEST_QA_DIR)await page.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`owner-unified-${width}.png`)});
   assert.ok(denied.every(path=>path==='/api/merchant-operation-logs'),'no unrelated mutation is allowed');
  }catch(error){console.error(JSON.stringify({width,errors,location:page.url(),visibleText:(await page.locator('body').innerText()).slice(0,2000)}));throw error;}finally{await context.close();}
 }}finally{await browser.close();}
});
