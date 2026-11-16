// Real public controls and production CSS. All identity/network IO is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

const origin='https://utility-controls.invalid';
const localFlags=new Map(await Promise.all((await readdir('public/flags')).filter(file=>/^[a-z]{2}\.svg$/.test(file)).map(async file=>['/flags/'+file,await readFile('public/flags/'+file)])));
const fixtures={
 'next/navigation':`export const usePathname=()=>'/';`,
 'next/link':`import React from'react';export default function Link({prefetch,...props}){return <a {...props}/>}`,
 '@/lib/authSessionRecovery':`export const resolveFrontendAuthPayload=async()=>({authenticated:false});`,
 '@/components/service-center/ServiceCenterSheet':`export default function Sheet(){return null}`,
};
const script=(await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from'react';import{createRoot}from'react-dom/client';
import{I18nProvider,useI18n}from'./src/components/I18nProvider';
import Language from'./src/components/GlobalLanguageSwitcher';
import Actions from'./src/components/PublicWebsiteActions';
import Auth from'./src/components/FrontendAuthEntry';
function App(){const{setLocale}=useI18n();return <><div data-utility-row style={{position:'fixed',right:innerWidth<768?64:80,top:innerWidth<768?12:20,display:'flex',alignItems:'center',gap:8}}><Auth/><Actions siteId="99990001" serviceOrigin="${origin}"/></div><Language/><button style={{marginTop:100}} onClick={()=>setLocale('es-ES')}>Spanish</button><button onClick={()=>setLocale('zh-CN')}>Chinese</button></>};
createRoot(document.getElementById('root')).render(<I18nProvider initialLocale="zh-CN"><App/></I18nProvider>);`},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',logLevel:'silent',define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},plugins:[{name:'identity-boundary',setup(builder){
 builder.onResolve({filter:/^(next\/|@\/)/},args=>Object.hasOwn(fixtures,args.path)?{path:args.path,namespace:'fixture'}:undefined);
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:fixtures[args.path],loader:'tsx',resolveDir:process.cwd()}));
}}]})).outputFiles[0].text;
const globals=(await readFile('src/app/globals.css','utf8')).replace(/^@import[^\n]+/gm,'');
const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/GlobalLanguageSwitcher.tsx";\n@source "./src/components/FrontendAuthEntry.tsx";\n@source "./src/components/PublicWebsiteActions.tsx";\n'+globals,{from:path.resolve('utility-controls-acceptance.css')})).css;

test('public login, favorite and service controls match the language flag on desktop and mobile',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{for(const width of [1440,390,320])for(const authenticated of [false,true]){
  const context=await browser.newContext({viewport:{width,height:800}}),page=await context.newPage(),unexpected=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){unexpected.push(request.method()+' '+url.pathname);return route.abort();}
   if(url.origin===origin&&request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><div id="root"></div><script>'+script.replaceAll('</script>','<\\/script>')+'</script>'});
   if(url.origin===origin&&url.pathname==='/api/merchant-service/status')return route.fulfill({json:{ok:true,authenticated,favorited:false}});
   if(url.origin===origin&&request.resourceType()==='image'&&localFlags.has(url.pathname))return route.fulfill({contentType:'image/svg+xml',body:localFlags.get(url.pathname)});
   unexpected.push(url.href);return route.abort();
  });
  try{
   const ready=page.waitForResponse(response=>response.url().includes('/api/merchant-service/status'));
   await page.goto(origin);await ready;await page.getByRole('link',{name:'登录',exact:true}).waitFor();
   await page.waitForFunction(expected=>document.querySelectorAll('[data-public-website-actions] > button').length===expected,authenticated?2:1);
   for(const language of ['Spanish','Chinese']){
    await page.getByRole('button',{name:language,exact:true}).click();
    const boxes=await page.locator('.faolla-utility-control').evaluateAll(elements=>elements.map(element=>{const r=element.getBoundingClientRect();return {height:r.height,top:r.top,bottom:r.bottom,right:r.right,left:r.left,text:element.textContent?.trim(),visible:getComputedStyle(element).display!=='none'};}));
    assert.equal(boxes.length,authenticated?4:3);
    for(const box of boxes){assert.equal(box.height,24);assert.equal(box.top,width<768?12:20);assert.ok(box.left>=0&&box.right<=width);assert.equal(box.visible,true);}
    const flag=page.locator('.faolla-mobile-language-button');
    assert.equal((await flag.locator('..').boundingBox()).height,24,'the pointer-active wrapper must not extend past the visible flag and intercept modal controls');
    assert.equal(await flag.evaluate(button=>{const r=button.getBoundingClientRect();return button.parentElement.contains(document.elementFromPoint(r.left+r.width/2,r.bottom+1));}),false);
    await flag.click();assert.equal(await flag.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await flag.getAttribute('aria-expanded'),'false');
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const contact=page.locator('[data-public-chat-launcher]');assert.equal((await contact.textContent()).trim(),'');assert.equal((await contact.boundingBox()).height,52);
   assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  }finally{await context.unrouteAll({behavior:'wait'});await context.close();}
 }}finally{await browser.close();}
});
