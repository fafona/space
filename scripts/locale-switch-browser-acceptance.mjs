// Actual React locale/DOM translator, bounded synthetic translation requests.
// No live account, production data or external translation service is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import fs from 'node:fs';
const source=['欢迎来体验数字运动','和朋友一起开启快乐挑战','预约场地前请查看到访说明'];
const spanish=['Ven a descubrir el deporte digital','Comparte un nuevo reto con tus amigos','Consulta las instrucciones antes de reservar'];
const chinese=['欢迎来体验数字运动','和朋友一起开启快乐挑战','预约场地前请查看到访说明'];
const entry=`import React from 'react';import{createRoot}from'react-dom/client';
import{I18nProvider,useI18n}from'./src/components/I18nProvider';import Translator from'./src/components/ClientDomTranslator';
import Switcher from'./src/components/GlobalLanguageSwitcher';
import LoadingProgressScreen from'./src/components/LoadingProgressScreen';
import{isDomTranslationCached,reverseTranslateDomText}from'./src/lib/domTranslations';window.__translationCached=isDomTranslationCached;window.__qaReverseText=reverseTranslateDomText;
const query=new URLSearchParams(location.search);
const original=query.get('source')==='es'?${JSON.stringify(spanish)}:${JSON.stringify(source)};
if(query.has('many'))original.push(...Array.from({length:15},(_,i)=>'更多数字活动介绍 '+i));
function Website(){const{setLocale,locale}=useI18n();return <main data-public-merchant-site={query.has('backend')?undefined:'99990001'} style={{minHeight:2000}}>
<div data-no-translate="1"><button onClick={()=>setLocale('es-ES')}>Spanish</button><button onClick={()=>setLocale('zh-CN')}>Chinese</button><button onClick={()=>setLocale('en-GB')}>English</button></div>
{original.map((text,index)=><p key={index} data-line={index} title={index===0?original[0]:undefined}>{text}</p>)}
<input data-customer-draft aria-label="Customer draft" placeholder={original[1]} defaultValue="PRIVATE CUSTOMER DRAFT"/>
<input data-input-label type="button" value={original[2]} readOnly/><div data-no-translate="1">PRIVATE MESSAGE CONTENT</div>
{query.has('brand')?<section><h1 data-brand-title title="Faolla">Faolla</h1><p data-brand-cases>FAOLLA faolla FaOlLa</p><p data-brand-mixed title={original[0]+' Faolla'}>{original[0]+' Faolla'}</p><input type="button" data-brand-input value="FAOLLA" readOnly/><LoadingProgressScreen locale={locale}/></section>:null}
</main>};createRoot(document.getElementById('root')).render(<I18nProvider><Website/><Switcher/><Translator/></I18nProvider>);`;
const navigation=`export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`;
const script=(await build({stdin:{contents:entry,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',
 plugins:[{name:'navigation-fixture',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:navigation,loader:'js'}));}}],
 define:{'process.env':'{}','process.env.NODE_ENV':'"production"'},logLevel:'silent'})).outputFiles[0].text;
const pendingCss=fs.readFileSync('src/app/globals.css','utf8').match(/html\[data-i18n-pending="1"\] body\s*\{[^}]+\}/)?.[0];
assert.ok(pendingCss,'use the actual pending first-paint rule');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function fixture(browser,width,{originalSpanish=false,holdSlow=false,holdSpanish=false,many=false,brand=false,failChinese=false,backend=false}={}){
 const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:'block'}),page=await context.newPage();
 if(brand)await context.addInitScript(()=>{for(const locale of ['zh-CN','es-ES'])localStorage.setItem('merchant-space:dom-i18n-cache:v4:'+locale,JSON.stringify({Faolla:'积极的',FAOLLA:'积极的','欢迎来体验数字运动 Faolla':'错误的缓存积极的'}));});
 const slow=deferred(),fast=deferred(),spanishStarted=deferred(),spanishAborted=deferred(),requests=[],errors=[],aborted=[];let rejectChinese=failChinese;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',request=>{const url=new URL(request.url());if(url.hostname==='translate.googleapis.com'&&url.searchParams.get('tl')==='es'){aborted.push(request.url());if(aborted.length===6)spanishAborted.resolve();}});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='synthetic.faolla.com'&&/^\/flags\/[a-z]{2}\.svg$/.test(url.pathname))return route.fulfill({contentType:'image/svg+xml',body:fs.readFileSync('public'+url.pathname)});
  if(url.hostname==='translate.googleapis.com'){
   const text=url.searchParams.get('q')||'',locale=url.searchParams.get('tl');requests.push({text,locale});
   if(requests.filter(r=>r.locale==='es').length===6)spanishStarted.resolve();
   assert.doesNotMatch(text,/PRIVATE/,'drafts and private messages must not enter translation');
   if(brand)assert.doesNotMatch(text,/faolla/i,'the brand is never sent to the external translator');
   if(rejectChinese&&locale==='zh-CN')return route.fulfill({status:503,body:'unavailable'});
   const index=(originalSpanish?spanish:source).indexOf(text);
   if((index===2&&holdSlow)||(holdSpanish&&locale==='es'))await slow.promise;
   const translated=locale==='zh-CN'?(chinese[index]||text):locale==='es'?(spanish[index]||text):'English '+index;
   try{await route.fulfill({json:[[[translated,text]]]});}catch(error){if(!/closed|handled|cancel|abort/i.test(String(error)))throw error;}
   if(index===0)fast.resolve();return;
  }
  if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><html'+(backend?' data-i18n-pending="1"':'')+'><meta charset="utf-8"><style>'+pendingCss+'</style><div id="root"></div><script>'+script.replaceAll('</script>','<\\/script>')+'</script></html>'});
  throw Error('unexpected synthetic request '+url.hostname);
 });
 await page.goto('https://synthetic.faolla.com/?uiLocale='+(originalSpanish?'es-ES&source=es':backend?'es-ES&backend=1':'zh-CN')+(many?'&many=1':'')+(brand?'&brand=1':''));
 await page.locator('[data-line="0"]').waitFor({state:backend?'attached':'visible'});
 return{context,page,requests,slow,fast,spanishStarted,spanishAborted,errors,allowChinese(){rejectChinese=false;},async close(){slow.resolve();await context.close();assert.deepEqual(errors,[]);}};
}

test('backend first paint never waits for external translation before allowing interaction',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
 const f=await fixture(browser,width,{backend:true,many:true,holdSpanish:true});try{
  await f.spanishStarted.promise;
  assert.notEqual(await f.page.locator('body').evaluate(node=>getComputedStyle(node).visibility),'hidden','backend body is hidden while unrelated external translation is pending');
  await f.page.locator('[data-customer-draft]').fill('PRIVATE INTERACTIVE BACKEND');
  assert.equal(await f.page.locator('[data-customer-draft]').inputValue(),'PRIVATE INTERACTIVE BACKEND');
 }finally{await f.close();}
 }}finally{await browser.close();}
});

test('local flags, incomplete translation feedback and explicit retry stay synchronized without losing customer drafts',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await fixture(browser,width,{originalSpanish:true,failChinese:true});try{
   await f.page.getByRole('button',{name:'Chinese',exact:true}).click();
   await f.page.locator('[data-translation-feedback="incomplete"]').waitFor();
   assert.match(await f.page.locator('.faolla-mobile-language-button img').getAttribute('src'),/^\/flags\/cn\.svg$/);
   await f.page.waitForFunction(()=>{const image=document.querySelector('.faolla-mobile-language-button img');return image.complete&&image.naturalWidth>0;});
   assert.equal(await f.page.locator('[data-line="0"]').textContent(),spanish[0]);
   assert.equal(await f.page.getByLabel('Customer draft').inputValue(),'PRIVATE CUSTOMER DRAFT');
   f.allowChinese();await f.page.getByRole('button',{name:'重试翻译',exact:true}).click();
   await f.page.waitForFunction(text=>document.querySelector('[data-line="0"]').textContent===text,chinese[0]);
   await f.page.waitForFunction(()=>!document.querySelector('[data-translation-feedback]'));
   assert.equal(await f.page.getByLabel('Customer draft').inputValue(),'PRIVATE CUSTOMER DRAFT');
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('slow translation reports pending without blocking interaction; changing language cancels the abandoned status',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390,{many:true,holdSpanish:true});try{
  await f.page.getByRole('button',{name:'Spanish',exact:true}).click();await f.spanishStarted.promise;
  await f.page.locator('[data-translation-feedback="pending"]').waitFor();
  assert.match(await f.page.locator('.faolla-mobile-language-button img').getAttribute('src'),/^\/flags\/es\.svg$/);
  await f.page.locator('[data-customer-draft]').fill('PRIVATE EDITED DRAFT');
  await f.page.getByRole('button',{name:'English',exact:true}).click();
  await f.page.waitForFunction(()=>!document.querySelector('[data-translation-feedback]'));
  assert.match(await f.page.locator('.faolla-mobile-language-button img').getAttribute('src'),/^\/flags\/gb\.svg$/);
  assert.equal(await f.page.locator('[data-customer-draft]').inputValue(),'PRIVATE EDITED DRAFT');
 }finally{await f.close();await browser.close();}
});

test('Faolla survives cold, poisoned and warm caches in loading screens, mixed sentences, attributes and dynamic content',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await fixture(browser,width,{brand:true});try{
   assert.equal(await f.page.locator('[data-brand-title]').textContent(),'Faolla');
   assert.equal(await f.page.locator('.faolla-loading-progress-card [data-no-translate="1"]').textContent(),'Faolla');
   await f.page.getByRole('button',{name:'Spanish',exact:true}).click();
   await f.page.waitForFunction(value=>document.querySelector('[data-brand-mixed]').textContent===value,spanish[0]+' Faolla');
   assert.equal(await f.page.locator('[data-brand-mixed]').getAttribute('title'),spanish[0]+' Faolla');
   assert.equal(await f.page.locator('[data-brand-cases]').textContent(),'FAOLLA faolla FaOlLa');
   assert.equal(await f.page.locator('[data-brand-input]').inputValue(),'FAOLLA');
   await f.page.evaluate(()=>{const node=document.createElement('span');node.dataset.brandDynamic='1';node.textContent='Faolla';document.body.append(node)});
   await f.page.getByRole('button',{name:'English',exact:true}).click();await f.page.waitForFunction(()=>document.querySelector('[data-brand-mixed]').textContent==='English 0 Faolla');
   await f.page.getByRole('button',{name:'Chinese',exact:true}).click();await f.page.waitForFunction(value=>document.querySelector('[data-brand-mixed]').textContent===value,source[0]+' Faolla');
   assert.equal(await f.page.locator('[data-brand-dynamic]').textContent(),'Faolla');
   await f.page.reload();await f.page.locator('[data-brand-title]').waitFor();assert.equal(await f.page.locator('[data-brand-title]').textContent(),'Faolla');
   assert.equal(await f.page.getByText('积极的',{exact:true}).count(),0);assert.ok(f.requests.every(request=>!/faolla/i.test(request.text)));
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('desktop and mobile paint completed Spanish translations before the slowest sentence settles',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [390,1440]){
  const f=await fixture(browser,width,{holdSlow:true});try{
   await f.page.getByRole('button',{name:'Spanish',exact:true}).click();await f.fast.promise;
   await f.page.waitForFunction(text=>document.querySelector('[data-line="0"]').textContent===text,spanish[0],{timeout:1500});
   assert.equal(await f.page.locator('[data-line="0"]').getAttribute('title'),spanish[0]);
   assert.equal(await f.page.locator('[data-line="2"]').textContent(),source[2]);
   assert.equal(await f.page.getByLabel('Customer draft').inputValue(),'PRIVATE CUSTOMER DRAFT');
   f.slow.resolve();await f.page.waitForFunction(text=>document.querySelector('[data-line="2"]').textContent===text,spanish[2]);
   assert.equal(await f.page.locator('[data-input-label]').inputValue(),spanish[2]);
  }finally{await f.close();}
 }}finally{await browser.close();}
});

test('cached identity translations restore the original Spanish immediately after a Chinese round trip',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390,{originalSpanish:true});try{
  await f.page.waitForFunction(texts=>texts.every(text=>window.__translationCached(text,'es-ES')),spanish);
  await f.page.getByRole('button',{name:'Chinese',exact:true}).click();
  await f.page.waitForFunction(texts=>texts.every((text,index)=>document.querySelector('[data-line="'+index+'"]').textContent===text)&&document.querySelector('[data-input-label]').value===texts[2],chinese);
  const before=f.requests.length;await f.page.getByRole('button',{name:'Spanish',exact:true}).click();
  await f.page.waitForFunction(text=>document.querySelector('[data-line="0"]').textContent===text,spanish[0],{timeout:1500});
  assert.equal(await f.page.locator('[data-line="0"]').getAttribute('title'),spanish[0]);
  assert.equal(await f.page.locator('[data-customer-draft]').getAttribute('placeholder'),spanish[1]);
  assert.equal(await f.page.locator('[data-input-label]').inputValue(),spanish[2]);
  assert.equal(f.requests.length,before,'warm Spanish must not repeat external translation');
 }finally{await f.close();await browser.close();}
});

test('rapid Spanish to English switching cancels old requests and never starts the abandoned queue',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390,{many:true,holdSpanish:true});try{
  await f.page.getByRole('button',{name:'Spanish',exact:true}).click();await f.spanishStarted.promise;
  await f.page.getByRole('button',{name:'English',exact:true}).click();await f.spanishAborted.promise;
  await f.page.waitForFunction(()=>[...document.querySelectorAll('[data-line]')].every(node=>node.textContent.startsWith('English')));
  f.slow.resolve();await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(f.requests.filter(r=>r.locale==='es').length,6,'abandoned Spanish must not drain the remaining queue');
  assert.equal(await f.page.locator('[data-line="0"]').textContent(),'English 0');
  assert.equal(await f.page.locator('[data-customer-draft]').inputValue(),'PRIVATE CUSTOMER DRAFT');
 }finally{await f.close();await browser.close();}
});

test('completed Spanish survives a page reload without requesting the same phrases again',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,1440);try{
  await f.page.getByRole('button',{name:'Spanish',exact:true}).click();await f.page.waitForFunction(text=>document.querySelector('[data-line="2"]').textContent===text,spanish[2]);
  await f.page.waitForFunction(texts=>Object.entries(localStorage).some(([key,value])=>key.includes('dom-i18n-cache')&&texts.every(text=>Object.hasOwn(JSON.parse(value),text))),[...source,'Customer draft']);
  const before=f.requests.length;await f.page.reload();await f.page.getByText(spanish[0],{exact:true}).waitFor();
  assert.equal(f.requests.length,before,'warm persisted phrases must be painted locally');
 }finally{await f.close();await browser.close();}
});

test('slow-mobile reverse translation lookups stay bounded across repeated unknown DOM phrases',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,390);try{
  const session=await f.context.newCDPSession(f.page);await session.send('Emulation.setCPUThrottlingRate',{rate:4});
  const result=await f.page.evaluate(()=>{
   window.__qaReverseText('unknown authored public phrase','es-ES');
   const started=performance.now();let mismatches=0;
   for(let i=0;i<8000;i++){
    if(window.__qaReverseText('Unknown authored public phrase '+i,'es-ES')!==null)mismatches++;
    if(window.__qaReverseText('Sr.','es-ES')!=='先生')mismatches++;
   }
   return {duration:performance.now()-started,mismatches};
  });
  assert.equal(result.mismatches,0);
  assert.ok(result.duration<1000,`reverse lookup monopolized the mobile main thread for ${Math.round(result.duration)} ms`);
 }finally{await f.close();await browser.close();}
});
