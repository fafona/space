// Actual template UI and copy helper, synthetic network/data only. Runs in the
// existing mandatory browser CI job; never reads a person's browser or session.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
import sharp from 'sharp';
const id='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222';
const design={desktop:[{id:'home',name:'Synthetic home',blocks:[{id:'title',type:'text',props:{heading:'Desktop sample',text:'Example'}}]}],mobile:[{id:'home',name:'Synthetic mobile',blocks:[{id:'title',type:'text',props:{heading:'Mobile sample',text:'Example'}}]}]};
const card={id,revision,name:'Synthetic park',category:'娱乐',status:'published',sortOrder:0,coverImageUrl:'',desktopPageCount:1,mobilePageCount:1,updatedAt:'2026-11-11T00:00:00Z'};
const homeSnapshots={revision,desktop:{imageUrl:'data:image/webp;base64,'+(await sharp({create:{width:1200,height:6000,channels:3,background:'#d9e8e6'}}).webp().toBuffer()).toString('base64'),width:1200,height:6000},mobile:{imageUrl:'data:image/webp;base64,'+(await sharp({create:{width:390,height:7800,channels:3,background:'#efe3db'}}).webp().toBuffer()).toString('base64'),width:390,height:7800}};
async function fixture(browser,admin,mobile,options={}){
 const context=await browser.newContext({viewport:{width:options.width??(mobile?390:1280),height:900}}),page=await context.newPage(),requests=[],errors=[],unexpected=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='https://website-template-audit.invalid'){unexpected.push(request.url());return route.abort();}
  if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body>'});
  if(url.pathname===(admin?'/api/super-admin/website-templates':'/api/website-templates')){
   requests.push({method:request.method(),query:url.search,body:request.method()==='POST'?request.postDataJSON():null});
   if(request.method()==='POST')return route.fulfill({json:{template:{...card,status:'draft'}}});
   return route.fulfill({json:url.searchParams.has('id')?{template:{...card,design,...(url.searchParams.get('homeSnapshot')==='1'?{homeSnapshots}:{})}}:{templates:options.longCatalog?[card,...Array.from({length:29},(_,i)=>({...card,id:'synthetic-'+i,name:'Example '+i}))]:[card],nextOffset:null}});
  }
  unexpected.push(request.url());return route.abort();
 });
 const script=(await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import Library from './src/components/admin/WebsiteTemplateLibrary';import{installWebsiteTemplate}from'./src/lib/websiteTemplateLibrary';
 const config=()=>({activePlanId:'plan-1',plans:[1,2,3].map(n=>({id:'plan-'+n,name:'方案'+n,activePageId:'original',blocks:[],pages:[{id:'original',name:'Original',blocks:[]}]}))});
 window.__target={desktop:config(),mobile:config()};window.__before=structuredClone(window.__target);window.__applied=null;
 createRoot(document.getElementById('root')).render(<React.StrictMode><Library admin={${admin}} ${admin?'':'onClose={()=>{window.__closed=true}}'} plans={[{id:'plan-1',name:'方案一'},{id:'plan-3',name:'方案三'}]} onApply={async(template,target)=>{window.__applied=installWebsiteTemplate(template.design,window.__target,target)}}/></React.StrictMode>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',jsx:'automatic',define:{'process.env':'{}'}})).outputFiles[0].text;
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./src/components/admin/WebsiteTemplateLibrary.tsx";',{from:path.resolve('website-template-acceptance.css')})).css;
 await page.goto('https://website-template-audit.invalid/library');await page.addStyleTag({content:css});await page.addScriptTag({content:script});
 await page.getByRole('button',{name:'预览 Synthetic park',exact:true}).waitFor();return{context,page,requests,errors,unexpected};
}
test('merchant library works on desktop/mobile, copies only the selected plan, and never writes the catalog',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const mobile of [false,true]){
  const f=await fixture(browser,false,mobile);try{
   assert.equal(await f.page.getByText('来源用户 ID',{exact:true}).count(),0);
   assert.equal(await f.page.getByText('预览并选择使用 →',{exact:true}).count(),0);
   await f.page.getByRole('button',{name:'预览',exact:true}).click();
   await f.page.getByRole('button',{name:'手机端',exact:true}).click();
   assert.match(await f.page.getByRole('link',{name:/完整预览/}).getAttribute('href'),/viewport=mobile/);
   await f.page.getByRole('combobox',{name:'目标方案'}).selectOption('plan-3');await f.page.getByRole('button',{name:'使用模板',exact:true}).click();
   await f.page.waitForFunction(()=>window.__applied!==null);
   const result=await f.page.evaluate(()=>({before:window.__before,source:window.__target,copy:window.__applied}));
   assert.deepEqual(result.source,result.before);
   for(const view of ['desktop','mobile']){assert.deepEqual(result.copy[view].plans.slice(0,2),result.before[view].plans.slice(0,2));assert.equal(result.copy[view].plans[2].pages[0].id,'home');assert.equal(result.copy[view].activePlanId,'plan-1');}
   assert(f.requests.every(r=>r.method==='GET'));assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await f.page.keyboard.press('Escape');assert.equal(await f.page.evaluate(()=>window.__closed),true);
  }finally{await f.context.close();}
 }}finally{await browser.close();}
});

test('preview pins one centered copy toolbar, shows whole viewport-specific home images, restores catalog scroll',{timeout:120000},async()=>{
 const browser=await chromium.launch({headless:true});try{for(const width of [320,390,1280,1920]){
  const f=await fixture(browser,false,width<768,{width,longCatalog:true});try{
   const scroller=f.page.locator('[data-template-library-scroll]');
   await scroller.evaluate(el=>{el.scrollTop=80;});
   const catalogPosition=await scroller.evaluate(el=>el.scrollTop);assert(catalogPosition>0);
   // A direct click preserves the deliberate catalog scroll position while selecting its first card.
   await f.page.getByRole('button',{name:'预览 Synthetic park',exact:true}).evaluate(el=>el.click());
   const toolbar=f.page.locator('[data-template-preview-toolbar]'),group=f.page.getByRole('group',{name:'复制模板到方案'});
   await toolbar.waitFor();assert.equal(await group.count(),1);assert.equal(await scroller.evaluate(el=>el.scrollTop),0);
   assert.equal(await scroller.getByRole('combobox',{name:'目标方案'}).count(),0,'copy controls are not in the scroller');
   const before=await toolbar.boundingBox(),middle=await group.boundingBox();
   if(width>=1024)assert(Math.abs((middle.x+middle.width/2)-(before.x+before.width/2))<2,'copy controls truly centered');
   const image=f.page.locator('[data-template-home-snapshot="full"] img');
   await image.evaluate(el=>el.decode());
   const desktop=await image.evaluate(el=>({naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,width:el.clientWidth,height:el.clientHeight}));
   assert.equal(desktop.naturalHeight,6000);assert(Math.abs(desktop.height/desktop.width-5)<.03,'not cropped to cover ratio');
   await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   const after=await toolbar.boundingBox();assert.deepEqual(after,before,'toolbar does not move with content');
   assert.equal(await f.page.getByRole('button',{name:'← 返回模板库',exact:true}).isVisible(),true);
   await f.page.getByRole('button',{name:'手机端',exact:true}).click();assert.equal(await scroller.evaluate(el=>el.scrollTop),0);
   await image.evaluate(el=>el.decode());
   const phone=await image.evaluate(el=>({naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight,width:el.clientWidth,height:el.clientHeight}));
   assert.equal(phone.naturalWidth,390);assert.equal(phone.naturalHeight,7800);assert(Math.abs(phone.height/phone.width-20)<.03);
   assert.equal(await f.page.evaluate(()=>Array.from(document.querySelectorAll('[data-template-preview-toolbar], [data-template-library-scroll]')).every(el=>el.scrollWidth<=el.clientWidth+1)),true,'no horizontal overflow');
   await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
   await f.page.getByRole('button',{name:'← 返回模板库',exact:true}).click();
   assert.equal(await scroller.evaluate(el=>el.scrollTop),catalogPosition,'return restores prior catalog position');
   assert(f.requests.every(r=>r.method==='GET'));assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
  }finally{await f.context.close();}
 }}finally{await browser.close();}
});
test('admin capture and publication require explicit source inputs and publication review',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true}),f=await fixture(browser,true,false);try{
  await f.page.getByRole('textbox',{name:'来源用户 ID',exact:true}).fill('10000000');
  await f.page.getByRole('combobox',{name:'来源方案',exact:true}).selectOption('plan-3');
  await f.page.getByRole('textbox',{name:'模板名称',exact:true}).fill('Synthetic new park');
  await f.page.getByRole('button',{name:'收录为模板草稿',exact:true}).click();await f.page.getByText(/已保存独立模板草稿。/).waitFor();
  const capture=f.requests.find(r=>r.body?.action==='capture');assert.equal(capture.body.sourceSiteId,'10000000');assert.equal(capture.body.sourcePlanId,'plan-3');assert.equal(capture.body.status,undefined);
  // The returned list is synthetic published data; cancellation must not send a mutation.
  const writes=f.requests.filter(r=>r.method==='POST').length;
  f.page.once('dialog',d=>d.dismiss());await f.page.getByRole('button',{name:'保存资料',exact:true}).click();
  await f.page.getByRole('button',{name:'保存资料',exact:true}).waitFor();assert.equal(f.requests.filter(r=>r.method==='POST').length,writes);
  f.page.once('dialog',d=>d.accept());await f.page.getByRole('button',{name:'保存资料',exact:true}).click();await f.page.getByText(/模板已上架。/).waitFor();
  const update=f.requests.filter(r=>r.body?.action==='update').at(-1);assert.equal(update.body.reviewed,true);assert.equal(update.body.revision,revision);
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
 }finally{await f.context.close();await browser.close();}
});
