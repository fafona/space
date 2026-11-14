// Real React UI and real browser origin/cookie boundaries. Every HTTP request
// is synthetic; no production account, real credential or business write.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import QRCode from 'qrcode';

const merchantOrigin='https://synthetic.faolla.com',portalOrigin='https://launch.faolla.com',siteId='99990001';
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';
const fixtures={
 'next/dynamic':`import React from 'react';export default function dynamic(load,options={}){return function Deferred(props){const[C,setC]=React.useState(null);React.useEffect(()=>{let active=true;load().then(m=>{if(active)setC(()=>m.default||m)});return()=>{active=false}},[]);return C?React.createElement(C,props):options.loading?React.createElement(options.loading):null}}`,
 'next/link':`import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
 'next/navigation':`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);export const useParams=()=>({});`,
 '@/lib/supabase':`export const isSupabaseEnabled=false;export const supabase=null;export const getResolvedSupabaseUrl=()=>'';export const resolvedSupabaseAnonKey='';export const legacySupabaseAuthStorageKey='synthetic-legacy-key';export const resolvedSupabaseAuthStorageKey='synthetic-auth-key';`,
 '@/components/blocks/BlockRenderer':`import React from'react';import MerchantListBlock from'./src/components/blocks/MerchantListBlock';export default function Blocks({blocks}){return window.__realDirectory?<>{blocks.filter(block=>block.type==='merchant-list').map(block=><MerchantListBlock key={block.id} {...block.props}/>)}</>:<a href="https://other.faolla.com/" target="_top">Synthetic directory merchant</a>}`,
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
async function setup(browser,width,{logged=true,seedGuest=false,height=900,cameraDenied=false,realDirectory=false}={}){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<768,hasTouch:width<768,serviceWorkers:'block'});
 if(logged)await context.addCookies([{name:'__Host-faolla-merchant-auth-v2',value:'synthetic-cookie',url:portalOrigin,secure:true,httpOnly:true,sameSite:'Lax'}]);
 await context.addInitScript(value=>{window.__seedGuest=value.seedGuest;window.__realDirectory=value.realDirectory;window.__messages=[];window.addEventListener('message',event=>{if(event.data?.type==='faolla:merchant-service')window.__messages.push(event.data);});},{seedGuest,realDirectory});
 const state={favorite:false,logged,sessionStatus:200,member:'none',profile:{...profile},profileDraft:{},businessCards:[],coupons:[],uploadFails:false,logoutFails:false,qrToken:'synthetic-qr-token-original',contacts:[],threads:[],requests:[],writes:[],unexpected:[],errors:[],history:[{points:80,order:'ORIGINAL',balance:25}]};
 const originalHistory=structuredClone(state.history);
 const favorite=()=>({id:siteId,url:`https://faolla.com/site/${siteId}`,name:'Synthetic venue',subtitle:'',addedAt:'2026-11-01'});
 const membership=()=>({id:'synthetic-member',siteId,siteName:'Synthetic venue',memberNo:'99990001000001',qrValue:'SYNTHETIC-QR',status:state.member==='left'?'left':'active',joinedAt:'2026-11-01',leftAt:state.member==='left'?'2026-11-13':null});
 const identity=()=>({ok:true,authenticated:state.logged,accountId:state.logged?'50010105':'',profile:state.profile,memberships:state.member==='none'?[]:[membership()],favoriteSites:state.favorite?[favorite()]:[]});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>state.errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());state.requests.push({url:request.url(),method:request.method(),origin:request.headers().origin||'',cookie:request.headers().cookie||''});
  if(url.hostname==='translate.googleapis.com'){
   const q=url.searchParams.get('q')||'',target=url.searchParams.get('tl');assert.doesNotMatch(q,/Synthetic (?:visitor|incoming message|outgoing message)|visitor@example\.invalid/,'private content must not enter automatic translation');const dictionary={'Tu próxima partida empieza aquí.':'你的下一场游戏从这里开始。','Inicio':'首页'};
   return route.fulfill({json:[[[target==='zh-CN'?(dictionary[q]||q):q,q]]]});
  }
  if(realDirectory&&url.origin==='https://haoyouduo.faolla.com'&&request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><h1>Synthetic destination merchant</h1>'});
  if(![merchantOrigin,portalOrigin].includes(url.origin)){state.unexpected.push(url.href);return route.abort();}
  if(request.isNavigationRequest()){
   if(url.pathname==='/service-center'){
    assert.equal(url.origin,portalOrigin);assert.equal(url.searchParams.get('parentOrigin'),merchantOrigin);
    const headers={'content-security-policy':`frame-ancestors ${merchantOrigin}`,...(cameraDenied?{'permissions-policy':'camera=(), microphone=(), payment=()'}:{})};
    return route.fulfill({contentType:'text/html',headers,body:html+`<style>${css}</style><script>${script.replaceAll('</script>','<\\/script>')}</script>`});
   }
   return route.fulfill({contentType:'text/html',headers:cameraDenied?{'permissions-policy':'camera=(), microphone=(), payment=()'}:{},body:html+`<style>${css}</style><script>${script.replaceAll('</script>','<\\/script>')}</script>`});
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
   state.writes.push({path:url.pathname,body:request.postData()?request.postDataJSON():null,origin:request.headers().origin||url.origin});
   if(url.pathname==='/api/auth/merchant-logout'){
    if(state.logoutFails)return route.fulfill({status:503,json:{ok:false}});
    state.logged=false;state.sessionStatus=401;return route.fulfill({json:{ok:true}});
   }
   if(url.pathname==='/api/faolla-qr-token'){
    assert.deepEqual(request.postDataJSON(),{action:'reset',type:'personal',id:'50010105'});state.qrToken='synthetic-qr-token-reset';return route.fulfill({json:{ok:true,token:state.qrToken}});
   }
   if(url.pathname==='/api/assets/upload'){
    const body=request.postDataJSON();assert.equal(logged,true);assert.equal(body.merchantHint,'50010105');assert.ok(['support-image','generic-image'].includes(body.usage));
    if(state.uploadFails)return route.fulfill({status:503,json:{ok:false,message:'Synthetic upload rejected'}});
    return route.fulfill({json:{ok:true,url:portalOrigin+'/synthetic-upload.png'}});
   }
   if(url.pathname==='/api/personal-profile'){
    assert.equal(logged,true);const body=request.postDataJSON();assert.deepEqual(Object.keys(body),['profile']);
    state.profileDraft={...state.profileDraft,...body.profile};return route.fulfill({json:{ok:true,profile:state.profileDraft}});
   }
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
  if(url.pathname==='/synthetic-avatar.svg')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#ede9fe"/><circle cx="40" cy="29" r="12" fill="#8b5cf6"/><path d="M16 76v-8a24 24 0 0 1 48 0v8" fill="#8b5cf6"/></svg>'});
  if(url.pathname==='/api/faolla-qr-token'){assert.equal(state.logged,true);assert.equal(url.searchParams.get('type'),'personal');assert.equal(url.searchParams.get('id'),'50010105');return route.fulfill({json:{ok:true,token:state.qrToken}});}
  if(url.pathname==='/api/app-web-version')return route.fulfill({json:{ok:true,buildId:'synthetic-build'}});
  if(url.pathname==='/downloads/faolla-android-version.json')return route.fulfill({json:{version:'1.0',build:33,apkUrl:'/downloads/faolla-android.apk'}});
  if(url.pathname==='/faolla-app-icon-192.png')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#0f172a"/><text x="26" y="55" font-size="42" fill="white">F</text></svg>'});
  if(url.pathname==='/synthetic-upload.png')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  if(url.pathname==='/api/personal-profile')return route.fulfill({json:{ok:true,profile:{...state.profile,displayName:state.profile.nickname,birthday:'2000-01-01',...state.profileDraft},businessCards:state.businessCards}});
  if(url.pathname==='/api/personal-coupons')return route.fulfill({json:{ok:true,coupons:state.coupons}});
  if(url.pathname==='/api/orders')return route.fulfill({json:{ok:true,orders:[{id:'OSYNTHETIC',siteId,siteName:'Synthetic venue',createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z',status:'pending',customer:{name:'Visitor',phone:'000',email:'visitor@example.invalid',note:''},items:[{name:'Synthetic account product',quantity:2,unitPriceText:'€10',subtotal:20}],pricePrefix:'€',totalAmount:20,totalQuantity:2}]}});
  if(url.pathname==='/api/bookings')return route.fulfill({json:{ok:true,bookings:[]}});
  if(url.pathname==='/api/merchant-peer-messages'||url.pathname==='/api/support-messages')return route.fulfill({json:{ok:true,threads:url.pathname==='/api/merchant-peer-messages'?state.threads:[],contacts:state.contacts,thread:null}});
  if(url.pathname==='/api/platform-published')return route.fulfill({json:{blocks:[{id:'directory',type:'merchant-list',props:realDirectory?{maxItems:6,publishedMerchantSnapshot:[{id:'99990002',name:'Synthetic directory merchant',industry:'娱乐',country:'Spain',province:'Sevilla',city:'Sevilla',status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z',domainPrefix:'haoyouduo',ownerEmail:'directory@example.invalid',registeredAt:'2026-01-01T00:00:00Z'}]}:{}}]}});
  state.unexpected.push(url.href);return route.abort();
 });
 return {context,page,state,async open(){await page.goto(merchantOrigin+'/?uiLocale=es-ES');},async close(){await context.close();assert.deepEqual(state.errors,[]);assert.deepEqual(state.unexpected,[]);assert.deepEqual(state.history,originalHistory);}};
}
const serviceFrame=page=>page.frameLocator('iframe[data-isolated-service-frame]');
async function menu(page){await page.getByRole('button',{name:'服务中心',exact:true}).click();await page.getByRole('dialog').waitFor();}
async function choose(page,label){const ids={'订单':'orders','会话':'conversations','我的':'account','Faolla':'directory'};await page.getByRole('dialog').locator(`[data-service-section="${ids[label]}"]`).click();}
async function openThread(surface,id=siteId){await surface.locator(`[data-conversation-id="${id}"]`).click();}

test('service center Faolla real merchant cards navigate to sibling merchants, never a nested merchant subdomain',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width,{logged:false,realDirectory:true});try{
   await f.open();await f.page.waitForResponse(response=>response.url().includes('/api/merchant-service/status'));await menu(f.page);await choose(f.page,'Faolla');
   const card=f.page.getByRole('dialog').locator('[data-service-directory]').getByRole('link').filter({hasText:'Synthetic directory merchant'});await card.waitFor();
   assert.equal(await card.getAttribute('href'),'https://haoyouduo.faolla.com?uiLocale=es-ES');assert.equal(await card.getAttribute('target'),'_top');
   await card.click();await f.page.getByRole('heading',{name:'Synthetic destination merchant',exact:true}).waitFor();
   const destination=new URL(f.page.url());assert.equal(destination.origin,'https://haoyouduo.faolla.com');assert.deepEqual([...destination.searchParams],[['uiLocale','es-ES']]);
   assert.equal(f.page.frames().length,1);assert.deepEqual(f.state.writes,[]);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('My retains QR generation/share/reset/scan, tools, games, complete settings and host-synchronized language without bringing back an app shell',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width);try{
   await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await f.page.getByRole('button',{name:'Switch Chinese',exact:true}).click();
   await menu(f.page);await choose(f.page,'我的');const surface=serviceFrame(f.page),account=surface.locator('[data-service-account]');
   await account.locator('[data-account-section="qr"]').waitFor();assert.equal(f.state.requests.filter(request=>request.url.includes('/api/faolla-qr-token')||request.url.includes('/api/app-web-version')||request.url.includes('/downloads/faolla-android-version')).length,0);
   const src=await f.page.locator('iframe').getAttribute('src');await account.locator('[data-account-section="qr"]').click();const qr=account.locator('[data-service-personal-qr]');
   await qr.getByRole('img',{name:'Faolla 二维码',exact:true}).evaluate(image=>image.decode());const before=await qr.getByRole('img',{name:'Faolla 二维码',exact:true}).getAttribute('src');
   await qr.evaluate(()=>{window.__cameraRequests=0;Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__syntheticShare=payload}});Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__cameraRequests++;throw new DOMException('Synthetic camera refusal','NotAllowedError')}}})});
   await qr.getByRole('button',{name:'分享二维码',exact:true}).click();let shared=await qr.evaluate(()=>window.__syntheticShare);assert.equal(new URL(shared.url).searchParams.get('token'),'synthetic-qr-token-original');
   await qr.getByRole('button',{name:'重置二维码',exact:true}).click();await qr.getByText('二维码已重置',{exact:true}).waitFor();
   await qr.getByRole('img',{name:'Faolla 二维码',exact:true}).evaluate((image,old)=>new Promise((resolve,reject)=>{const end=Date.now()+5000;const timer=setInterval(()=>{if(image.src!==old){clearInterval(timer);resolve(true)}else if(Date.now()>end){clearInterval(timer);reject(Error('QR did not change'))}},10)}),before);
   await qr.getByRole('button',{name:'分享二维码',exact:true}).click();shared=await qr.evaluate(()=>window.__syntheticShare);assert.equal(new URL(shared.url).searchParams.get('token'),'synthetic-qr-token-reset');
   assert.equal(await qr.evaluate(()=>window.__cameraRequests),0,'the camera is not requested until Scan is clicked');await qr.getByRole('button',{name:'扫描',exact:true}).click();await qr.getByText('无法打开摄像头，请检查浏览器权限',{exact:true}).waitFor();assert.equal(await qr.evaluate(()=>window.__cameraRequests),1);
   await qr.evaluate(()=>{window.__stoppedCameraTracks=0;window.__fakeCameraOpened=false;HTMLMediaElement.prototype.play=async()=>{};navigator.mediaDevices.getUserMedia=async()=>{window.__cameraRequests++;const stream=new MediaStream();Object.defineProperty(stream,'getTracks',{value:()=>[{stop:()=>window.__stoppedCameraTracks++}]});window.__fakeCameraOpened=true;return stream}});
   const qrFrame=f.page.frames().find(frame=>new URL(frame.url()).pathname==='/service-center');
   await qr.getByRole('button',{name:'扫描',exact:true}).click();await qrFrame.waitForFunction(()=>window.__fakeCameraOpened&&document.querySelector('video')?.srcObject);
   await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).click();await qrFrame.waitForFunction(()=>window.__stoppedCameraTracks>0,null,{polling:25});await menu(f.page);await choose(f.page,'我的');await qr.getByRole('img',{name:'Faolla 二维码',exact:true}).waitFor();
   await account.getByRole('button',{name:'← 返回我的',exact:true}).click();await account.locator('[data-account-section="tools"]').click();assert.equal(await account.getByRole('link',{name:'双扣计分',exact:true}).getAttribute('href'),'/me/tools/shuangkoujifen');
   await account.getByRole('button',{name:'← 返回我的',exact:true}).click();await account.locator('[data-account-section="games"]').click();assert.equal(await account.getByRole('link',{name:'坦克大战',exact:true}).getAttribute('href'),'/me/games/tank-battle');assert.equal(await account.getByRole('link',{name:'不服再战',exact:true}).getAttribute('href'),'/me/games/bufuzai');
   await account.getByRole('button',{name:'← 返回我的',exact:true}).click();await account.locator('[data-account-section="more"]').click();
   const settings=account.locator('[data-service-account-settings]');await settings.getByRole('button',{name:'通知 系统通知、提示音和震动设置',exact:true}).click();await settings.getByRole('switch',{name:'系统消息通知',exact:true}).waitFor();assert.equal(await settings.getByRole('switch',{name:'系统消息通知',exact:true}).isDisabled(),true);
   await settings.getByRole('button',{name:'← 返回设置上级',exact:true}).click();await settings.getByRole('button',{name:/关于 Faolla/}).click();await settings.getByText('Faolla',{exact:true}).waitFor();
   await settings.getByRole('button',{name:/版本更新/}).click();await settings.getByRole('button',{name:'仅 Android App 支持',exact:true}).waitFor();assert.equal(await settings.getByRole('button',{name:'仅 Android App 支持',exact:true}).isDisabled(),true);
   await settings.getByRole('button',{name:'← 返回设置上级',exact:true}).click();await settings.getByRole('button',{name:/法律 服务条款/}).click();
   for(const title of ['服务条款','隐私政策','Cookie 使用政策','法律声明']){await settings.getByRole('button',{name:new RegExp('^'+title)}).click();await settings.getByRole('heading',{name:title,exact:true}).waitFor();await settings.getByRole('button',{name:'← 返回设置上级',exact:true}).click();}
   await account.getByRole('button',{name:'← 返回我的',exact:true}).click();await account.locator('[data-account-section="more"]').click();await settings.locator('#service-account-language').selectOption('es-ES');await f.page.waitForURL(url=>url.searchParams.get('uiLocale')==='es-ES');assert.equal(await f.page.locator('iframe').getAttribute('src'),src);
   await settings.locator('#service-account-language').selectOption('zh-CN');await f.page.waitForURL(url=>url.searchParams.get('uiLocale')==='zh-CN');assert.equal(await f.page.locator('iframe').count(),1);
   assert.deepEqual(f.state.writes.map(write=>write.path),['/api/faolla-qr-token']);assert.equal(new URL(f.page.url()).origin,merchantOrigin);
   const messages=await f.page.evaluate(()=>window.__messages);assert.doesNotMatch(JSON.stringify(messages),/synthetic-qr-token|visitor@example|Synthetic visitor/);for(const message of messages)assert.deepEqual(Object.keys(message).filter(key=>!['type','nonce','siteId','event','favorited','locale'].includes(key)),[]);
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-retained-settings-${width}.png`)});
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('the existing camera-deny policy stays enforced; local QR image recognition and picker cancel still work without uploads or navigation',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width,{cameraDenied:true});try{
   await f.open();await menu(f.page);await choose(f.page,'我的');const account=serviceFrame(f.page).locator('[data-service-account]');await account.locator('[data-account-section="qr"]').click();const qr=account.locator('[data-service-personal-qr]');
   await qr.getByRole('img',{name:'Faolla 二维码',exact:true}).waitFor();await qr.evaluate(()=>{window.__cameraRequests=0;Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.__cameraRequests++;throw Error('camera must remain denied')}}})});
   assert.equal(await qr.evaluate(()=>(document.permissionsPolicy??document.featurePolicy).allowsFeature('camera')),false);await qr.getByRole('button',{name:'扫描',exact:true}).click();await qr.getByText('当前网页未开放摄像头，请选择二维码图片识别。',{exact:true}).waitFor();assert.equal(await qr.evaluate(()=>window.__cameraRequests),0);
   const input=qr.getByLabel('选择二维码图片',{exact:true});await input.dispatchEvent('cancel');assert.equal(await f.page.getByRole('dialog').isVisible(),true);
   const result=portalOrigin+'/connect?type=personal&id=50010105';await input.setInputFiles({name:'synthetic-qr.png',mimeType:'image/png',buffer:await QRCode.toBuffer(result,{width:400})});await qr.getByText(result,{exact:true}).waitFor();assert.equal(await qr.getByRole('link',{name:'确认打开识别结果',exact:true}).getAttribute('href'),result);assert.equal(await qr.getByRole('link',{name:'确认打开识别结果',exact:true}).getAttribute('target'),'_top');
   await input.setInputFiles({name:'synthetic-unsafe-qr.png',mimeType:'image/png',buffer:await QRCode.toBuffer('javascript:alert(1)',{width:400})});await qr.getByText('此内容不是可直接打开的安全链接。',{exact:true}).waitFor();assert.equal(await qr.getByRole('link',{name:'确认打开识别结果',exact:true}).count(),0);
   await input.setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('not an image')});await qr.getByText('图片无法读取，请重新选择。',{exact:true}).waitFor();assert.equal(await f.page.getByRole('dialog').isVisible(),true);assert.equal(await qr.evaluate(()=>window.__cameraRequests),0);assert.deepEqual(f.state.writes,[]);assert.equal(new URL(f.page.url()).origin,merchantOrigin);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('switch/logout are explicit confirmed operations, never retire memberships or erase history, and a failed logout leaves private state intact',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const fail of [true,false]){
  const f=await setup(browser,390);try{
   f.state.logoutFails=fail;f.state.favorite=true;f.state.member='active';await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await menu(f.page);await choose(f.page,'我的');const surface=serviceFrame(f.page),account=surface.locator('[data-service-account]');
   await account.getByRole('button',{name:'切换账号',exact:true}).click();assert.equal(f.state.writes.length,0);await account.getByRole('button',{name:'取消',exact:true}).click();assert.equal(f.state.writes.length,0);
   await account.getByRole('button',{name:'退出登录',exact:true}).click();await account.getByRole('button',{name:'确认退出当前账号',exact:true}).click();
   if(fail){await account.getByRole('alert').waitFor();await account.getByRole('button',{name:'重新读取账号状态',exact:true}).click();assert.equal(await account.getByText('Synthetic visitor',{exact:true}).count(),1);assert.equal(f.state.logged,true);}
   else {await f.page.getByRole('button',{name:'返回服务中心',exact:true}).waitFor({state:'hidden'});await choose(f.page,'我的');await f.page.getByRole('link',{name:'用户登录 / 注册',exact:true}).waitFor();assert.equal(await serviceFrame(f.page).getByText('Synthetic visitor',{exact:true}).count(),0);assert.equal(f.state.logged,false);}
   assert.equal(f.state.member,'active');assert.equal(f.state.favorite,true);assert.deepEqual(f.state.writes.map(write=>write.path),['/api/auth/merchant-logout']);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('membership dates, original member QR, merchant homepage, QR coupons and barcode redemption detail links remain available',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  f.state.member='active';f.state.favorite=true;f.state.coupons=['qr','barcode'].map(kind=>({id:kind,siteId,siteName:'Synthetic venue',couponId:'coupon-'+kind,couponTitle:'Synthetic '+kind+' coupon',couponDescription:'Synthetic offer',discountLabel:'10%',claimEventId:'claim-'+kind,claimedAt:'2026-11-01T12:00:00Z',validUntil:null,settlementType:kind,settlementCode:'SYNTHETIC-CODE-'+kind}));
  await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await f.page.getByRole('button',{name:'Switch Chinese',exact:true}).click();await menu(f.page);await choose(f.page,'我的');const surface=serviceFrame(f.page),account=surface.locator('[data-service-account]');
  await account.locator('[data-account-section="memberships"]').click();await account.getByText('2026-11-01',{exact:true}).waitFor();await account.getByText('SYNTHETIC-QR',{exact:true}).waitFor();assert.equal(await account.getByRole('link',{name:'商户首页',exact:true}).getAttribute('target'),'_top');assert.equal(await account.getByRole('link',{name:'商户首页',exact:true}).getAttribute('href'),'/site/'+siteId);
  await account.getByText('显示会员二维码',{exact:true}).click();await account.getByRole('img',{name:'会员或优惠券二维码',exact:true}).evaluate(image=>image.decode());
  await account.getByRole('button',{name:'← 返回我的',exact:true}).click();await account.locator('[data-account-section="coupons"]').click();await account.getByText('Synthetic barcode coupon',{exact:true}).waitFor();
  assert.equal(await account.getByText('显示核销码',{exact:true}).count(),1,'a barcode is not incorrectly replaced by a QR image');
  const links=account.getByRole('link',{name:'查看核销码',exact:true});assert.equal(await links.count(),2);for(let i=0;i<2;i++){const href=new URL(await links.nth(i).getAttribute('href'),portalOrigin);assert.match(href.pathname,/^\/coupon\/claim\/claim-(qr|barcode)$/);assert.equal(href.searchParams.get('siteId'),siteId);assert.equal(await links.nth(i).getAttribute('target'),'_top');}
  assert.equal(await account.getByText('2026-11-01 12:00:00',{exact:true}).count(),2);assert.equal(await account.getByText('长期有效',{exact:true}).count(),2);
  assert.deepEqual(f.state.writes,[]);assert.equal(f.state.member,'active');assert.equal(f.state.favorite,true);
 }finally{await f.close();await browser.close();}
});
async function pickProfile(surface,label,query,name){await surface.getByRole('combobox',{name:label,exact:true}).fill(query);await surface.getByRole('option',{name,exact:typeof name==='string'}).click();}

test('profile fields support searchable cascading locations, canonical genders, optional saved contact cards and explicit avatar saves',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){for(const logged of [false,true]){
  const f=await setup(browser,width,{logged});try{
   f.state.businessCards=[{id:'contact',mode:'link',name:'Synthetic contact card',shareKey:'synthetic-card-01'},{id:'image',mode:'image',name:'Synthetic image card',shareKey:'synthetic-card-02'},{id:'unsaved',mode:'link',name:'Synthetic unsaved card'}];
   await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));
   await f.page.getByRole('button',{name:'Switch Chinese',exact:true}).click();
   await menu(f.page);await choose(f.page,'我的');const surface=logged?serviceFrame(f.page):f.page;
   await surface.locator('[data-account-section="profile"]').click();const form=surface.locator('[data-service-profile-form]');
   await form.getByRole('combobox',{name:'国家',exact:true}).waitFor();
   const birthday=form.getByLabel('生日',{exact:true});assert.equal(await birthday.getAttribute('type'),'text');assert.equal(await birthday.getAttribute('placeholder'),'YYYY-MM-DD');
   assert.equal(await form.getByLabel('头像图片地址',{exact:true}).count(),0);
   await birthday.fill('2023-02-29');assert.equal(await form.getByRole('button',{name:'保存资料',exact:true}).isDisabled(),true);
   await form.getByRole('alert').getByText('请输入有效日期，格式为 YYYY-MM-DD。',{exact:true}).waitFor();await birthday.fill('');
   assert.equal(await form.locator('input[type="date"]').count(),0,'no browser-native date hint can render the garbled placeholder');
   await form.getByRole('button',{name:'选择生日日期',exact:true}).click();
   await form.getByRole('combobox',{name:'生日年份',exact:true}).selectOption('1990');await form.getByRole('combobox',{name:'生日月份',exact:true}).selectOption('3');
   await form.getByRole('button',{name:'1990-03-04',exact:true}).click();assert.equal(await birthday.inputValue(),'1990-03-04');
   await form.getByRole('button',{name:'选择生日日期',exact:true}).click();await f.page.keyboard.press('Escape');assert.equal(await f.page.getByRole('dialog').isVisible(),true);assert.equal(await form.getByRole('region',{name:'生日日期选择器',exact:true}).count(),0);
   await pickProfile(form,'性别','male','男');assert.equal(await form.getByRole('combobox',{name:'性别',exact:true}).inputValue(),'男');
   await pickProfile(form,'国家','西班牙',/^Spain/);await pickProfile(form,'省份','SEVI','Sevilla');await pickProfile(form,'城市','sev','Sevilla');
   await pickProfile(form,'国家','France',/^France/);assert.equal(await form.getByRole('combobox',{name:'省份',exact:true}).inputValue(),'');assert.equal(await form.getByRole('combobox',{name:'城市',exact:true}).inputValue(),'');
   await pickProfile(form,'国家','espana',/^Spain/);await pickProfile(form,'省份','sevi','Sevilla');await pickProfile(form,'城市','dos herman','Dos Hermanas');
   await form.getByRole('combobox',{name:'国家',exact:true}).focus();await f.page.keyboard.press('Escape');assert.equal(await f.page.getByRole('dialog').isVisible(),true,'Escape dismisses a combobox, not the service sheet');
   assert.equal(await form.getByRole('combobox',{name:'联系卡',exact:true}).inputValue(),'');
   await form.getByRole('combobox',{name:'联系卡',exact:true}).click();assert.equal(await form.getByRole('option',{name:'Synthetic image card',exact:true}).count(),0);assert.equal(await form.getByRole('option',{name:'Synthetic unsaved card',exact:true}).count(),0);
   if(logged)await form.getByRole('option',{name:'Synthetic contact card',exact:true}).click();else await form.getByRole('option',{name:'不选择（留空）',exact:true}).click();
   const originalLocal=await f.page.evaluate(()=>localStorage.getItem('faolla:personal-guest-profile:v1'));
   const png=await form.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;const ctx=canvas.getContext('2d'),image=ctx.createImageData(96,96);for(let i=0;i<image.data.length;i+=4){image.data[i]=(i*17)%256;image.data[i+1]=Math.floor(i/96)*19%256;image.data[i+2]=(i*31)%256;image.data[i+3]=255}ctx.putImageData(image,0,0);return canvas.toDataURL('image/png').split(',')[1]});
   await form.getByLabel('上传头像',{exact:true}).setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
   await form.getByText('头像已准备好，保存资料后生效。',{exact:true}).waitFor();
   await form.getByRole('img',{name:'当前头像',exact:true}).evaluate(image=>image.decode());
   await form.getByLabel('上传头像',{exact:true}).evaluate(element=>element.dispatchEvent(new Event('cancel',{bubbles:true})));
   assert.equal(await f.page.getByRole('dialog').isVisible(),true,'canceling an avatar picker keeps the profile open');
   assert.equal(f.state.writes.filter(write=>write.path==='/api/personal-profile').length,0,'changing fields and uploading an image never auto-saves the profile');
   assert.equal(await f.page.evaluate(()=>localStorage.getItem('faolla:personal-guest-profile:v1')),originalLocal);
   const avatar=await form.getByRole('img',{name:'当前头像',exact:true}).getAttribute('src');
   if(logged){assert.equal(avatar,portalOrigin+'/synthetic-upload.png');assert.match(f.state.writes.find(write=>write.path==='/api/assets/upload').body.dataUrl,/^data:image\/jpeg;base64,/);}
   else {assert.match(avatar,/^data:image\/jpeg;base64,/);assert.ok(avatar.length>1200,'exercise the previous URL-length truncation boundary');}
   if(process.env.FAOLLA_SERVICE_QA_DIR){await form.evaluate(element=>element.scrollIntoView({block:'start'}));await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-profile-${logged?'member':'guest'}-${width}-top.png`)});await birthday.scrollIntoViewIfNeeded();await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-profile-${logged?'member':'guest'}-${width}-fields.png`)});}
   await form.getByLabel('上传头像',{exact:true}).setInputFiles({name:'not-an-image.txt',mimeType:'text/plain',buffer:Buffer.from('not an image')});
   await form.getByText('请选择 JPG、PNG 或 WebP 图片。',{exact:true}).waitFor();assert.equal(await form.getByRole('img',{name:'当前头像',exact:true}).getAttribute('src'),avatar);
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-profile-${logged?'member':'guest'}-${width}.png`)});
   await form.getByRole('button',{name:'保存资料',exact:true}).click();await surface.getByText('资料已保存。',{exact:true}).waitFor();
   const saved=logged?f.state.profileDraft:JSON.parse(await f.page.evaluate(()=>localStorage.getItem('faolla:personal-guest-profile:v1')));
   assert.equal(saved.gender,'male');assert.equal(saved.country,'Spain');assert.equal(saved.province,'Sevilla');assert.equal(saved.city,'Dos Hermanas');assert.equal(saved.birthday,'1990-03-04');assert.equal(saved.avatarUrl,avatar);assert.equal(saved.contactCard,logged?'https://faolla.com/card/synthetic-card-01':'');
   assert.deepEqual(f.state.writes.map(write=>write.path),logged?['/api/assets/upload','/api/personal-profile']:[]);
   assert.equal(await form.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   if(!logged){await f.page.reload();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await menu(f.page);await choose(f.page,'我的');await f.page.locator('[data-account-section="profile"]').click();await f.page.getByRole('img',{name:'当前头像',exact:true}).evaluate(image=>image.decode());assert.equal(await f.page.getByRole('img',{name:'当前头像',exact:true}).getAttribute('src'),avatar);}
  }finally{await f.close();}
 }}}finally{await browser.close();}
});

test('an avatar upload failure preserves the current avatar and profile and never retries or saves automatically',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  f.state.uploadFails=true;f.state.profileDraft={avatarUrl:portalOrigin+'/synthetic-avatar.svg',country:'Spain',province:'Sevilla',city:'Sevilla'};
  await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await menu(f.page);await choose(f.page,'我的');const surface=serviceFrame(f.page);await surface.locator('[data-account-section="profile"]').click();const form=surface.locator('[data-service-profile-form]');
  await form.getByRole('img',{name:'当前头像',exact:true}).evaluate(image=>image.decode());
  await form.getByLabel('上传头像',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
  await form.getByText('Synthetic upload rejected',{exact:true}).waitFor();
  assert.equal(await form.getByRole('img',{name:'当前头像',exact:true}).getAttribute('src'),portalOrigin+'/synthetic-avatar.svg');
  assert.equal(await form.getByRole('combobox',{name:'城市',exact:true}).inputValue(),'Sevilla');
  assert.deepEqual(f.state.writes.map(write=>write.path),['/api/assets/upload']);assert.equal(await f.page.getByRole('dialog').isVisible(),true);
 }finally{await f.close();await browser.close();}
});

test('opening profile preserves older saved location and contact-card values; an unrelated explicit save does not choose replacements',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,390);try{
  f.state.profileDraft={country:'Saved custom country',province:'Saved custom province',city:'Saved custom city',contactCard:'https://example.invalid/legacy-contact',gender:'other'};
  await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));await menu(f.page);await choose(f.page,'我的');const surface=serviceFrame(f.page);await surface.locator('[data-account-section="profile"]').click();const form=surface.locator('[data-service-profile-form]');
  await form.getByRole('combobox',{name:'城市',exact:true}).waitFor();await form.getByLabel('姓名 / 昵称',{exact:true}).fill('Updated display name');
  await form.getByRole('button',{name:'保存资料',exact:true}).click();await surface.getByText('资料已保存。',{exact:true}).waitFor();
  assert.equal(f.state.profileDraft.country,'Saved custom country');assert.equal(f.state.profileDraft.province,'Saved custom province');assert.equal(f.state.profileDraft.city,'Saved custom city');assert.equal(f.state.profileDraft.contactCard,'https://example.invalid/legacy-contact');
  assert.equal(f.state.writes.length,1);
 }finally{await f.close();await browser.close();}
});

test('My dashboard gives guests and accounts a responsive identity card and all nine working shortcuts without eager reads or writes',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [320,390,1440]){for(const logged of [false,true]){
  const f=await setup(browser,width,{logged,seedGuest:!logged});try{
   if(logged){f.state.favorite=true;f.state.member='active';f.state.profile.avatarUrl=portalOrigin+'/synthetic-avatar.svg';}
   const savedProfile=structuredClone(f.state.profile);
   await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));
   await f.page.getByRole('button',{name:'Switch Chinese',exact:true}).click();
   await f.page.getByRole('heading',{name:'你的下一场游戏从这里开始。',exact:true}).waitFor();
   await menu(f.page);await choose(f.page,'我的');const surface=logged?serviceFrame(f.page):f.page;
   const account=surface.locator('[data-service-account]');await account.getByRole('heading',{name:logged?'Synthetic visitor':'游客身份',exact:true}).waitFor();
   assert.equal(await account.locator('[data-account-section]').count(),9);
   assert.equal(new Set(await account.locator('[data-account-section] svg').evaluateAll(elements=>elements.map(svg=>getComputedStyle(svg).color))).size,9);
   assert.equal(f.state.requests.filter(r=>r.url.includes('/api/personal-profile')||r.url.includes('/api/personal-coupons')).length,0,'opening My does not eagerly fetch unopened features');
   if(logged){
    await account.locator('img').evaluate(image=>image.decode());
    await account.getByText('已登录',{exact:true}).waitFor();
    assert.match(await account.getByLabel('身份信息').textContent(),/收藏商户\s*1.*有效会员卡\s*1/s);
   }else{
    const login=account.getByRole('link',{name:'用户登录 / 注册',exact:true});await login.waitFor();
    assert.equal(await login.getAttribute('target'),'_top');assert.match(await login.getAttribute('href'),/^\/login\?/);
    await account.getByText('临时资料和记录保存在本设备',{exact:true}).waitFor();
   }
   assert.equal(await account.evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-account-${logged?'member':'guest'}-${width}.png`)});
   for(const id of ['profile','favorites','memberships','coupons','cards','qr','tools','games','more']){
    await account.locator(`[data-account-section="${id}"]`).click();
    if(id==='profile')await account.getByText('姓名 / 昵称',{exact:true}).waitFor();
    if(id==='favorites')await account.getByText(logged?'取消收藏':'尚未收藏商户。',{exact:true}).waitFor();
    if(id==='memberships')await account.getByText(logged?'有效会员':'暂无会员卡。',{exact:true}).waitFor();
    if(id==='coupons')await account.getByText('暂无已领取优惠券。',{exact:true}).waitFor();
    if(id==='cards')await account.getByText(logged?'Synthetic card manager boundary':'请登录后使用名片夹。',{exact:true}).waitFor();
    if(id==='qr')await (logged?account.getByRole('img',{name:'Faolla 二维码',exact:true}):account.getByText('请登录后使用个人二维码。',{exact:true})).waitFor();
    if(id==='tools')await account.getByRole('link',{name:'双扣计分',exact:true}).waitFor();
    if(id==='games')await account.getByRole('link',{name:'坦克大战',exact:true}).waitFor();
    if(id==='more')await account.getByRole('button',{name:'隐私政策',exact:true}).waitFor();
    assert.equal(await account.evaluate(element=>element.scrollWidth<=element.clientWidth),true,'subpage '+id+' fits at '+width);
    await account.getByRole('button',{name:'← 返回我的',exact:true}).click();
   }
   assert.deepEqual(f.state.profile,savedProfile);assert.deepEqual(f.state.writes,[]);
   assert.equal(new URL(f.page.url()).origin,merchantOrigin);
  }finally{await f.close();}
 }}}finally{await browser.close();}
});

test('file-picker cancellation is not a request to dismiss the service dialog',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){for(const logged of [false,true]){
  const f=await setup(browser,width,{logged});try{
   await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));
   await menu(f.page);await choose(f.page,'会话');
   const surface=logged?serviceFrame(f.page):f.page;
   await openThread(surface);await surface.getByLabel('输入消息').fill('Keep this unsent draft');
   const input=surface.locator('input[type="file"]');
   const chooser=f.page.waitForEvent('filechooser');await surface.getByText('图片 / 文件',{exact:true}).click();
   await (await chooser).setFiles([]);
   // File inputs emit their own bubbling cancel event when their OS picker is
   // dismissed. React delegates this event through ancestors, including dialog.
   await input.evaluate(element=>element.dispatchEvent(new Event('cancel',{bubbles:true})));
   assert.equal(await f.page.getByRole('dialog').isVisible(),true,'picker cancel must not close the containing dialog');
   assert.equal(await surface.getByLabel('输入消息').inputValue(),'Keep this unsent draft');
   assert.equal(await surface.locator(`[data-conversation-id="${siteId}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(new URL(f.page.url()).origin,merchantOrigin);
   assert.deepEqual(f.state.writes,[]);
   // Choosing an image still follows the existing local-draft/upload path;
   // cancel must not make the next attachment control unusable.
   await input.setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});
   await surface.locator('textarea').filter({visible:true}).evaluate(element=>new Promise((resolve,reject)=>{const deadline=Date.now()+5000;const timer=setInterval(()=>{if(element.value.includes('图片：')){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error('attachment draft was not updated'))}},10)}));
   assert.match(await surface.getByLabel('输入消息').inputValue(),/^Keep this unsent draft\n图片：/);
   assert.deepEqual(f.state.writes.map(write=>write.path),logged?['/api/assets/upload']:[]);
   await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).focus();
   await f.page.keyboard.press('Escape');await f.page.waitForFunction(()=>!document.querySelector('dialog').open);
  }finally{await f.close();}
 }}}finally{await browser.close();}
});

test('conversation list stays left on desktop and opens separate WhatsApp-style chat on mobile',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width);try{
   f.state.contacts=Array.from({length:18},(_,index)=>({merchantId:String(99991000+index),merchantName:'Synthetic contact '+(index+1),lastMessage:{id:'preview-'+index,text:'Recent conversation '+(index+1),createdAt:'2026-11-13T10:00:00Z'}}));
   f.state.threads=[{threadKey:'synthetic-thread',merchantAId:'50010105',merchantBId:siteId,messages:[{id:'synthetic-inbound',text:'Synthetic incoming message',senderMerchantId:siteId,createdAt:'2026-11-13T10:00:00Z'}]}];
   await f.open();await f.page.getByRole('button',{name:'收藏并加入本店会员'}).waitFor();
   await menu(f.page);await choose(f.page,'会话');const surface=serviceFrame(f.page);
   await surface.locator('[data-conversation-id="99991000"]').waitFor();
   const list=surface.getByRole('complementary',{name:'会话对象列表'}),chat=surface.getByRole('region',{name:'当前会话'});
   assert.equal(await list.isVisible(),true);assert.equal(await surface.getByRole('combobox',{name:'选择会话'}).count(),0);
   if(width<768){assert.equal(await chat.isVisible(),false);assert.equal(f.state.writes.length,0,'unopened mobile chat is not marked read');}
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-conversation-list-${width}.png`)});
   await openThread(surface);await surface.getByLabel('聊天记录').getByText('Synthetic incoming message',{exact:true}).waitFor();
   await f.page.waitForFunction(()=>document.querySelector('dialog').open);
   const chatBox=await chat.boundingBox(),listBox=width>=768?await list.boundingBox():null;
   assert.ok(chatBox.width>250);
   if(width>=768){assert.ok(listBox.x+listBox.width<=chatBox.x+1,'contacts occupy a stable left column');assert.ok(Math.abs(listBox.y-chatBox.y)<1);}
   else {assert.equal(await list.isVisible(),false);assert.ok(chatBox.width<=width);}
   await surface.getByLabel('输入消息').fill('Preserve this conversation draft');
   const sendBox=await surface.getByRole('button',{name:'发送',exact:true}).boundingBox(),frameBox=await f.page.locator('iframe').boundingBox();
   assert.ok(sendBox.y+sendBox.height<=frameBox.y+frameBox.height,'composer stays inside the sheet');
   assert.equal(await surface.locator('main').evaluate(element=>element.scrollWidth<=element.clientWidth),true);
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-conversation-chat-${width}.png`)});
   if(width<768){
    await surface.getByRole('button',{name:'返回会话列表',exact:true}).click();assert.equal(await list.isVisible(),true);assert.equal(await chat.isVisible(),false);
    await openThread(surface);assert.equal(await surface.getByLabel('输入消息').inputValue(),'Preserve this conversation draft');
   }else{
    await openThread(surface,'99991000');await chat.getByRole('heading',{name:'Synthetic contact 1',exact:true}).waitFor();
    assert.equal(await chat.getByText('Synthetic incoming message',{exact:true}).count(),0);
    await openThread(surface);await chat.getByText('Synthetic incoming message',{exact:true}).waitFor();
   }
   assert.deepEqual(f.state.writes.map(write=>write.body.action),['mark_read']);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('short mobile viewports keep the composer and close control reachable without horizontal overflow',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const [width,height] of [[320,640],[390,560]]){
  const f=await setup(browser,width,{logged:false,height});try{
   await f.open();await f.page.waitForResponse(r=>r.url().includes('/api/merchant-service/status'));
   await menu(f.page);await choose(f.page,'会话');await openThread(f.page);
   await f.page.getByLabel('输入消息').fill('Short viewport draft');
   const sheet=await f.page.getByRole('dialog').boundingBox(),send=await f.page.getByRole('button',{name:'发送',exact:true}).boundingBox();
   assert.ok(send.y+send.height<=sheet.y+sheet.height);assert.ok(send.y>=sheet.y);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await f.page.getByRole('button',{name:'返回会话列表',exact:true}).click();await openThread(f.page);
   assert.equal(await f.page.getByLabel('输入消息').inputValue(),'Short viewport draft');
   await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).click();assert.equal(await f.page.getByRole('dialog').isVisible(),false);
   assert.deepEqual(f.state.writes,[]);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('desktop and mobile keep the merchant document and load one isolated personal surface only on selection',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await setup(browser,width);try{
   await f.page.clock.install();await f.open();await f.page.clock.runFor(1500);await f.page.getByRole('button',{name:'收藏并加入本店会员'}).waitFor();
   assert.equal(await f.page.locator('iframe').count(),0);assert.equal(f.state.requests.filter(r=>r.url.includes('/api/personal-')).length,0);
   assert.equal(f.state.requests.filter(r=>r.url.includes('/api/auth/')).length,0);
   assert.equal(f.state.requests.filter(r=>r.url.startsWith(merchantOrigin)&&r.cookie).length,0);
   await f.page.evaluate(()=>{document.querySelector('[data-merchant-heading]').dataset.identity='preserved';window.scrollTo(0,350)});
   await menu(f.page);assert.equal(await f.page.locator('iframe').count(),0);
   const tones=await f.page.locator('[data-service-section]').evaluateAll(elements=>elements.map(element=>getComputedStyle(element).backgroundColor));
   assert.equal(new Set(tones).size,4,'each service has a distinct soft color, not just a different label');
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-menu-${width}.png`)});
   const bounds=await f.page.getByRole('dialog').boundingBox();assert.ok(bounds.y>=120,'visible merchant backdrop stays above the sheet');
   await choose(f.page,'订单');await serviceFrame(f.page).getByText('Synthetic account product × 2',{exact:true}).waitFor();
   if(process.env.FAOLLA_SERVICE_QA_DIR)await f.page.screenshot({path:path.join(process.env.FAOLLA_SERVICE_QA_DIR,`service-orders-${width}.png`)});
   assert.equal(await f.page.locator('iframe').count(),1);
   assert.equal(await f.page.locator('iframe').evaluate(frame=>frame.contentDocument===null),true,'merchant scripts cannot read personal DOM');
   const src=await f.page.locator('iframe').getAttribute('src');assert.doesNotMatch(src,/\/me\?|access_token|refresh_token/);
   await f.page.getByRole('button',{name:'返回服务中心',exact:true}).click();await choose(f.page,'会话');await openThread(serviceFrame(f.page));await serviceFrame(f.page).getByLabel('输入消息').waitFor();
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
  const messages=await f.page.evaluate(()=>window.__messages);for(const data of messages){assert.deepEqual(Object.keys(data).filter(key=>!['type','nonce','siteId','event','favorited','locale'].includes(key)),[]);}
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
  await menu(f.page);await choose(f.page,'会话');await openThread(serviceFrame(f.page));await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic incoming message',{exact:true}).waitFor();
  await readReceipt;
  await serviceFrame(f.page).getByLabel('输入消息').fill('Synthetic outgoing message');
  await serviceFrame(f.page).getByRole('button',{name:'发送',exact:true}).click();
  await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic outgoing message',{exact:true}).waitFor();
  await f.page.getByRole('button',{name:'关闭服务中心',exact:true}).click();await menu(f.page);await choose(f.page,'会话');
  await serviceFrame(f.page).getByLabel('聊天记录').getByText('Synthetic outgoing message',{exact:true}).waitFor();
  assert.deepEqual(f.state.writes.map(row=>row.body.action),['mark_read','send']);
 }finally{await f.close();await browser.close();}
});
