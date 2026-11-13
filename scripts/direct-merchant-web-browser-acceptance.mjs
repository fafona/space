// Actual public page, directory, actions and personal center. Synthetic IO only:
// no production account, business writes, real credentials or external network.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const origin='https://direct-web-audit.invalid';
const merchantOrigin='https://synthetic.direct-web-audit.invalid';
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>';
const merchant={id:'99990001',name:'Synthetic merchant',industry:'娱乐',country:'Spain',province:'Sevilla',city:'Sevilla',status:'online',serviceExpiresAt:'2099-01-01T00:00:00Z',domainPrefix:'synthetic',ownerEmail:'synthetic@example.invalid',registeredAt:'2026-01-01T00:00:00Z'};
const blocks=[{id:'synthetic-content',type:'common',props:{title:'Published merchant content'}}];
const fixturePlugin={name:'synthetic-io',setup(b){
  const fixtures={
    'next/link':`import React from 'react';export default function Link({prefetch,...props}){return React.createElement('a',props)}`,
    'next/dynamic':`export default function dynamic(){return ()=>null}`,
    'next/navigation':`export const useParams=()=>({});`,
    '@/components/I18nProvider':`export const useI18n=()=>({locale:new URLSearchParams(location.search).get('uiLocale')||'zh-CN',setLocale:()=>{},t:k=>k});`,
    '@/data/platformControlStore':`export {MERCHANT_INDUSTRY_OPTIONS,createDefaultMerchantPermissionConfig}from'./src/data/platformControlStore';export const loadPlatformState=()=>({sites:[${JSON.stringify(merchant)}]});export const subscribePlatformState=()=>()=>{};`,
    '@/data/blockStore':`export const loadPublishedBlocksFromStorage=()=>[];export const savePublishedBlocksToStorage=()=>true;`,
    '@/lib/supabase':`export const isSupabaseEnabled=false;export const supabase=null;export const getResolvedSupabaseUrl=()=>'';export const resolvedSupabaseAnonKey='';`,
    '@/lib/authSessionRecovery':`window.__authCalls=window.__authCalls||0;
      export const resolveFrontendAuthPayload=async()=>{window.__authCalls++;if(location.pathname.startsWith('/site/'))return new Promise(()=>{});return null;};
      export const readMerchantSessionPayload=async()=>null;
      export const recoverBrowserSupabaseSessionWithRefresh=async()=>null;
      export const syncMerchantSessionCookies=async()=>null;
      export const clearStoredBrowserSupabaseSessionTokens=()=>{};
      export const startMerchantSessionKeepAlive=()=>()=>{};`,
    '@/lib/europeLocationOptionsLoader':`export const loadEuropeLocationOptionsApi=async()=>null;`,
    '@/components/blocks/BlockRenderer':`import React from 'react';export default function BlockRenderer({blocks}){return <article data-published-content>{blocks.map(b=><h1 key={b.id}>{b.props.title}</h1>)}</article>}`,
    '@/components/PublicTrafficProvider':`export default function TrafficIO({children}){return children};export const usePublicTraffic=()=>({});`,
  };
  b.onResolve({filter:/^(next\/|@\/)/},args=>Object.hasOwn(fixtures,args.path)?{path:args.path,namespace:'fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],loader:'tsx',resolveDir:process.cwd()}));
}};
const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{SitePageClient}from'./src/app/site/[siteId]/SitePageClient';
 import MePage from'./src/app/me/page';import MerchantListBlock from'./src/components/blocks/MerchantListBlock';
 import{ensurePersonalGuestIdentity,savePersonalGuestProfile,upsertPersonalGuestBooking,upsertPersonalGuestOrder}from'./src/lib/personalGuestSession';
 if(window.__seedGuestHistory){
  ensurePersonalGuestIdentity();savePersonalGuestProfile({displayName:'Synthetic visitor'});
  const dates={createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-01T10:00:00Z'};
  upsertPersonalGuestBooking({...dates,id:'B99990001202611010001',siteId:'99990001',siteName:'Synthetic venue',store:'Synthetic branch',item:'Synthetic activity',appointmentAt:'2030-02-01T10:00:00Z',title:'Mx',customerName:'Synthetic visitor',email:'guest@example.invalid',phone:'000',note:'',status:'active'});
  upsertPersonalGuestOrder({...dates,id:'O99990001202611010001',siteId:'99990001',siteName:'Synthetic venue',status:'pending',customer:{name:'Synthetic visitor',phone:'000',email:'guest@example.invalid',note:''},items:[{productId:'p1',code:'TEST-1',name:'Synthetic product',description:'',imageUrl:'',tag:'',quantity:1,unitPrice:9,unitPriceText:'€9.00'}],pricePrefix:'€'});
 }
 const p=location.pathname;
 createRoot(document.getElementById('root')).render(p==='/me'?<MePage/>:p==='/directory'?<MerchantListBlock publishedMerchantSnapshot={[${JSON.stringify(merchant)}]}/>:<SitePageClient forcedSiteId="99990001" serviceOrigin="${origin}" initialPublishedBlocks={${JSON.stringify(blocks)}} initialIsMobileViewport={innerWidth<768}/>);
 `},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',plugins:[fixturePlugin],define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'})).outputFiles[0].text;
const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/app/me/page.tsx";\n@source "./src/app/site/[siteId]/SitePageClient.tsx";\n@source "./src/components/PublicWebsiteActions.tsx";\n@source "./src/components/blocks/MerchantListBlock.tsx";', {from:path.resolve('direct-web-acceptance.css')})).css;

async function setup(browser,width,{touch=false}={}){
 const context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch});
 const page=await context.newPage(),errors=[],writes=[],frameLoads=[],unexpected=[];
 page.setDefaultTimeout(10000);
 page.on('pageerror',e=>{errors.push(e.message);console.error('Synthetic browser error:',e.message);});
 await context.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.origin!==origin&&!(url.origin===merchantOrigin&&r.isNavigationRequest())){unexpected.push(r.url());return route.abort();}
  if(!['GET','HEAD'].includes(r.method())){writes.push({url:r.url(),method:r.method()});return route.abort();}
  if(r.isNavigationRequest()){
   if(r.frame().parentFrame()&&url.pathname!=='/directory'){frameLoads.push(r.url());return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><h1>Public frame fixture</h1>'});}
   return route.fulfill({contentType:'text/html',body:html});
  }
  if(url.pathname.startsWith('/api/'))return route.fulfill({json:{ok:true,blocks,sites:[merchant],messages:[],threads:[],contacts:[],bookings:[],orders:[],memberships:[],coupons:[]}});
  if(url.pathname==='/downloads/faolla-android-version.json')return route.fulfill({json:{version:'1.0',build:33}});
  unexpected.push(r.url());return route.abort();
 });
 return {context,page,errors,writes,frameLoads,unexpected,
  async open(href){await page.goto(origin+href);await page.addStyleTag({content:css});await page.addScriptTag({content:script});},
  async close(){await context.close();if(errors.length||writes.length||unexpected.length)console.error({errors,writes,unexpected});assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(unexpected,[]);}};
}

test('standalone merchant paints without a login bootstrap, join entry, redirect or iframe',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,390,1440]){
  const f=await setup(browser,width,{touch:width<768});
  try{
   await f.open('/site/99990001?page=page-2&uiLocale=es-ES');
   await f.page.getByRole('heading',{name:'Published merchant content'}).waitFor();
   assert.equal(await f.page.locator('iframe').count(),0);
   assert.equal(new URL(f.page.url()).pathname,'/site/99990001');
   assert.equal(await f.page.getByRole('button',{name:'服务中心',exact:true}).count(),1);
   assert.equal(await f.page.getByRole('button',{name:'加入',exact:true}).count(),0);
   assert.equal(await f.page.getByRole('link',{name:'在个人中心收藏本店',exact:true}).count(),0);
   assert.equal(await f.page.evaluate(()=>window.__authCalls),0,'standalone actions never launch cookie recovery on the merchant origin');
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('personal center loads no merchant frame until requested, then only one responsive frame',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const {width,touch} of [{width:390,touch:true},{width:900,touch:true},{width:1440,touch:false}]){
  const f=await setup(browser,width,{touch});
  try{
   await f.open('/me?personalSection=consumption&returnTo='+encodeURIComponent(origin+'/site/99990001?uiLocale=es-ES'));
   const back=f.page.locator('[data-return-to-website]:visible');await back.waitFor();
   assert.equal(await back.getAttribute('href'),origin+'/site/99990001?uiLocale=es-ES');
   assert.equal(await f.page.locator('iframe').count(),0);assert.equal(f.frameLoads.length,0);
   await f.page.getByRole('button',{name:'Faolla',exact:true}).filter({visible:true}).click();
   await f.page.locator('iframe[title="Faolla"]').waitFor();
   await f.page.frameLocator('iframe').getByRole('heading',{name:'Public frame fixture'}).waitFor();
   await f.page.locator('iframe').evaluate(frame=>frame.dataset.acceptanceIdentity='first');
   assert.equal(await f.page.locator('iframe').count(),1);assert.equal(f.frameLoads.length,1);
   await f.page.getByRole('button',{name:'消费',exact:true}).filter({visible:true}).click();
   assert.equal(await f.page.locator('iframe').count(),1);
   await f.page.getByRole('button',{name:'Faolla',exact:true}).filter({visible:true}).click();
   assert.equal(await f.page.locator('iframe').getAttribute('data-acceptance-identity'),'first');
   assert.equal(f.frameLoads.length,1);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('an explicit old platform link still opens one merchant frame on desktop and mobile',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1440]){
  const f=await setup(browser,width,{touch:width<768});
  try{
   await f.open('/me?section=faolla&uiLocale=es-ES&faollaUrl='+encodeURIComponent(origin+'/site/99990001?uiLocale=es-ES'));
   await f.page.locator('iframe[title="Faolla"]').waitFor();
   await f.page.frameLocator('iframe').getByRole('heading',{name:'Public frame fixture'}).waitFor();
   assert.equal(await f.page.locator('iframe').count(),1);assert.equal(f.frameLoads.length,1);
   const url=new URL(await f.page.locator('iframe').getAttribute('src'),origin);
   assert.equal(url.pathname,'/site/99990001');assert.equal(url.searchParams.get('appShell'),'faolla');
   assert.equal(url.searchParams.get('uiLocale'),'es-ES');
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('direct personal feature links retain local guest orders and bookings without embedding the website',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [390,1440]){
  const f=await setup(browser,width,{touch:width<768});
  try{
   await f.page.addInitScript(()=>{window.__seedGuestHistory=true;});
   await f.open('/me?personalSection=consumption&returnTo='+encodeURIComponent(origin+'/site/99990001'));
   await f.page.getByText(/Synthetic activity/).filter({visible:true}).first().waitFor();
   await f.page.getByText(/Synthetic product/).filter({visible:true}).first().waitFor();
   assert.equal(await f.page.locator('iframe').count(),0);
   const before=await f.page.evaluate(()=>({identity:localStorage.getItem('faolla:personal-guest-identity:v1'),bookings:localStorage.getItem('faolla:personal-guest-bookings:v1'),orders:localStorage.getItem('faolla:personal-guest-orders:v1')}));
   await f.page.locator('[data-return-to-website]:visible').click();
   assert.equal(new URL(f.page.url()).pathname,'/site/99990001');
   assert.deepEqual(await f.page.evaluate(()=>({identity:localStorage.getItem('faolla:personal-guest-identity:v1'),bookings:localStorage.getItem('faolla:personal-guest-bookings:v1'),orders:localStorage.getItem('faolla:personal-guest-orders:v1')})),before);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('embedded merchant directory links escape to original merchant origins, never another shell',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});const f=await setup(browser,1440);
 try{
  await f.page.goto(origin+'/host');
  const loaded=f.page.waitForEvent('framenavigated',{predicate:frame=>frame.url().includes('/directory')});
  await f.page.evaluate(()=>{const frame=document.createElement('iframe');frame.src='/directory?appShell=faolla';frame.style='width:100%;height:800px';document.body.append(frame);});
  const frame=await loaded;
  await frame.addStyleTag({content:css});await frame.addScriptTag({content:script});
  const card=frame.getByRole('link').filter({hasText:'Synthetic merchant'});await card.waitFor();
  assert.equal(await card.getAttribute('href'),merchantOrigin+'?uiLocale=zh-CN');
  assert.equal(await card.getAttribute('target'),'_top');
  await card.click();assert.equal(new URL(f.page.url()).origin,merchantOrigin);
  assert.equal(f.page.frames().length,1);
  assert.equal(new URL(f.page.url()).searchParams.get('appShell'),null);
 }finally{await f.close();await browser.close();}
});
