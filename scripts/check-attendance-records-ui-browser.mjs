// Synthetic, memory-only UI regression. No app server, auth, storage or real API.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import ts from 'typescript';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const text=readFileSync(path.join(root,'src/components/admin/MerchantEnterpriseManager.tsx'),'utf8');
const ast=ts.createSourceFile('actual.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function extract(predicate,expression){
  const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(ast);
  assert.equal(found.length,1);return expression(found[0]).getText(ast);
}
const navigate=extract(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='confirmViewChange',n=>n.initializer.arguments[0]);
const unload=extract(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='useEffect'&&n.arguments[0]?.getText(ast).includes('const preventUnsavedUnload'),n=>n.arguments[0]);
const entry=`
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Records from './src/components/enterprise/MerchantAttendanceRecordsPanel';
window.__proof={calls:[],hold:false,pickers:0};
const noop=()=>{};
const apiFetch=async(url,init)=>{
  if(init?.method && init.method!=='GET')throw Error('business writes forbidden');
  const u=new URL(url,'https://synthetic.invalid');
  if(u.pathname!=='/api/merchant-enterprise/attendance/records')throw Error('unexpected synthetic request');
  window.__proof.calls.push({url,method:init?.method??'GET'});
  if(window.__proof.hold)await new Promise((resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
  return new Response(JSON.stringify({ok:true,moduleEnabled:true,siteId:'99990001',access:u.searchParams.get('access'),
    scopeRevision:u.searchParams.get('access')==='owner'?null:1,asOf:'2026-10-26T00:00:00.000000Z',items:[],nextCursor:null}),{headers:{'content-type':'application/json'}});
};
function Harness(){
  const [open,setOpen]=useState(true),access=window.__access;
  const tab='attendanceRecords',actor={id:'synthetic-viewer',type:access==='owner'?'owner':'employee'},busy=false,canAutoRefreshOnFocus=false;
  const attendanceLeaveScope='99990001:synthetic-viewer:attendanceRecords';
  const correctionLeaveGuardRef={current:null},attendanceLeaveGuardRef={current:null},accountStatusClient=null;
  const hasStoredAttendanceScopeOperation=()=>false;
  const setMessage=noop,setEditingTaskId=noop,setDraggingTaskId=noop,setShowBoardSettings=noop,setMobileTaskComposerOpen=noop;
  const currentWorkEmployeeIdRef={current:''},employeeCurrentWorkGenerationRef={current:0},employeeCurrentWorkAbortRef={current:null};
  const setCurrentWorkEmployeeId=noop,setEmployeeCurrentWork=noop,EMPTY_CURRENT_OPERATIONS_STATE={};
  const confirmViewChange=${navigate};
  useEffect(${unload},[]);
  return <main className="mx-auto max-w-5xl p-6 font-sans"><h1>考勤明细 · 隔离合成数据验收</h1>
    {open?<Records siteId="99990001" actorId="synthetic-viewer" access={access} apiFetch={apiFetch}/>:<p role="status">已离开只读查询页</p>}
    <button type="button" onClick={()=>{if(confirmViewChange(null))setOpen(false);}}>离开当前模块</button></main>;
}
createRoot(document.getElementById('root')).render(<Harness/>);
`;
const bundle=await build({stdin:{contents:entry,loader:'tsx',resolveDir:root},bundle:true,platform:'browser',format:'iife',write:false,
  define:{'process.env':'{}'},logLevel:'silent'});
const css=await postcss([tailwind({base:root})]).process(`@import "tailwindcss" source(none);
@source "./src/components/enterprise/MerchantAttendanceRecordsPanel.tsx";
@source inline("mx-auto max-w-5xl p-6 font-sans");
body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}input,button{font:inherit}input{color:#0f172a}`,
  {from:path.join(root,'records-ui-proof.css')});
assert.match(css.css,/\.opacity-0/);
const output=process.argv[2];if(output)mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try{
  for(const locale of ['zh-CN','es-ES','en-GB'])for(const mobile of [false,true]){
    const access=mobile?'manager':'owner',context=await browser.newContext({locale,timeZoneId:'Europe/Madrid',viewport:mobile?{width:390,height:844}:{width:1280,height:800}});
    await context.route('**/*',route=>route.abort()); // every external request is forbidden
    const page=await context.newPage(),dialogs=[],errors=[];
    page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div></body></html>`);
    await page.evaluate(value=>{window.__access=value;},access);await page.addScriptTag({content:bundle.outputFiles[0].text});
    const start=page.getByLabel('开始日期',{exact:true}),end=page.getByLabel('结束日期（含当天）',{exact:true});
    await start.fill('2026-10-25');await end.fill('2026-10-25');
    await page.getByLabel('查询／显示时区',{exact:true}).fill('Europe/Madrid');
    assert.equal(await page.evaluate(()=>window.__proof.calls.length),0);
    await page.getByRole('button',{name:'选择开始日期',exact:true}).click();await page.keyboard.press('Escape');
    await page.evaluate(()=>{for(const el of document.querySelectorAll('input[type=date]'))el.showPicker=()=>{window.__proof.pickers++;};});
    await page.getByRole('button',{name:'选择开始日期',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__proof.pickers),1);assert.equal(await page.evaluate(()=>window.__proof.calls.length),0);
    await page.locator('input[type=date]').first().fill('2026-10-24',{force:true});assert.equal(await start.inputValue(),'2026-10-24');
    await page.getByRole('button',{name:'查询明细',exact:true}).click();
    await page.getByRole('status').filter({hasText:'当前条件及授权范围内没有记录。'}).waitFor();
    const calls=await page.evaluate(()=>window.__proof.calls);assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
    const query=new URL(calls[0].url,'https://synthetic.invalid').searchParams;
    assert.equal(query.get('access'),access);assert.equal(query.get('fromAt'),'2026-10-23T22:00:00.000000Z');assert.equal(query.get('toAt'),'2026-10-25T23:00:00.000000Z');
    await start.fill('2026-02-30');await page.getByRole('button',{name:'查询明细',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__proof.calls.length),1,'impossible dates never query');
    await start.fill('2026-1');assert.equal(await start.evaluate(el=>el.checkValidity()),false);
    await start.fill('');assert.equal(await start.evaluate(el=>el.checkValidity()),false);
    await start.fill('2026-10-24');
    await page.getByRole('button',{name:'查询明细',exact:true}).click();await page.getByRole('status').filter({hasText:'当前条件及授权范围内没有记录。'}).waitFor();
    const layout=await start.evaluate(el=>({width:el.getBoundingClientRect().width,visible:getComputedStyle(el).opacity,value:el.value,
      nativeOpacity:[...document.querySelectorAll('input[type=date]')].map(n=>getComputedStyle(n).opacity),
      overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(layout.value,'2026-10-24');assert.equal(layout.visible,'1');assert.deepEqual(layout.nativeOpacity,['0','0']);assert.equal(layout.overflow,false);assert.ok(layout.width>200);
    if(output&&locale==='zh-CN')await page.screenshot({path:path.join(output,mobile?'records-mobile.png':'records-desktop.png'),fullPage:true});
    await page.evaluate(()=>{window.__proof.hold=true;});await page.getByRole('button',{name:'查询明细',exact:true}).click();
    await page.getByRole('status').filter({hasText:'正在核验权限并读取当前页'}).waitFor();
    await page.getByRole('button',{name:'离开当前模块',exact:true}).click();await page.getByRole('status').filter({hasText:'已离开只读查询页'}).waitFor();
    assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
    results.push({locale,access,viewport:mobile?'mobile':'desktop',isoDisplay:true,query:'GET only; exact Madrid DST boundaries',noFalseDialog:true});
    await context.close();
  }
  console.log(JSON.stringify({passed:results.length,realBusinessRequests:0,cases:results}));
}finally{await browser.close();}
