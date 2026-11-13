// Real React UI and real browser origin/cookie boundaries. Every HTTP request
// is synthetic; no production account, real credential or business write.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const merchantOrigin='https://synthetic.faolla.com',portalOrigin='https://launch.faolla.com',siteId='99990001';
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';
const fixtures={
 'next/dynamic':`import React from 'react';export default function dynamic(load,options={}){return function Deferred(props){const[C,setC]=React.useState(null);React.useEffect(()=>{let active=true;load().then(m=>{if(active)setC(()=>m.default||m)});return()=>{active=false}},[]);return C?React.createElement(C,props):options.loading?React.createElement(options.loading):null}}`,
 'next/link':`import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
 'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
 '@/lib/supabase':`export const isSupabaseEnabled=false;export const supabase=null;export const getResolvedSupabaseUrl=()=>'';export const resolvedSupabaseAnonKey='';`,
 '@/components/blocks/BlockRenderer':`import React from'react';export default function Blocks(){return <a href="https://other.faolla.com/" target="_top">Synthetic directory merchant</a>}`,
 '@/components/admin/MerchantBusinessCardManager':`import React from'react';export default function Cards(){return <p>Synthetic card manager boundary</p>}`,
};
const plugin={name:'service-fixtures',setup(b){b.onResolve({filter:/^(next\/|@\/)/},a=>Object.hasOwn(fixtures,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:process.cwd()}));}};
const entry=`
import React from'react';import{createRoot}from'react-dom/client';
import{I18nProvider,useI18n}from'./src/components/I18nProvider';import ClientDomTranslator from'./src/components/ClientDomTranslator';
import Actions from'./src/components/PublicWebsiteActions';import Frame from'./src/components/service-center/ServiceFrameClient';
import{ensurePersonalGuestIdentity,savePersonalGuestProfile,upsertPersonalGuestOrder}from'./src/lib/personalGuestSession';
if(window.__seedGuest){ensurePersonalGuestIdentity();savePersonalGuestProfile({displayName:'Synthetic guest'});upsertPersonalGuestOrder({id:'OGUEST',siteId:'${siteId}',siteName:'Synthetic venue',status:'pending',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z',customer:{name:'Guest',phone:'',email:'',note:''},items:[{productId:'p1',name:'Synthetic guest product',quantity:1,unitPrice:9,unitPriceText:'€9.00'}],totalQuantity:1,totalAmount:9,pricePrefix:'€'});}
function Website(){const{setLocale}=useI18n();return <main data-public-merchant-site="${siteId}" style={{minHeight:2200,padding:24,background:'#091322',color:'white'}}>
<div style={{position:'fixed',right:20,top:20,zIndex:20000}}><Actions siteId="${siteId}" siteName="Synthetic venue" serviceOrigin="${portalOrigin}"/></div>
<h1 data-merchant-heading style={{marginTop:100}}>Tu próxima partida empieza aquí.</h1><nav>Inicio</nav>
<div data-no-translate="1"><button onClick={()=>setLocale('es-ES')}>Switch Spanish</button><button onClick={()=>setLocale('zh-CN')}>Switch Chinese</button></div>
</main>}
const query=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<I18nProvider initialLocale="zh-CN">{location.pathname==='/service-center'?<Frame siteId={query.get('siteId')} siteName="Synthetic venue" parentOrigin={query.get('parentOrigin')} nonce={query.get('nonce')} initialSection={query.get('section')}/>:<Website/>}<ClientDomTranslator/></I18nProvider>);
`;
const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:entry},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',plugins:[plugin],define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'})).outputFiles[0].text;
const utilityCss=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/service-center";\n@source "./src/components/PublicWebsiteActions.tsx";', {from:path.resolve('service-center-acceptance.css')})).css;
const css=utilityCss+'\n.faolla-service-sheet{height:82dvh;max-height:82dvh;padding-bottom:env(safe-area-inset-bottom)}.faolla-service-sheet::backdrop{background:#02061755}body{margin:0}';
const profile={nickname:'Synthetic visitor',name:'Synthetic visitor',email:'visitor@example.invalid',phone:'000',birthday:'01-01',birthdayMonthDayOnly:true};
async function setup(browser,width,{logged=true,seedGuest=false}={}){
 const context=await browser.newContext({viewport:{width,height:900},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});
 if(logged)await context.addCookies([{name:'__Host-faolla-merchant-auth-v2',value:'synthetic-cookie',url:portalOrigin,secure:true,httpOnly:true,sameSite:'Lax'}]);
 await context.addInitScript(value=>{window.__seedGuest=value;window.__messages=[];window.addEventListener('message',event=>{if(event.data?.type==='faolla:merchant-service')window.__messages.push(event.data);});},seedGuest);
 const state={favorite:false,logged,sessionStatus:200,member:'none',threads:[],requests:[],writes:[],unexpected:[],errors:[],history:[{points:80,order:'ORIGINAL',balance:25}]};
 const originalHistory=structuredClone(state.history);
 const favorite=()=>({id:siteId,url:`https://faolla.com/site/${siteId}`,name:'Synthetic venue',subtitle:'',addedAt:'2026-11-01'});
 const membership=()=>({id:'synthetic-member',siteId,siteName:'Synthetic venue',memberNo:'99990001000001',qrValue:'SYNTHETIC-QR',status:state.member==='left'?'left':'active',joinedAt:'2026-11-01',leftAt:state.member==='left'?'2026-11-13':null});
 const identity=()=>({ok:true,authenticated:state.logged,accountId:state.logged?'50010105':'',profile,memberships:state.member==='none'?[]:[membership()],favoriteSites:state.favorite?[favorite()]:[]});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>state.errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());state.requests.push({url:request.url(),method:request.method(),origin:request.headers().origin||'',cookie:request.headers().cookie||''});
  if(url.hostname==='translate.googleapis.com'){
   const q=url.searchParams.get('q')||'',target=url.searchParams.get('tl');assert.doesNotMatch(q,/Synthetic (?:visitor|incoming message|outgoing message)|visitor@example\.invalid/,'private content must not enter automatic translation');const dictionary={'Tu próxima partida empieza aquí.':'你的下一场游戏从这里开始。','Inicio':'首页'};
   return route.fulfill({json:[[[target==='zh-CN'?(dictionary[q]||q):q,q]]]});
  }
  if(![merchantOrigin,portalOrigin].includes(url.origin)){state.unexpected.push(url.href);return route.abort();}
  if(request.isNavigationRequest()){
   if(url.pathname==='/service-center'){
    assert.equal(url.origin,portalOrigin);assert.equal(url.searchParams.get('parentOrigin'),merchantOrigin);
    const headers={'content-security-policy':`frame-ancestors ${merchantOrigin}`};
    return route.fulfill({contentType:'text/html',headers,body:html+`<style>${css}</style><script>${script.replaceAll('</script>','<\\/script>')}</script>`});
   }
   return route.fulfill({contentType:'text/html',body:html+`<style>${css}</style><script>${script.replaceAll('</script>','<\\/script>')}</script>`});
  }
  if(url.pathname==='/api/merchant-service/status'){
   assert.equal(url.origin,portalOrigin);assert.equal(request.headers().origin,merchantOrigin);
   return route.fulfill({headers:{'access-control-allow-origin':merchantOrigin,'access-control-allow-credentials':'true','cache-control':'no-store'},json:{ok:true,authenticated:state.logged,favorited:state.favorite}});
  }
  if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/platform-published'){
   assert.equal(url.origin,portalOrigin,'all personal IO must stay inside the login origin');
   if(logged)assert.match(request.headers().cookie||'',/__Host-faolla-merchant-auth-v2=synthetic-cookie/);
  }
  if(request.method()==='POST'){
   state.writes.push({path:url.pathname,body:request.postDataJSON(),origin:request.headers().origin||url.origin});
   if(url.pathname==='/api/personal-favorites'){
    const body=request.postDataJSON();assert.equal(body.siteId,siteId);assert.equal(logged,true);
    if(body.action==='favorite'){state.favorite=true;state.member='active';}else if(body.action==='unfavorite'){state.favorite=false;state.member='left';}else assert.fail('unexpected mutation');
    return route.fulfill({json:{ok:true,favorited:state.favorite,siteId,membership:membership()}});
   }
   if(url.pathname==='/api/merchant-peer-messages'){
    const body=request.postDataJSON();assert.equal(body.siteId,'50010105');
    if(body.action==='mark_read'){assert.equal(body.contactMerchantId,siteId);return route.fulfill({json:{ok:true}});}
    if(body.action==='send'){
     assert.equal(body.recipientMerchantId,siteId);
     const message={id:'synthetic-outbound',text:body.text,senderMerchantId:'50010105',createdAt:'2026-11-13T12:00:00Z'};
     state.threads=[{threadKey:'synthetic-thread',merchantAId:'50010105',merchantBId:siteId,messages:[...(state.threads[0]?.messages||[]),message]}];
     return route.fulfill({json:{ok:true,threads:state.threads,contacts:[]}});
    }
   }
   state.unexpected.push(request.url());return route.abort();
  }
  if(url.pathname==='/api/auth/merchant-session')return route.fulfill({status:state.sessionStatus,json:{authenticated:state.logged,accountType:state.logged?'personal':undefined}});
  if(url.pathname==='/api/personal-favorites')return route.fulfill({json:identity()});
  if(url.pathname==='/api/personal-profile')return route.fulfill({json:{ok:true,profile,businessCards:[]}});
  if(url.pathname==='/api/orders')return route.fulfill({json:{ok:true,orders:[{id:'OSYNTHETIC',siteId,siteName:'Synthetic venue',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z',status:'pending',customer:{name:'Visitor',phone:'000',email:'visitor@example.invalid',note:''},items:[{name:'Synthetic account product',quantity:2,unitPriceText:'€10',subtotal:20}],pricePrefix:'€',totalAmount:20,totalQuantity:2}]}});
  if(url.pathname==='/api/bookings')return route.fulfill({json:{ok:true,bookings:[]}});
  if(url.pathname==='/api/merchant-peer-messages'||url.pathname==='/api/support-messages')return route.fulfill({json:{ok:true,threads:url.pathname==='/api/merchant-peer-messages'?state.threads:[],contacts:[],thread:null}});
  if(url.pathname==='/api/platform-published')return route.fulfill({json:{blocks:[{id:'directory',type:'merchant-list',props:{}}]}});
  state.unexpected.push(url.href);return route.abort();
 });
 return {context,page,state,async open(){await page.goto(merchantOrigin+'/?uiLocale=es-ES');},async close(){await context.close();assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.history,originalHistory);}};
}
const serviceFrame=page=>page.frameLocator('iframe[data-isolated-service-frame]');
async function menu(page){await page.getByRole('button',{name:'服务中心',exact:true}).click();await page.getByRole('dialog').waitFor();}
async function choose(page,label){const ids={'订单':'orders','会话':'conversations','我的':'account','Faolla':'directory'};await page.getByRole('dialog').locator(`[data-service-section="${ids[label]}"]`).click();}

test('desktop and mobile keep the merchant document and load one isolated personal surface only on selection',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width);try{
   await f.page.clock.install();await f.open();await f.page.clock.runFor(1500);await f.page.getByRole('button',{name:'收藏并加入本店会员'}).waitFor();
   assert.equal(await f.page.locator('iframe').count(),0);assert.equal(f.state.requests.filter(r=>r.url.includes('/api/personal-')).length,0);
   assert.equal(f.state.requests.filter(r=>r.url.includes('/api/auth/')).length,0);
   assert.equal(f.state.requests.filter(r=>r.url.startsWith(merchantOrigin)&&r.cookie).length,0);
   await f.page.evaluate(()=>{document.querySelector('[data-merchant-heading]').dataset.identity='preserved';window.scrollTo(0,350)});
   await menu(f.page);assert.equal(await f.page.locator('iframe').count(),0);
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-menu-${width}.png`)});
   const bounds=await f.page.getByRole('dialog').boundingBox();assert.ok(bounds.y>=120,'visible merchant backdrop stays above the sheet');
   await choose(f.page,'订单');await serviceFrame(f.page).getByText('Synthetic account product × 2',{exact:true}).waitFor();
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-orders-${width}.png`)});
   assert.equal(await f.page.locator('iframe').count(),1);
   assert.equal(await f.page.locator('iframe').evaluate(frame=>frame.contentDocument===null),true,'merchant scripts cannot read personal DOM');
   const src=await f.page.locator('iframe').getAttribute('src');assert.doesNotMatch(src,/\/me\?|access_token|refresh_token/);
   await f.page.getByRole('button',{name:'返回服务中心',exact:true}).click();await choose(f.page,'会话');await serviceFrame(f.page).getByLabel('输入消息').waitFor();
   await serviceFrame(f.page).getByLabel('输入消息').fill('Synthetic unsent draft');
   assert.equal(await f.page.locator('iframe').getAttribute('src'),src);
   await f.page.mouse.click(10,20);await f.page.waitForFunction(()=>!document.querySelector('dialog').open);
   await serviceFrame(f.page).locator('[data-service-active="false"]').waitFor({state:'attached'});
   const beforeCloseCount=f.state.requests.length;await f.page.clock.fastForward(20000);assert.equal(f.state.requests.length,beforeCloseCount,'closed panels stop polling');
   await menu(f.page);await choose(f.page,'会话');assert.equal(await serviceFrame(f.page).getByLabel('输入消息').inputValue(),'Synthetic unsent draft');
   await f.page.keyboard.press('Escape');await f.page.waitForFunction(()=>!document.querySelector('dialog').open);
   assert.equal(await f.page.evaluate(()=>document.querySelector('[data-merchant-heading]').dataset.identity),'preserved');
   assert.equal(await f.page.evaluate(()=>scrollY),350);
   assert.equal(new URL(f.page.url()).origin,merchantOrigin);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual(f.state.writes,[]);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('favorite joins, hides its entry, and can only be canceled in My favorites without clearing history',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  await f.open();await f.page.getByRole('button',{name:'收藏并加入本店会员'}).click();
  await serviceFrame(f.page).getByRole('button',{name:'收藏并加入会员',exact:true}).click();
  await f.page.waitForFunction(()=>!document.querySelector('button[aria-label="收藏并加入本店会员"]'));
  assert.equal(f.state.favorite,true);assert.equal(f.state.member,'active');
  await choose(f.page,'我的');await serviceFrame(f.page).getByRole('button',{name:'收藏 →',exact:true}).click();
  await serviceFrame(f.page).getByRole('button',{name:'取消收藏',exact:true}).click();
  await serviceFrame(f.page).getByRole('button',{name:'确认取消并退会',exact:true}).click();
  await f.page.waitForFunction(()=>!!document.querySelector('button[aria-label="收藏并加入本店会员"]'));
  assert.equal(f.state.member,'left');assert.equal(f.state.favorite,false);
  assert.deepEqual(f.state.writes.map(row=>row.body.action),['favorite','unfavorite']);
  const messages=await f.page.evaluate(()=>window.__messages);for(const data of messages){assert.deepEqual(Object.keys(data).filter(key=>!['type','nonce','siteId','event','favorited'].includes(key)),[]);}
 }finally{await f.close();await browser.close();}
});

test('guests see neither join nor favorite, retain local orders, and can dismiss or change language without navigation',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390,{logged:false,seedGuest:true});try{
  await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));
  assert.equal(await f.page.getByRole('button',{name:'收藏并加入本店会员'}).count(),0);
  assert.equal(await f.page.getByRole('button',{name:'加入',exact:true}).count(),0);
  await menu(f.page);await choose(f.page,'订单');await f.page.getByText('Synthetic guest product × 1',{exact:true}).waitFor();
  assert.equal(await f.page.locator('iframe').count(),0);
  const before=await f.page.evaluate(()=>localStorage.getItem('faolla:personal-guest-orders:v1'));
  await f.page.keyboard.press('Escape');await f.page.getByRole('button',{name:'Switch Chinese',exact:true}).click();
  await f.page.getByRole('heading',{name:'你的下一场游戏从这里开始。',exact:true}).waitFor();
  assert.equal(new URL(f.page.url()).searchParams.get('uiLocale'),'zh-CN');
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('faolla:personal-guest-orders:v1')),before);
  assert.deepEqual(f.state.writes,[]);
 }finally{await f.close();await browser.close();}
});

test('an expired isolated session offers login instead of retaining another private account surface',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  await f.open();await f.page.getByRole('button',{name:'收藏并加入本店会员'}).waitFor();
  await menu(f.page);await choose(f.page,'我的');await serviceFrame(f.page).getByText('Synthetic visitor',{exact:true}).waitFor();
  f.state.logged=false;f.state.sessionStatus=401;
  await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).click();await menu(f.page);await choose(f.page,'我的');
  await serviceFrame(f.page).getByRole('link',{name:'用户登录 / 注册',exact:true}).waitFor();
  assert.equal(await serviceFrame(f.page).getByText('Synthetic visitor',{exact:true}).count(),0);
  assert.equal(await serviceFrame(f.page).getByRole('alert').count(),0);
  assert.deepEqual(f.state.writes,[]);
 }finally{await f.close();await browser.close();}
});

test('visible conversations retain normal send and read receipts, without replay when reopened',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  f.state.threads=[{threadKey:'synthetic-thread',merchantAId:'50010105',merchantBId:siteId,messages:[{id:'synthetic-inbound',text:'Synthetic incoming message',senderMerchantId:siteId,createdAt:'2026-11-13T10:00:00Z'}]}];
  await f.open();await f.page.getByRole('button',{name:'收藏并加入本店会员'}).waitFor();
  assert.equal(f.state.writes.length,0);
  const readReceipt=f.page.waitForResponse(r=>r.request().method()==='POST'&&r.request().postDataJSON()?.action==='mark_read');
  await menu(f.page);await choose(f.page,'会话');await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic incoming message',{exact:true}).waitFor();
  await readReceipt;
  await serviceFrame(f.page).getByLabel('输入消息').fill('Synthetic outgoing message');
  await serviceFrame(f.page).getByRole('button',{name:'发送',exact:true}).click();
  await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic outgoing message',{exact:true}).waitFor();
  await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).click();await menu(f.page);await choose(f.page,'会话');
  await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic outgoing message',{exact:true}).waitFor();
  assert.deepEqual(f.state.writes.map(row=>row.body.action),['mark_read','send']);
 }finally{await f.close();await browser.close();}
});
