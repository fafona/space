// Actual PWA components in a disposable browser. Synthetic worker lifecycle,
// no production worker, account or business data is touched.
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const origin='https://pwa-startup.invalid';
const script=(await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import Bootstrap from'./src/components/PwaBootstrap';
 import Updater from'./src/components/PwaServiceWorkerUpdater';
 const root=createRoot(document.getElementById('root'));window.__unmount=()=>root.unmount();
 root.render(new URLSearchParams(location.search).has('lite')?<Updater/>:<Bootstrap/>);
 `},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'pwa-fixtures',setup(b){
 b.onResolve({filter:/^(next\/link|next\/navigation|@\/components\/I18nProvider)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:process.cwd(),contents:a.path==='next/link'?`import React from'react';export default function Link(p){return <a {...p}/>}`:a.path==='next/navigation'?`export const usePathname=()=>location.pathname;`:`export const useI18n=()=>({locale:'en-US'});`}));
 }}]})).outputFiles[0].text;

async function setup(browser,{controlled=false,lite=false}={}){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],unexpected=[];
 await context.addInitScript(({controlled})=>{
  const worker=new EventTarget();worker.messages=[];worker.postMessage=m=>worker.messages.push(m);worker.state='installing';
  const registration=new EventTarget();registration.installing=worker;registration.waiting=null;registration.active=controlled?worker:null;registration.update=async()=>{};
  const sw=new EventTarget();sw.controller=controlled?worker:null;sw.register=async()=>{window.__registered=true;return registration;};
  Object.defineProperty(navigator,'serviceWorker',{value:sw,configurable:true});
  window.__claim=()=>{sw.controller=worker;sw.dispatchEvent(new Event('controllerchange'));};
  window.__install=()=>{worker.state='installed';registration.waiting=worker;worker.dispatchEvent(new Event('statechange'));};
  window.__workerMessages=worker.messages;
  const n=Number(sessionStorage.getItem('documents')||0)+1;sessionStorage.setItem('documents',String(n));
  window.__lateClaim=window.__claim;
 },{controlled});
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><dialog id="conversation"><input aria-label="Synthetic draft"></dialog>'}):(unexpected.push(r.request().url()),r.abort()));
 await page.goto(origin+(lite?'/?lite=1':'/'));await page.addScriptTag({content:script});await page.waitForFunction(()=>window.__registered);
 return{context,page,errors,unexpected,async close(){await context.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}};
}

test('first worker claim preserves the open mobile conversation, draft and scroll; a real controlled-page update still reloads once',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const lite of [false,true]){
  const fresh=await setup(browser,{lite});try{
   await fresh.page.evaluate(()=>{document.body.style.height='3000px';scrollTo(0,420);document.querySelector('dialog').showModal();});
   await fresh.page.getByLabel('Synthetic draft').fill('Keep my unsent message');
   await fresh.page.evaluate(()=>{window.__install();window.__claim();window.__claim();});
   await fresh.page.waitForTimeout(300);
   assert.equal(await fresh.page.evaluate(()=>sessionStorage.getItem('documents')),'1');
   assert.equal(await fresh.page.locator('dialog').evaluate(d=>d.open),true);
   assert.equal(await fresh.page.getByLabel('Synthetic draft').inputValue(),'Keep my unsent message');
   assert.equal(await fresh.page.evaluate(()=>scrollY),420);
   await fresh.page.evaluate(()=>window.__unmount());
   await fresh.page.evaluate(()=>window.__lateClaim());await fresh.page.waitForTimeout(100);
   assert.equal(await fresh.page.evaluate(()=>sessionStorage.getItem('documents')),'1','unmounted listeners must be removed');
  }finally{await fresh.close();}
  const update=await setup(browser,{controlled:true,lite});try{
   await update.page.evaluate(()=>window.__install());
   assert.ok(await update.page.evaluate(()=>window.__workerMessages.some(m=>m.type==='SKIP_WAITING')),'the update activation path stays enabled');
   await Promise.all([update.page.waitForEvent('framenavigated',f=>f===update.page.mainFrame()),update.page.evaluate(()=>{window.__claim();window.__claim();}).catch(e=>{if(!/context was destroyed/.test(e.message))throw e;})]);
   await update.page.waitForLoadState('load');
   assert.equal(await update.page.evaluate(()=>sessionStorage.getItem('documents')),'2');
   assert.equal(await update.page.evaluate(()=>performance.getEntriesByType('navigation')[0].type),'reload');
  }finally{await update.close();}
 }}finally{await browser.close();}
});
