// Real block renderer, carousel and inline editor; disposable synthetic data only.
// Imported by the existing mandatory template browser job, not production smoke tests.
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';

const origin='https://leisure-layout.invalid';
const image=n=>origin+'/synthetic-'+n+'.svg';
const b=(id,type,role,props={})=>({id,type,props:{schemaVersion:3,pagePresentation:'leisure-home-v1',leisureRole:role,mobileFitScreenWidth:false,bgColor:'#fff',blockBorderStyle:'none',...props}});
const text=(id,role)=>b(id,'text',role,{heading:'Synthetic '+id,text:'Synthetic editable content. A short description of this activity.'});
const button=(id,role)=>b(id,'button',role,{buttonLabel:'Synthetic action',buttonJumpTarget:'page:visit',blockHeight:54,bgColor:'#ff8b70',fontSize:14});
const gallery=b('hero','gallery','hero',{heading:'Synthetic\nleisure page',autoplayMs:1000,galleryControls:'hero',galleryFrameHeight:630,images:[1,2,3].map(n=>({id:'image-'+n,url:image(n),featured:true,fitToFrame:true})),galleryPreviousLabel:'Previous image',galleryNextLabel:'Next image',galleryPauseLabel:'Pause images',galleryPlayLabel:'Play images'});
const fixture=[b('header','nav','header',{heading:'Synthetic leisure',navItems:[{id:'home',label:'Home',pageId:'home'},{id:'visit',label:'Visit',pageId:'visit'}]}),gallery,text('hero-copy','hero-copy'),button('primary','primary'),button('secondary','secondary'),text('intro','intro'),b('photo','common','photo-one',{bgImageUrl:image(1),blockHeight:440,commonTextBoxes:[]}),text('copy','copy-one'),button('copy-link','copy-one-link'),...['one','two','three'].flatMap(n=>[text('panel-'+n,'panel-'+n),button('panel-'+n+'-link','panel-'+n+'-link')]),text('footer','footer'),b('extra','text',undefined,{heading:'New ordinary editor block',text:'Must not disappear.'})];
const visit=[b('booking','booking','booking',{pagePresentation:'leisure-visit-v1',heading:'Synthetic booking',bookingButtonLabel:'Send synthetic request',bookingStores:['Synthetic store'],bookingItems:['Synthetic activity']}),b('long-visit','common',undefined,{pagePresentation:'leisure-visit-v1',blockHeight:2400,commonTextBoxes:[]})];
let assetsPromise;
async function assets(){return assetsPromise??=(async()=>{
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "../src/components/blocks";\n@source "../src/components/admin/InlineEditorBlock.tsx";\n'+await readFile('src/components/blocks/leisurePresentation.css','utf8'),{from:path.resolve('scripts/leisure-fixture.css')})).css;
 const script=(await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{SearchParamsContext}from'next/dist/shared/lib/hooks-client-context.shared-runtime';
 import Blocks from'./src/components/blocks/BlockRenderer';import Gallery from'./src/components/blocks/GalleryBlock';
 import Editor from'./src/components/admin/InlineEditorBlock';import Layout from'./src/components/blocks/LeisurePageLayout';
 import{getLeisureBlockStyle,getLeisureRole}from'./src/lib/leisurePresentation';
 const params=new URLSearchParams(location.search),noop=()=>{};
 function App(){const[blocks,setBlocks]=useState(window.__fixture),[selected,setSelected]=useState(null),[page,setPage]=useState('home');
 window.__blocks=blocks;
 if(params.has('legacy'))return <Gallery {...window.__gallery.props} galleryControls={undefined}/>;
 return <SearchParamsContext.Provider value={params}><main style={{width:params.has('narrow')?422:'100%',maxWidth:'100%'}}>
 {params.has('editor')?<Layout blocks={blocks} editorBoundary>{blocks.map((block,i)=><div className="relative" key={block.id} data-leisure-role={getLeisureRole(block)} style={getLeisureBlockStyle(block,i)}><Editor block={block} publicBlockId={'010'+i} draggingBlockId={null} isSelected={selected===block.id} onDragHandleMouseDown={noop} onNudge={noop} onLayerToFront={noop} onLayerUp={noop} onLayerDown={noop} onLayerToBack={noop} onSelect={()=>setSelected(block.id)} onChange={patch=>setBlocks(bs=>bs.map(b=>b.id===block.id?{...b,props:{...b.props,...patch}}:b))} onResizePreview={noop} onResizeCommit={noop} previewOffsetY={0} onDelete={noop} onAlert={noop} availablePages={[{id:'home',name:'Home'},{id:'visit',name:'Visit'}]} availableBlocks={[]} currentPageId="home" recentColors={[]} onRecordColor={noop} onClearRecentColors={noop} onApplyNavSettingsToOtherPages={noop} onPersistImageFile={async()=>{throw Error('unexpected upload')}} onPersistProductImageFile={async()=>{throw Error('unexpected upload')}} onPersistAudioFile={async()=>{throw Error('unexpected upload')}} previewViewport={params.has('narrow')?'mobile':'desktop'}/></div>)}</Layout>:<Blocks blocks={page==='home'?blocks:window.__visit} currentPageId={page} availablePages={[{id:'home',name:'Home'},{id:'visit',name:'Visit'}]} onNavigatePage={setPage} bookingSiteId="99999999" bookingViewport="desktop" bookingInteractive/>}
 </main></SearchParamsContext.Provider>;}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent',define:{'process.env':'{}'},plugins:[{name:'synthetic-io',setup(builder){
  builder.onResolve({filter:/^@\/components\/I18nProvider$/},()=>({path:'locale',namespace:'synthetic'}));
  builder.onResolve({filter:/^@\/lib\/authSessionRecovery$/},()=>({path:'auth',namespace:'synthetic'}));
  builder.onResolve({filter:/^@\/lib\/analytics$/},()=>({path:'analytics',namespace:'synthetic'}));
  builder.onLoad({filter:/.*/,namespace:'synthetic'},({path:name})=>({loader:'js',contents:name==='locale'?"export const useI18n=()=>({locale:'en-US',t:k=>k});":name==='analytics'?'export const trackContactClick=()=>{};':'export const resolveFrontendAuthPayload=async()=>({authenticated:false});export const clearStoredBrowserSupabaseSessionTokens=()=>{};'}));
 }}]})).outputFiles[0].text;
 return{css,script};
})();}

async function mount(browser,width,query='',options={}){
 const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:options.reducedMotion??'no-preference'}),page=await context.newPage(),errors=[],unexpected=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin===origin&&request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body>'});
  if(url.origin===origin&&/^\/synthetic-[123]\.svg$/.test(url.pathname))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#678c97"/></svg>'});
  if(url.origin===origin&&url.pathname==='/api/bookings/workbench/public'&&request.method()==='GET')return route.fulfill({json:{ok:true,settings:{timeZone:'Europe/Madrid',recurringRules:[],storeColorStyles:{},itemColorStyles:{}}}});
  unexpected.push(request.method()+' '+request.url());return route.abort();
 });
 const ordinary=blocks=>blocks.map(b=>{const props={...b.props};delete props.pagePresentation;delete props.leisureRole;return{...b,props};});
 await page.goto(origin+'/?'+query);await page.evaluate(({fixture,gallery,visit})=>{window.__fixture=fixture;window.__gallery=gallery;window.__visit=visit;},{fixture:options.ordinary?ordinary(fixture):fixture,gallery,visit:options.ordinary?ordinary(visit):visit});
 const{css,script}=await assets();await page.addStyleTag({content:css});await page.addScriptTag({content:script});
 await page.locator(query.includes('legacy')?'img':options.ordinary?'[data-block-id="intro"]':'[data-leisure-presentation]').waitFor();
 return{page,context,errors,unexpected,async close(){await context.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);}};
}

test('leisure page genuinely changes desktop composition; phone and narrow editor stack without losing native editing', {timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [1440,1024,390,320]){
   const f=await mount(browser,width);try{
    const box=role=>f.page.locator('[data-leisure-role="'+role+'"]').boundingBox();
    const photo=await box('photo-one'),copy=await box('copy-one');
    if(width>900){assert(Math.abs(photo.y-copy.y)<2);assert(Math.abs(photo.x+photo.width-copy.x)<2);assert.equal(photo.width,width/2);}
    else{assert(copy.y>=photo.y+photo.height-1);assert.equal(copy.width,width);}
    for(const n of ['one','two','three']){
     const text=f.page.locator('[data-leisure-role="panel-'+n+'"] .mt-2'),link=f.page.locator('[data-leisure-role="panel-'+n+'-link"]');
     const t=await text.boundingBox(),l=await link.boundingBox();assert(t.y+t.height<=l.y,'panel copy and action must not overlap');
    }
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await f.page.getByText('New ordinary editor block',{exact:true}).waitFor();
    await f.page.locator('[data-leisure-role="panel-three-link"] button').click();
    await f.page.getByText('Synthetic booking',{exact:true}).waitFor();
    await f.page.waitForFunction(()=>scrollY<5);
    assert.equal(await f.page.locator('[data-block-id="booking"] form').count(),1);
   }finally{await f.close();}
  }
  for(const narrow of [false,true]){
   const f=await mount(browser,1440,'editor=1'+(narrow?'&narrow=1':''));try{
    const photo=await f.page.locator('[data-leisure-role="photo-one"]').boundingBox(),copy=await f.page.locator('[data-leisure-role="copy-one"]').boundingBox();
    assert(narrow?copy.y>=photo.y+photo.height-1:Math.abs(copy.y-photo.y)<2,'editor uses its container, not browser width');
    await f.page.locator('[data-leisure-role="intro"] [data-block-visual-boundary]').click();
    const field=f.page.locator('[data-leisure-role="intro"] [contenteditable="true"][data-field="heading"]');
    await field.fill('Changed native heading');await field.blur();
    await f.page.waitForFunction(()=>window.__blocks.find(b=>b.id==='intro').props.heading.includes('Changed native heading'));
    const toolbar=f.page.locator('[data-leisure-role="intro"] [data-editor-toolbar]');assert.equal(await toolbar.locator('button').count()>0,true);
   }finally{await f.close();}
  }
  const ordinary=await mount(browser,1440,'',{ordinary:true});try{
   await ordinary.page.locator('[data-block-id="panel-three-link"] button').click();
   await ordinary.page.getByText('Synthetic booking',{exact:true}).waitFor();
   assert(await ordinary.page.evaluate(()=>scrollY)>100,'ordinary navigation must retain its original scroll behavior');
   assert.equal(await ordinary.page.locator('.faolla-leisure-shell').count(),0);
  }finally{await ordinary.close();}
 }finally{await browser.close();}
});

test('hero carousel supports next, previous, pause, focus/hover and reduced motion; legacy autoplay is unchanged',{timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const f=await mount(browser,1440);try{
   const hero=f.page.locator('[data-block-id="hero"]'),src=()=>hero.locator('img').first().getAttribute('src');
   const first=await src();await f.page.waitForFunction(()=>document.querySelector('[data-block-id="hero"] img')?.getAttribute('src')!==window.__gallery.props.images[0].url);
   await hero.getByRole('button',{name:'Pause images',exact:true}).click();
   await f.page.mouse.move(1400,900);const paused=await src();await f.page.waitForTimeout(1200);assert.equal(await src(),paused);
   await hero.getByRole('button',{name:'Next image',exact:true}).click();assert.notEqual(await src(),paused);
   await hero.getByRole('button',{name:'Previous image',exact:true}).click();assert.equal(await src(),paused);
   await hero.getByRole('button',{name:'Play images',exact:true}).click();
   const focused=await src();await f.page.mouse.move(1400,900);await f.page.waitForTimeout(1200);assert.equal(await src(),focused,'mouse leave must not override retained keyboard focus');
   await f.page.evaluate(()=>document.activeElement.blur());await f.page.waitForFunction(value=>document.querySelector('[data-block-id="hero"] img')?.getAttribute('src')!==value,focused);
   await hero.locator('img').first().hover();const hovered=await src();await f.page.waitForTimeout(1200);assert.equal(await src(),hovered);
   assert(first);
  }finally{await f.close();}
  const reduced=await mount(browser,390,'',{reducedMotion:'reduce'});try{
   const img=reduced.page.locator('[data-block-id="hero"] img').first(),first=await img.getAttribute('src');
   await reduced.page.getByRole('button',{name:'Play images',exact:true}).waitFor();await reduced.page.waitForTimeout(1200);assert.equal(await img.getAttribute('src'),first);
   await reduced.page.getByRole('button',{name:'Next image',exact:true}).click();assert.notEqual(await img.getAttribute('src'),first);
  }finally{await reduced.close();}
  const legacy=await mount(browser,390,'legacy=1');try{
   assert.equal(await legacy.page.locator('.faolla-leisure-site,.leisure-carousel-controls').count(),0);
   const img=legacy.page.locator('img').first(),first=await img.getAttribute('src');
   await legacy.page.waitForFunction(value=>document.querySelector('img')?.getAttribute('src')!==value,first);
  }finally{await legacy.close();}
 }finally{await browser.close();}
});
