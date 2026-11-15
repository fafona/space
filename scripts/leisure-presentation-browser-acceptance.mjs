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
 const css=(await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "../src/components/blocks";\n@source "../src/components/admin/InlineEditorBlock.tsx";\n@source "../src/components/admin/SiteNavigationSettings.tsx";\n'+await readFile('src/components/blocks/leisurePresentation.css','utf8')+'\n'+await readFile('src/components/blocks/siteNavigation.css','utf8'),{from:path.resolve('scripts/leisure-fixture.css')})).css;
 const script=(await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{SearchParamsContext}from'next/dist/shared/lib/hooks-client-context.shared-runtime';
 import Blocks from'./src/components/blocks/BlockRenderer';import Gallery from'./src/components/blocks/GalleryBlock';
 import Editor from'./src/components/admin/InlineEditorBlock';import Layout from'./src/components/blocks/LeisurePageLayout';
 import{getLeisureBlockStyle,getLeisureRole}from'./src/lib/leisurePresentation';
 import{useMobileHorizontalScrollLock}from'./src/lib/useMobileHorizontalScrollLock';
 const params=new URLSearchParams(location.search),noop=()=>{};
 function App(){const[blocks,setBlocks]=useState(window.__fixture),[selected,setSelected]=useState(null),[page,setPage]=useState('home');
 useMobileHorizontalScrollLock(params.has('public-shell')&&params.has('mobile-lock'));
 window.__blocks=blocks;
 if(params.has('legacy'))return <Gallery {...window.__gallery.props} galleryControls={undefined}/>;
 return <SearchParamsContext.Provider value={params}><main className={params.has('public-shell')?'faolla-public-site-shell':undefined} style={{width:params.has('narrow')?422:'100%',maxWidth:'100%',overflowX:params.has('public-shell')?'hidden':undefined}}>
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
 const brandFixture=structuredClone(fixture);
 if(options.brand)Object.assign(brandFixture[0].props,{navLayout:'brand-header',navLogoUrl:image(1),navSticky:true,bgColor:'#303136',fontColor:'#ffffff',navCtaPageId:'visit',navSubItems:[{id:'child-home',parentPageId:'home',label:'Explore experiences',pageId:'home'},{id:'child-visit',parentPageId:'home',label:'Book a visit',pageId:'visit'}]});
 await page.goto(origin+'/?'+query);await page.evaluate(({fixture,gallery,visit})=>{window.__fixture=fixture;window.__gallery=gallery;window.__visit=visit;},{fixture:options.ordinary?ordinary(brandFixture):brandFixture,gallery,visit:options.ordinary?ordinary(visit):visit});
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

test('public brand header remains sticky through the actual public shell and mobile horizontal lock without changing classic pages or modal scroll locking',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [1440,390,320]){
   const query='public-shell=1'+(width<=900?'&mobile-lock=1':'');
   const f=await mount(browser,width,query,{brand:true});try{
    await f.page.evaluate(()=>scrollTo(0,800));
    await f.page.waitForFunction(()=>scrollY>=700);
    const header=f.page.locator('[data-leisure-role="header"]');
    const sticky=await header.boundingBox();assert(Math.abs(sticky.y)<2,'the real public shell and mobile html/body lock must not trap the sticky header');
    assert.equal(await f.page.evaluate(()=>getComputedStyle(document.querySelector('main.faolla-public-site-shell')).overflowX),'clip');
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await header.evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.left+20,rect.top+20));}),true,'sticky header remains above the scrolled page');
    const modal=await f.page.evaluate(()=>{const body=document.body,before=body.style.overflow;try{body.style.overflow='hidden';return{vertical:getComputedStyle(body).overflowY,overscrollX:body.style.overscrollBehaviorX};}finally{body.style.overflow=before;}});
    assert.equal(modal.vertical,'hidden','the scoped horizontal fix must retain modal vertical scroll locking');
    assert.equal(modal.overscrollX,width<=900?'none':'');
    if(width<=900){assert.equal(await f.page.evaluate(()=>getComputedStyle(document.documentElement).overflowX),'clip');assert.equal(await f.page.evaluate(()=>getComputedStyle(document.body).overflowX),'clip');}
   }finally{await f.close();}
   const classic=await mount(browser,width,query);try{
    assert.equal(await classic.page.locator('[data-site-navigation]').count(),0);
    assert.equal(await classic.page.evaluate(()=>getComputedStyle(document.querySelector('main.faolla-public-site-shell')).overflowX),'hidden','classic public pages retain their original overflow policy');
    if(width<=900)for(const tag of ['html','body'])assert.equal(await classic.page.locator(tag).evaluate(element=>getComputedStyle(element).overflowX),'hidden','unrelated mobile pages retain the original horizontal lock');
   }finally{await classic.close();}
  }
  const editor=await mount(browser,1440,'editor=1&narrow=1',{brand:true});try{
   assert.equal(await editor.page.locator('main.faolla-public-site-shell').count(),0);
   assert.equal(await editor.page.locator('html').evaluate(element=>getComputedStyle(element).overflowX),'visible');
   assert.equal(await editor.page.locator('body').evaluate(element=>getComputedStyle(element).overflowX),'visible');
  }finally{await editor.close();}
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

test('opt-in brand navigation: sticky desktop, real submenus, keyboard/outside close, responsive mobile and native settings',{timeout:90000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const width of [1440,1024,900,390,320]){
   const f=await mount(browser,width,'',{brand:true});try{
    const nav=f.page.locator('[data-site-navigation]'),menu=nav.locator('nav'),toggle=nav.locator('.faolla-site-menu-toggle');
    assert.equal(await toggle.isVisible(),width<=900);
    if(width<=900){assert.equal(await menu.isVisible(),false);await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');}
    else assert.equal(await menu.isVisible(),true);
    const sub=nav.getByRole('button',{name:'Open submenu: Home',exact:true});
    await sub.focus();await sub.press('ArrowDown');
    const child=nav.getByRole('button',{name:'Explore experiences',exact:true});await child.waitFor();
    // Opening renders before BrandedNavigation's requestAnimationFrame focus.
    // Wait for the actual focus transition; a missing focus still times out.
    await f.page.waitForFunction(()=>document.querySelector('[data-site-navigation] .faolla-site-submenu button')===document.activeElement);
    assert.equal(await child.evaluate(e=>document.activeElement===e),true);
    await child.press('Escape');assert.equal(await child.isVisible(),false);assert.equal(await sub.evaluate(e=>document.activeElement===e),true);
    await sub.press('Enter');await child.waitFor();
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await f.page.locator('[data-block-id="intro"] h2').click();assert.equal(await child.isVisible(),false);
    if(width<=900){assert.equal(await menu.isVisible(),false);await toggle.click();}
    await f.page.evaluate(()=>scrollTo(0,800));
    const sticky=await f.page.locator('[data-leisure-role="header"]').boundingBox();assert(Math.abs(sticky.y)<2,'header stays within the actual scroll viewport');
    if(width>900){await nav.getByRole('button',{name:'Home',exact:true}).hover();await child.waitFor();await f.page.mouse.move(width-10,500);await child.waitFor({state:'hidden'});}
    await sub.focus();await sub.press('Enter');await nav.getByRole('button',{name:'Book a visit',exact:true}).click();
    await f.page.getByText('Synthetic booking',{exact:true}).waitFor();await f.page.waitForFunction(()=>scrollY<5);
   }finally{await f.close();}
  }
  const embedded=await mount(browser,1440,'editor=1&narrow=1',{brand:true});try{
   await embedded.page.locator('[data-leisure-role="header"] [data-block-visual-boundary]').click({position:{x:4,y:4}});
   const settings=embedded.page.locator('[data-site-navigation-settings]');await settings.waitFor();
   const nav=embedded.page.locator('[data-site-navigation]');await nav.getByRole('button',{name:'Open navigation',exact:true}).click();
   assert.equal(await nav.getByRole('button',{name:'Visit',exact:true}).isVisible(),true);
   assert.equal(await settings.getByLabel('页面滚动时吸顶').isChecked(),true);
   await settings.getByLabel('页面滚动时吸顶').uncheck();
   await embedded.page.waitForFunction(()=>window.__blocks[0].props.navSticky===false);
   await settings.getByRole('button',{name:'添加子栏目',exact:true}).click();
   await embedded.page.waitForFunction(()=>window.__blocks[0].props.navSubItems.length===3);
   const last=settings.getByLabel('子栏目名称',{exact:true}).last();await last.fill('Custom submenu');
   await settings.getByLabel('子栏目目标页面',{exact:true}).last().selectOption('visit');
   await embedded.page.waitForFunction(()=>window.__blocks[0].props.navSubItems.at(-1).label==='Custom submenu'&&window.__blocks[0].props.navSubItems.at(-1).pageId==='visit');
   const snapshot=await embedded.page.evaluate(()=>structuredClone(window.__blocks[0].props.navItems));
   await settings.getByLabel('导航样式',{exact:true}).selectOption('classic');
   await embedded.page.waitForFunction(()=>window.__blocks[0].props.navLayout==='classic');
   assert.equal(await embedded.page.locator('[data-site-navigation]').count(),0);assert.deepEqual(await embedded.page.evaluate(()=>window.__blocks[0].props.navItems),snapshot);
  }finally{await embedded.close();}
 }finally{await browser.close();}
});
