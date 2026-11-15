// Real visitor panel and merchant inbox tabs, separate browser identities.
// HTTP is synthetic; database/RPC/permission checks have independent acceptance.
import test from'node:test';import assert from'node:assert/strict';import path from'node:path';import{readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
const origin='https://guest-chat-browser.invalid',siteId='99990001';
const script=(await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from'react';import{createRoot}from'react-dom/client';import Guest from'./src/components/service-center/GuestChatPanel';import Tabs from'./src/components/service-center/MerchantConversationTabs';
 const merchant=location.pathname==='/merchant';createRoot(document.getElementById('root')).render(merchant?<Tabs siteId="${siteId}"><div style={{padding:20}}><label>Existing account draft<input aria-label="Existing account draft"/></label></div></Tabs>:<Guest siteId="${siteId}" siteName="Synthetic merchant" active/>);
 `},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'guest-browser-fixtures',setup(b){b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';export default function dynamic(load){return function Deferred(p){const[C,setC]=React.useState(null);React.useEffect(()=>{let live=true;load().then(m=>{if(live)setC(()=>m.default)});return()=>{live=false}},[]);return C?<C {...p}/>:null;}}`}));}}]})).outputFiles[0].text;
const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/service-center";',{from:path.resolve('guest-chat-browser.css')})).css;
async function fixture(browser,width){
 const sessions=new Map(),threads=new Map(),writes=[],errors=[],unexpected=[];let sequence=0,dropAck=false,failSend=false;
 const contexts=[];
 const sessionOf=request=>sessions.get((request.headers().cookie||'').match(/guest-test=([^;]+)/)?.[1]);
 const threadSummary=t=>({id:t.id,siteId,guestNumber:t.session.number,guestName:'游客'+t.session.number,unread:t.messages.filter(m=>m.sender==='guest').length,lastMessage:t.messages.at(-1)??null,updatedAt:'2026-11-16T12:00:00Z'});
 async function page(merchant=false){
  const context=await browser.newContext({viewport:{width,height:780},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async r=>{const request=r.request(),url=new URL(request.url());
   if(url.origin!==origin){unexpected.push(url.href);return r.abort();}
   if(request.isNavigationRequest())return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body style="margin:0"><div id="root" style="height:90dvh;max-height:760px;padding:8px;box-sizing:border-box"></div><script>'+script.replaceAll('</script>','<\\/script>')+'</script>'});
   if(!['/api/guest-chat','/api/merchant-guest-chat'].includes(url.pathname)){unexpected.push(url.href);return r.abort();}
   const business=url.pathname==='/api/merchant-guest-chat';assert.equal(business,merchant,'visitors cannot use merchant requests');let session=sessionOf(request);const body=request.method()==='POST'?request.postDataJSON():Object.fromEntries(url.searchParams);
   if(request.method()==='GET'){
    if(business&&!body.threadId)return r.fulfill({json:{ok:true,threads:[...threads.values()].map(threadSummary),nextOffset:null}});
    const t=business?threads.get(body.threadId):[...threads.values()].find(t=>t.session===session);
    return r.fulfill({json:{ok:true,guest:session?{guestNumber:session.number,guestName:'游客'+session.number}:null,thread:t?threadSummary(t):null,messages:t?.messages??[],before:null}});
   }
   writes.push({merchant,body});
   if(body.action==='session'){
    let key=(request.headers().cookie||'').match(/guest-test=([^;]+)/)?.[1];if(!session){key=randomUUID();session={number:String(12345678+sessions.size)};sessions.set(key,session);}
    return r.fulfill({headers:{'set-cookie':`guest-test=${key}; Path=/; HttpOnly; Secure; SameSite=Strict`},json:{ok:true,guest:{guestNumber:session.number,guestName:'游客'+session.number}}});
   }
   if(body.action==='read')return r.fulfill({json:{ok:true}});
   if(body.action==='send'){
    if(failSend)return r.fulfill({status:503,json:{ok:false}});
    if(!business&&!session)return r.fulfill({status:401,json:{ok:false}});
    let t=business?threads.get(body.threadId):[...threads.values()].find(t=>t.session===session);
    if(!t){t={id:randomUUID(),session,messages:[]};threads.set(t.id,t);}
    if(!t.messages.some(m=>m.requestId===body.messageId&&m.sender===(business?'merchant':'guest')))t.messages.push({id:String(++sequence),requestId:body.messageId,sender:business?'merchant':'guest',text:body.text,createdAt:'2026-11-16T12:00:00Z'});
    if(dropAck){dropAck=false;return r.abort();}
    return r.fulfill({json:{ok:true,messageId:body.messageId,threadId:t.id}});
   }
   unexpected.push(JSON.stringify(body));return r.abort();
  });
  await page.goto(origin+(merchant?'/merchant':'/visitor'));return page;
 }
 return{page,writes,threads,sessions,set dropAck(value){dropAck=value;},set failSend(value){failSend=value;},async close(){for(const c of contexts)await c.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}};
}
test('visitor text reaches the merchant inbox, replies survive refresh, visitor ids stay separate and account drafts survive tab switches',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await fixture(browser,width);try{
   const guest=await f.page(),merchant=await f.page(true);await guest.getByLabel('输入消息').waitFor();assert.equal(f.writes.length,0,'viewing must not allocate identity or send');
   await guest.getByLabel('输入消息').fill('Guest delivery fixture');await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByLabel('聊天记录').getByText('Guest delivery fixture',{exact:true}).waitFor();await guest.getByText('游客12345678',{exact:true}).waitFor();
   await merchant.getByLabel('Existing account draft').fill('Keep the original account draft');await merchant.getByRole('tab',{name:'游客会话',exact:true}).click();await merchant.locator('[data-guest-thread]').filter({hasText:'游客12345678'}).click();
   await merchant.getByLabel('聊天记录').getByText('Guest delivery fixture',{exact:true}).waitFor();await merchant.getByLabel('输入消息').fill('Merchant reply fixture');await merchant.getByRole('button',{name:'发送',exact:true}).click();await merchant.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();
   await guest.getByRole('button',{name:'刷新当前会话',exact:true}).click();await guest.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();
   await guest.getByLabel('输入消息').fill('Keep unsent after refresh');await guest.reload();await guest.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();assert.equal(await guest.getByLabel('输入消息').inputValue(),'Keep unsent after refresh');
   await merchant.getByRole('tab',{name:'账号会话',exact:true}).click();assert.equal(await merchant.getByLabel('Existing account draft').inputValue(),'Keep the original account draft');
   const outsider=await f.page();await outsider.getByLabel('输入消息').waitFor();assert.equal(await outsider.getByText('Guest delivery fixture',{exact:true}).count(),0);assert.equal(f.sessions.size,1,'opening another browser must not allocate a phantom account');
   assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const send=await guest.getByRole('button',{name:'发送',exact:true}).boundingBox();assert.ok(send.y+send.height<=780);
   if(process.env.FAOLLA_GUEST_QA_DIR){await guest.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`guest-chat-${width}.png`)});await merchant.getByRole('tab',{name:'游客会话',exact:true}).click();await merchant.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`merchant-guests-${width}.png`)});}
  }finally{await f.close();}
 }}finally{await browser.close();}
});
test('unknown send results preserve visitor text and the idempotency key; reload never automatically sends an old draft',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,320);try{
  const guest=await f.page();await guest.getByLabel('输入消息').fill('Acknowledgement lost');f.dropAck=true;await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByRole('alert').waitFor();assert.equal(await guest.getByLabel('输入消息').inputValue(),'Acknowledgement lost');
  const id=f.writes.find(w=>w.body.action==='send').body.messageId;assert.equal([...f.threads.values()][0].messages.length,1);
  const sends=f.writes.filter(w=>w.body.action==='send').length;await guest.reload();await guest.getByLabel('聊天记录').getByText('Acknowledgement lost',{exact:true}).waitFor();assert.equal(f.writes.filter(w=>w.body.action==='send').length,sends);
  await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.waitForFunction(()=>document.querySelector('textarea').value==='');assert.equal([...f.threads.values()][0].messages.length,1);assert.deepEqual(f.writes.filter(w=>w.body.action==='send').map(w=>w.body.messageId),[id,id]);
  f.failSend=true;await guest.getByLabel('输入消息').fill('Do not lose failed text');await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByRole('alert').waitFor();assert.equal(await guest.getByLabel('输入消息').inputValue(),'Do not lose failed text');
 }finally{await f.close();await browser.close();}
});
