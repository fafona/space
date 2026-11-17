// Real visitor panel and unified employee/merchant inbox, separate browser identities.
// HTTP is synthetic; database/RPC/permission checks have independent acceptance.
import test from'node:test';import assert from'node:assert/strict';import path from'node:path';import{readFile}from'node:fs/promises';import{randomUUID}from'node:crypto';
import{build}from'esbuild';import postcss from'postcss';import tailwind from'@tailwindcss/postcss';import{chromium}from'playwright';
const origin='https://guest-chat-browser.invalid',siteId='99990001';
const script=(await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from'react';import{createRoot}from'react-dom/client';import Guest from'./src/components/service-center/GuestChatPanel';import Inbox from'./src/components/enterprise/MerchantEmployeeConversationPanel';
 import{I18nProvider,useI18n}from'./src/components/I18nProvider';import{writeManualLocale}from'./src/lib/i18n';
 writeManualLocale(new URLSearchParams(location.search).get('uiLocale')||'zh-CN');
 function LocaleControls(){const{setLocale}=useI18n();return <div><button onClick={()=>setLocale('es-ES')}>Spanish</button><button onClick={()=>setLocale('en-US')}>English</button><button onClick={()=>setLocale('zh-CN')}>Chinese</button></div>}
 const merchant=location.pathname==='/merchant',viewOnly=location.search.includes('viewOnly');const apiClient=(path,init)=>fetch(path,{...init,headers:{...init?.headers,'x-synthetic-employee':'actor'}});
 createRoot(document.getElementById('root')).render(<I18nProvider><LocaleControls/>{merchant?<Inbox siteId="${siteId}" apiClient={apiClient} permissions={viewOnly?['conversations.view']:['conversations.view','conversations.send','conversations.search','conversations.start']}/>:<Guest siteId="${siteId}" siteName="Synthetic merchant" active/>}</I18nProvider>);
 `},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'guest-browser-fixtures',setup(b){b.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',resolveDir:process.cwd(),contents:`import React from'react';export default function dynamic(load){return function Deferred(p){const[C,setC]=React.useState(null);React.useEffect(()=>{let live=true;load().then(m=>{if(live)setC(()=>m.default)});return()=>{live=false}},[]);return C?<C {...p}/>:null;}}`}));}}]})).outputFiles[0].text;
const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/service-center";\n@source "./src/components/support";\n@source "./src/components/enterprise/MerchantEmployeeConversationPanel.tsx";',{from:path.resolve('guest-chat-browser.css')})).css;
async function fixture(browser,width,{listPageSize=50,translate=false}={}){
 const sessions=new Map(),threads=new Map(),writes=[],requests=[],errors=[],unexpected=[];let sequence=0,dropAck=false,failSend=false,failList=false,failUpload=false,heldUpload=false,releaseUpload=null,notifyUpload=null,heldThreadId='',releaseHeld=null,notifyHeld=null;
 const account={merchantId:'12345678',merchantName:'Registered customer',savedAt:'2026-11-16T10:00:00Z',updatedAt:'2026-11-16T10:00:00Z',lastMessage:null};
 const accountMessages=[],accountReadState={};
 const contexts=[];
 const sessionOf=request=>sessions.get((request.headers().cookie||'').match(/guest-test=([^;]+)/)?.[1]);
 const threadSummary=t=>({id:t.id,siteId,guestNumber:t.session.number,guestName:'游客'+t.session.number,unread:t.messages.filter(m=>m.sender==='guest'&&BigInt(m.id)>BigInt(t.readThrough??0)).length,lastMessage:t.messages.at(-1)??null,updatedAt:'2026-11-16T12:00:00Z'});
 async function page(merchant=false,query=''){
  const context=await browser.newContext({viewport:{width,height:780},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});contexts.push(context);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async r=>{const request=r.request(),url=new URL(request.url());
   if(url.hostname==='translate.googleapis.com')return r.fulfill({json:[[[translate?'Translated '+url.searchParams.get('q'):url.searchParams.get('q')]]]});
   if(url.origin!==origin){unexpected.push(url.href);return r.abort();}
   if(request.isNavigationRequest())return r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><body style="margin:0"><div id="root" style="height:90dvh;max-height:760px;padding:8px;box-sizing:border-box"></div><script>'+script.replaceAll('</script>','<\\/script>')+'</script>'});
   requests.push({path:url.pathname,method:request.method(),body:request.method()==='POST'&&!url.pathname.endsWith('/attachments')?request.postDataJSON():null});
   if(url.pathname.startsWith('/storage/v1/object/public/'))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
   if(url.pathname.endsWith('/attachments')){
    const business=url.pathname==='/api/merchant-guest-chat/attachments';assert.equal(business,merchant);if(merchant)assert.equal(request.headers()['x-synthetic-employee'],'actor');else assert.ok(sessionOf(request),'guest identity required before upload');
    if(heldUpload)await new Promise(resolve=>{releaseUpload=resolve;notifyUpload?.();});
    if(failUpload)return r.fulfill({status:503,json:{ok:false,message:'Synthetic upload unavailable'}});
    const image=request.postData()?.includes('filename="photo.png"'),name=image?'photo.png':'note.txt';
    return r.fulfill({json:{ok:true,url:`/storage/v1/object/public/page-assets/guest-chat/${siteId}/${'a'.repeat(64)}/${'b'.repeat(64)}.${image?'png':'txt'}`,name,image}});
   }
   if(url.pathname==='/api/merchant-peer-messages'){
    assert.equal(merchant,true);assert.equal(request.headers()['x-synthetic-employee'],'actor');
    if(request.method()==='POST'){const body=request.postDataJSON();if(body.action==='mark_read'){assert.equal(body.contactMerchantId,'12345678');accountReadState['12345678']=body.lastReadAt;return r.fulfill({json:{ok:true,readState:{peerLastRead:accountReadState}}});}assert.equal(body.action,'send');assert.equal(body.recipientMerchantId,'12345678');writes.push({merchant,account:true,body});accountMessages.push({id:'account-'+accountMessages.length,senderMerchantId:siteId,text:body.text,createdAt:'2026-11-16T12:05:00Z'});}
    return r.fulfill({json:{ok:true,currentMerchantId:siteId,contacts:[account],threads:accountMessages.length?[{threadKey:'synthetic-account-thread',merchantAId:siteId,merchantBId:'12345678',updatedAt:'2026-11-16T12:05:00Z',messages:accountMessages}]:[],readState:{peerLastRead:accountReadState}}});
   }
   if(!['/api/guest-chat','/api/merchant-guest-chat'].includes(url.pathname)){unexpected.push(url.href);return r.abort();}
   const business=url.pathname==='/api/merchant-guest-chat';assert.equal(business,merchant,'visitors cannot use merchant requests');let session=sessionOf(request);const body=request.method()==='POST'?request.postDataJSON():Object.fromEntries(url.searchParams);
   if(request.method()==='GET'){
    if(business&&!body.threadId){if(failList)return r.fulfill({status:503,json:{ok:false,message:'Synthetic list unavailable'}});const offset=Number(body.offset??0),all=[...threads.values()].map(threadSummary);return r.fulfill({json:{ok:true,threads:all.slice(offset,offset+listPageSize),nextOffset:all.length>offset+listPageSize?offset+listPageSize:null}});}
    const t=business?threads.get(body.threadId):[...threads.values()].find(t=>t.session===session);
    if(business&&body.threadId===heldThreadId)await new Promise(resolve=>{releaseHeld=resolve;notifyHeld?.();});
    return r.fulfill({json:{ok:true,guest:session?{guestNumber:session.number,guestName:'游客'+session.number}:null,thread:t?threadSummary(t):null,messages:t?.messages??[],before:null}});
   }
   writes.push({merchant,body});
   if(body.action==='session'){
    let key=(request.headers().cookie||'').match(/guest-test=([^;]+)/)?.[1];if(!session){key=randomUUID();session={number:String(12345678+sessions.size)};sessions.set(key,session);}
    return r.fulfill({headers:{'set-cookie':`guest-test=${key}; Path=/; HttpOnly; Secure; SameSite=Strict`},json:{ok:true,guest:{guestNumber:session.number,guestName:'游客'+session.number}}});
   }
   if(body.action==='read'){if(business)threads.get(body.threadId).readThrough=body.through;return r.fulfill({json:{ok:true}});}
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
  await page.goto(origin+(merchant?'/merchant':'/visitor')+query);return page;
 }
 return{page,writes,requests,threads,sessions,incomingAccount(text){const message={id:'account-incoming-'+accountMessages.length,senderMerchantId:'12345678',text,createdAt:'2026-11-16T12:06:00Z'};accountMessages.push(message);account.lastMessage=message;},holdThread(id){heldThreadId=id;return new Promise(resolve=>{notifyHeld=resolve;});},holdUpload(){heldUpload=true;return new Promise(resolve=>{notifyUpload=resolve;});},releaseUpload(){heldUpload=false;releaseUpload?.();},release(){heldThreadId='';releaseHeld?.();releaseHeld=null;notifyHeld=null;},set dropAck(value){dropAck=value;},set failSend(value){failSend=value;},set failUpload(value){failUpload=value;},set failList(value){failList=value;},async close(){releaseHeld?.();releaseUpload?.();for(const c of contexts)await c.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}};
}
test('one mixed inbox receives visitor text, preserves account drafts and replies to the correct identity without tabs',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await fixture(browser,width);try{
   const guest=await f.page(),merchant=await f.page(true);await guest.getByLabel('输入消息').waitFor();assert.equal(f.writes.length,0,'viewing must not allocate identity or send');
   await guest.getByLabel('输入消息').fill('Guest delivery fixture');await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByLabel('聊天记录').getByText('Guest delivery fixture',{exact:true}).waitFor();await guest.getByText('访客12345678',{exact:true}).waitFor();
   const list=merchant.getByLabel('会话对象列表');assert.equal(await merchant.getByRole('tab').count(),0);
   await list.getByRole('button').filter({hasText:'Registered customer'}).click();await merchant.getByLabel('消息内容').fill('Keep the original account draft');
   if(width<768)await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await merchant.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await list.locator('[data-conversation-id^="guest:"]').filter({hasText:'访客12345678'}).click();
   await merchant.getByLabel('聊天记录').getByText('Guest delivery fixture',{exact:true}).waitFor();await merchant.getByLabel('输入消息').fill('Merchant reply fixture');await merchant.getByRole('button',{name:'发送',exact:true}).click();await merchant.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();
   await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await guest.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();
   await guest.getByLabel('输入消息').fill('Keep unsent after refresh');await guest.reload();await guest.getByLabel('聊天记录').getByText('Merchant reply fixture',{exact:true}).waitFor();assert.equal(await guest.getByLabel('输入消息').inputValue(),'Keep unsent after refresh');
   await merchant.getByLabel('输入消息').fill('Keep this visitor draft');
   if(width<768)await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await list.getByRole('button').filter({hasText:'Registered customer'}).click();assert.equal(await merchant.getByLabel('消息内容').inputValue(),'Keep the original account draft');
   if(width<768)await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await list.locator('[data-conversation-id^="guest:"]').click();await merchant.waitForFunction(()=>document.querySelector('[data-guest-chat] textarea')?.value==='Keep this visitor draft');assert.equal(await merchant.getByLabel('输入消息').inputValue(),'Keep this visitor draft');
   assert.equal(f.writes.filter(w=>w.account).length,0,'guest replies never use account send');assert.equal([...f.threads.values()][0].messages.length,2);
   if(width<768)await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await list.getByRole('button').filter({hasText:'Registered customer'}).click();await merchant.getByLabel('消息内容').fill('Reply only to registered customer');await merchant.getByRole('button',{name:'发送',exact:true}).filter({visible:true}).click();await merchant.getByText('Reply only to registered customer',{exact:true}).waitFor();
   assert.equal(f.writes.filter(w=>w.account).length,1);assert.equal([...f.threads.values()][0].messages.length,2,'registered replies must not enter the visitor thread');
   if(width<768)await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();
   await list.locator('[data-conversation-id^="guest:"]').click();await merchant.waitForFunction(()=>document.querySelector('[data-guest-chat] textarea')?.value==='Keep this visitor draft');
   const outsider=await f.page();await outsider.getByLabel('输入消息').waitFor();assert.equal(await outsider.getByText('Guest delivery fixture',{exact:true}).count(),0);assert.equal(f.sessions.size,1,'opening another browser must not allocate a phantom account');
   assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const send=await guest.getByRole('button',{name:'发送',exact:true}).boundingBox();assert.ok(send.y+send.height<=780);
   if(process.env.FAOLLA_GUEST_QA_DIR){await guest.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`guest-chat-${width}.png`)});await merchant.screenshot({path:path.join(process.env.FAOLLA_GUEST_QA_DIR,`merchant-unified-${width}.png`)});}
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('mixed inbox pagination, retryable partial failures, independent guest drafts and stale thread responses',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,1440,{listPageSize:1});try{
  const first=await f.page(),second=await f.page();
  for(const [p,text]of[[first,'Visitor one'],[second,'Visitor two']]){await p.getByLabel('输入消息').fill(text);await p.getByRole('button',{name:'发送',exact:true}).click();await p.getByLabel('聊天记录').getByText(text,{exact:true}).waitFor();}
  const merchant=await f.page(true),list=merchant.getByLabel('会话对象列表');
  await list.locator('[data-conversation-id^="guest:"]').waitFor();await list.getByRole('button',{name:'更多会话',exact:true}).click();await merchant.waitForFunction(()=>document.querySelectorAll('[data-conversation-id^="guest:"]').length===2);
  assert.equal(await list.locator('[data-conversation-id^="merchant:"]').count(),1);
  const[id1,id2]=[...f.threads.keys()],started=f.holdThread(id1);await list.locator(`[data-conversation-id="guest:${id1}"]`).click();await started;
  await list.locator(`[data-conversation-id="guest:${id2}"]`).click();await merchant.getByLabel('聊天记录').getByText('Visitor two',{exact:true}).waitFor();const oldResponse=merchant.waitForResponse(r=>r.url().includes('threadId='+id1));f.release();await(await oldResponse).finished();
  assert.equal(await merchant.getByLabel('聊天记录').getByText('Visitor one',{exact:true}).count(),0);
  await merchant.getByLabel('输入消息').fill('Draft two');await list.locator(`[data-conversation-id="guest:${id1}"]`).click();await merchant.getByLabel('聊天记录').getByText('Visitor one',{exact:true}).waitFor();await merchant.getByLabel('输入消息').fill('Draft one');
  await list.locator(`[data-conversation-id="guest:${id2}"]`).click();await merchant.waitForFunction(()=>document.querySelector('[data-guest-chat] textarea')?.value==='Draft two');
  f.failList=true;await merchant.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await merchant.getByRole('alert').getByText('Synthetic list unavailable',{exact:false}).waitFor();
  assert.equal(await list.locator('[data-conversation-id]').count(),3,'a transient visitor error must not erase account or existing visitor rows');
  f.failList=false;await merchant.getByRole('button',{name:'刷新会话',exact:true}).click();await merchant.getByRole('alert').waitFor({state:'hidden'});
  assert.equal(await list.locator('[data-conversation-id^="guest:"]').count(),2,'refreshing page one retains already loaded older threads');
  await merchant.getByLabel('输入消息').fill('Reply only to visitor two');await merchant.getByRole('button',{name:'发送',exact:true}).click();await merchant.getByLabel('聊天记录').getByText('Reply only to visitor two',{exact:true}).waitFor();
  assert.equal(f.threads.get(id1).messages.length,1);assert.equal(f.threads.get(id2).messages.at(-1).text,'Reply only to visitor two');
 }finally{await f.close();await browser.close();}
});

test('view-only staff see guests in the same list without gaining send or search permissions',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390);try{
  const guest=await f.page();await guest.getByLabel('输入消息').fill('Read only visitor');await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByLabel('聊天记录').getByText('Read only visitor',{exact:true}).waitFor();
  const merchant=await f.page(true,'?viewOnly=1');await merchant.getByLabel('会话对象列表').locator('[data-conversation-id^="guest:"]').click();await merchant.getByLabel('聊天记录').getByText('Read only visitor',{exact:true}).waitFor();
  assert.equal(await merchant.getByLabel('输入消息').isDisabled(),true);assert.equal(await merchant.getByRole('button',{name:'发送',exact:true}).isDisabled(),true);assert.equal(await merchant.getByRole('button',{name:'精确搜索',exact:true}).count(),0);
  assert.equal(f.writes.filter(w=>w.merchant&&w.body.action==='send').length,0);assert.equal(await merchant.getByRole('tab').count(),0);
  await merchant.getByRole('button',{name:'返回会话列表',exact:true}).filter({visible:true}).click();await merchant.getByLabel('会话对象列表').getByText('Registered customer',{exact:true}).waitFor();
 }finally{await f.close();await browser.close();}
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

test('both identities send images, files and emoji; uploads remain unsent until explicit send and stay in the right conversation',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390);try{
  const guest=await f.page();await guest.getByLabel('输入消息').fill('Original caption');
  await guest.getByLabel('图片 / 文件',{exact:true}).setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await guest.locator('[data-chat-attachment-preview]').waitFor();assert.equal(f.writes.filter(w=>w.body.action==='send').length,0);
  assert.equal(await guest.getByLabel('输入消息').inputValue(),'Original caption');
  await guest.getByRole('button',{name:'选择表情',exact:true}).click();await guest.getByRole('button',{name:'😊',exact:true}).click();
  f.dropAck=true;await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.getByRole('alert').waitFor();
  const first=f.writes.find(w=>w.body.action==='send').body;assert.match(first.text,/^图片：photo.png\n\/storage\/v1/);assert.match(first.text,/Original caption😊$/);
  await guest.reload();await guest.locator('[data-chat-attachment-preview]').waitFor();assert.equal(f.writes.filter(w=>w.body.action==='send').length,1);
  await guest.getByRole('button',{name:'发送',exact:true}).click();await guest.locator('[data-chat-attachment-preview]').waitFor({state:'hidden'});assert.equal([...f.threads.values()][0].messages.length,1);
  await guest.getByRole('button',{name:'查看图片大图',exact:true}).click();await guest.getByRole('dialog',{name:'图片预览'}).waitFor();await guest.keyboard.press('Escape');await guest.getByRole('dialog',{name:'图片预览'}).waitFor({state:'hidden'});
  const merchant=await f.page(true);await merchant.getByLabel('会话对象列表').locator('[data-conversation-id^="guest:"]').click();await merchant.getByRole('button',{name:'查看图片大图',exact:true}).waitFor();
  assert.equal(await merchant.locator('[data-chat-thread-header]').getByRole('button',{name:/刷新/}).count(),0);
  await merchant.getByLabel('图片 / 文件',{exact:true}).setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic file')});await merchant.locator('[data-chat-attachment-preview]').waitFor();
  await merchant.getByRole('button',{name:'选择表情',exact:true}).click();await merchant.getByRole('button',{name:'👍',exact:true}).click();await merchant.getByRole('button',{name:'发送',exact:true}).click();await merchant.getByRole('link').filter({hasText:'note.txt'}).waitFor();
  await guest.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await guest.getByRole('link').filter({hasText:'note.txt'}).waitFor();
  assert.match([...f.threads.values()][0].messages.at(-1).text,/^文件：note.txt/);assert.match([...f.threads.values()][0].messages.at(-1).text,/👍$/);
  assert.equal(f.writes.filter(w=>w.account).length,0);
  const readonly=await f.page(true,'?viewOnly=1');await readonly.getByLabel('会话对象列表').locator('[data-conversation-id^="guest:"]').click();assert.equal(await readonly.getByRole('button',{name:'添加附件',exact:true}).isDisabled(),true);assert.equal(await readonly.getByRole('button',{name:'选择表情',exact:true}).isDisabled(),true);
 }finally{await f.close();await browser.close();}
});

test('native guest labels and icon follow locale immediately; translation defaults on and toggles originals without altering sends',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,1440,{translate:true});try{
  const guest=await f.page();await guest.getByLabel('输入消息').fill('Synthetic source');await guest.getByRole('button',{name:'发送',exact:true}).click();
  const merchant=await f.page(true);await merchant.getByLabel('会话对象列表').locator('[data-conversation-id^="guest:"]').click();
  const toggle=merchant.getByRole('switch',{name:'翻译聊天内容',exact:true});assert.equal(await toggle.getAttribute('aria-checked'),'true');await merchant.getByLabel('聊天记录').getByText('Translated Synthetic source',{exact:true}).waitFor();
  await toggle.click();await merchant.getByLabel('聊天记录').getByText('Synthetic source',{exact:true}).waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');
  await merchant.getByRole('button',{name:'Spanish',exact:true}).click();await merchant.getByLabel('会话对象列表').getByText('Invitado 12345678',{exact:true}).waitFor();assert.equal(await merchant.locator('[data-guest-avatar]').first().innerText(),'');assert.equal(await merchant.locator('[data-guest-avatar] svg').count(),2);
  await merchant.getByRole('button',{name:'English',exact:true}).click();await merchant.getByLabel('会话对象列表').getByText('Guest 12345678',{exact:true}).waitFor();
  await toggle.click();await merchant.getByLabel('聊天记录').getByText('Translated Synthetic source',{exact:true}).waitFor();
  await merchant.getByLabel('输入消息').fill('Original outbound');await merchant.getByRole('button',{name:'发送',exact:true}).click();await merchant.getByLabel('聊天记录').getByText('Translated Original outbound',{exact:true}).waitFor();assert.equal([...f.threads.values()][0].messages.at(-1).text,'Original outbound');
  assert.ok(!JSON.stringify(await merchant.evaluate(()=>({...localStorage}))).includes('Synthetic source'),'private translation is never in localStorage');
 }finally{await f.close();await browser.close();}
});

test('attachment failures retain draft; a late upload cannot populate another visitor thread',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,1440);try{
  const first=await f.page(),second=await f.page();
  for(const[p,text]of[[first,'First visitor'],[second,'Second visitor']]){await p.getByLabel('输入消息').fill(text);await p.getByRole('button',{name:'发送',exact:true}).click();await p.getByLabel('聊天记录').getByText(text,{exact:true}).waitFor();}
  f.failUpload=true;await first.getByLabel('输入消息').fill('Keep failed upload caption');await first.getByLabel('图片 / 文件',{exact:true}).setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic')});await first.getByRole('alert').filter({hasText:'Synthetic upload unavailable'}).waitFor();assert.equal(await first.getByLabel('输入消息').inputValue(),'Keep failed upload caption');assert.equal([...f.threads.values()][0].messages.length,1);f.failUpload=false;
  const merchant=await f.page(true),list=merchant.getByLabel('会话对象列表'),[id1,id2]=[...f.threads.keys()];await list.locator(`[data-conversation-id="guest:${id1}"]`).click();await merchant.getByLabel('聊天记录').getByText('First visitor',{exact:true}).waitFor();await merchant.getByLabel('输入消息').fill('First visitor caption');
  const started=f.holdUpload();await merchant.getByLabel('图片 / 文件',{exact:true}).setInputFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic')});await started;await list.locator(`[data-conversation-id="guest:${id2}"]`).click();await merchant.getByLabel('聊天记录').getByText('Second visitor',{exact:true}).waitFor();f.releaseUpload();await merchant.getByLabel('输入消息').fill('Second visitor draft');assert.equal(await merchant.locator('[data-chat-attachment-preview]').count(),0);
  await list.locator(`[data-conversation-id="guest:${id1}"]`).click();await merchant.waitForFunction(()=>document.querySelector('[data-guest-chat] textarea')?.value==='First visitor caption');assert.equal(await merchant.locator('[data-chat-attachment-preview]').count(),0);assert.equal([...f.threads.values()].reduce((n,t)=>n+t.messages.length,0),2);
 }finally{await f.close();await browser.close();}
});

test('removing refresh still receives account messages on resume without clearing an employee draft',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,1440);try{
  const merchant=await f.page(true);await merchant.getByLabel('消息内容').fill('Keep employee account draft');f.incomingAccount('New incoming account message');await merchant.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await merchant.getByText('New incoming account message',{exact:true}).last().waitFor();assert.equal(await merchant.getByLabel('消息内容').inputValue(),'Keep employee account draft');assert.equal(f.writes.filter(write=>write.body?.action==='send').length,0);
 }finally{await f.close();await browser.close();}
});
