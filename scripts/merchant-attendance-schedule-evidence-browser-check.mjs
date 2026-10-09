// Component-only, synthetic normalized Sources fixtures. Import is inert. Root
// alone starts this memory-only loopback/browser check; no API/DB/auth claim.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-schedule-evidence-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
      node.text.split(/\s+/).filter(Boolean).forEach(item=>candidates.add(item));ts.forEachChild(node,visit);};visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])+'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

export async function checkAttendanceScheduleEvidenceBrowser({captureScreenshot}={}){
  if(captureScreenshot!==undefined)assert.equal(typeof captureScreenshot,'function');
  const files=await assets(),errors=[],requests=[],checks=[];let browser,origin;
  const server=createServer((request,response)=>{
    const pathname=new URL(request.url,'http://127.0.0.1').pathname;
    const file=pathname==='/'?{type:'text/html; charset=utf-8',body:'<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成排班时间对照验收</title><link rel="stylesheet" href="/qa.css"><body><div id="root"></div><script type="module" src="/qa.js"></script></body></html>'}
      :pathname==='/qa.js'?{type:'text/javascript; charset=utf-8',body:files.javascript}:pathname==='/qa.css'?{type:'text/css; charset=utf-8',body:files.css}:null;
    if(request.method!=='GET'||!file){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'content-type':file.type,'cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});response.end(file.body);
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:1100},serviceWorkers:'block',acceptDownloads:false});
    await context.addInitScript(()=>{
      const probe={storageWrites:0,fetches:0,csp:[]};Object.defineProperty(window,'__scheduleEvidenceProbe',{value:probe});
      for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){probe.storageWrites++;return original.apply(this,args);};}
      const original=window.fetch;window.fetch=function(...args){probe.fetches++;return original.apply(this,args);};
      document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
    });
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),url:url.pathname});
      if(url.origin!==origin||request.method()!=='GET'||url.search||!['/','/qa.js','/qa.css'].includes(url.pathname)){
        errors.push('unexpected_component_request');await route.abort();return;
      }
      await route.continue();
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));page.on('download',()=>errors.push('unexpected_download'));page.on('popup',()=>errors.push('unexpected_popup'));
    await page.goto(origin);const region=page.getByRole('region',{name:'排班与记录时间对照'});
    await region.waitFor();await page.waitForLoadState('networkidle');
    const requestCount=requests.length,view=()=>region.locator('[data-schedule-evidence-view]');
    const width=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'component_horizontal_overflow');
    const select=async mode=>{await page.getByRole('combobox',{name:'验收场景'}).selectOption(mode);await region.waitFor();};
    assert.equal(await region.getByRole('alert').count(),0);assert.equal(await view().getAttribute('data-schedule-evidence-view'),'original');
    assert.equal(await region.locator('[data-schedule-evidence-record]').count(),2);assert.equal(await region.locator('[data-evidence-kind="missing-approved"]').count(),0);
    assert.equal(await region.locator('[data-evidence-cancelled="true"]').count(),1);assert((await region.innerText()).includes('观察截至'));
    await region.getByRole('tab',{name:'原始记录',exact:true}).focus();await page.keyboard.press('ArrowRight');
    assert.equal(await region.getByRole('tab',{name:'当前核定记录',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await region.locator('[data-evidence-kind="approved"]').count(),1);assert.equal(await region.locator('[data-evidence-kind="missing-approved"]').count(),1);
    assert((await region.innerText()).includes('独立整段漏卡申报，不是原始打卡'));await width();checks.push('keyboard tabs preserve original/corrected/independent missing and open/cancelled distinctions');

    const firstSlot=region.locator('[data-schedule-evidence-slot]').first();
    await firstSlot.getByText('请假注记（只列窗口内交集，不自动免除排班）',{exact:true}).click();
    await firstSlot.getByText('日历注记（节假日／停业提示，不是免班依据）',{exact:true}).click();
    const notes=await firstSlot.innerText();assert(notes.includes('员工身份不一致，不能套用'));assert(notes.includes('部分交集不等于整段免除'));
    assert(notes.includes('<img src=x onerror=alert(2)> 提示'));assert.equal(await region.locator('img,script,iframe').count(),0);await width();checks.push('approved partial leave and calendar remain escaped identity-aware annotations');

    await select('pages');assert.equal(await region.locator('[data-schedule-evidence-record]').count(),10);assert.equal(await region.locator('[data-schedule-evidence-slot]').count(),10);
    await region.getByRole('button',{name:'下一页时间记录',exact:true}).click();assert.equal(await region.locator('[data-schedule-evidence-record]').count(),1);
    await region.getByRole('button',{name:'下一页时间排班',exact:true}).click();assert.equal(await region.locator('[data-schedule-evidence-slot]').count(),1);
    await region.getByRole('button',{name:'上一页时间记录',exact:true}).click();assert.equal(await region.locator('[data-schedule-evidence-record]').count(),10);
    await width();checks.push('record and schedule pages independently show10 then1 without a request');

    await select('many');const record=region.locator('[data-schedule-evidence-record]');assert.equal(await record.count(),1);
    await record.getByText('查看时间相交候选排班（12 条，不自动选取）',{exact:true}).click();
    assert.equal(await record.locator('[data-evidence-candidate]').count(),10);await record.getByRole('button',{name:'下一页候选排班',exact:true}).click();
    assert.equal(await record.locator('[data-evidence-candidate]').count(),2);assert((await record.innerText()).includes('不能自动配对'));await width();checks.push('split-schedule many-candidate detail is separately bounded10 then2');

    await select('limited');assert.equal(await region.locator('[data-schedule-evidence-slot]').count(),0);assert((await region.innerText()).includes('排班资料未完整取得'));
    assert((await region.innerText()).includes('请假资料未完整取得'));assert.equal(await region.locator('[data-evidence-time-difference]').count(),0);
    await width();checks.push('limited sections stay unknown instead of empty or zero');

    await select('invalid');assert.equal(await region.getByRole('alert').count(),1);assert.equal(await page.getByTestId('other-evidence').count(),1);
    await page.getByRole('button',{name:'移除当前结果',exact:true}).click();assert.equal(await region.count(),0);
    await page.getByRole('button',{name:'重新展示结果',exact:true}).click();await select('rich');assert.equal(await region.getByRole('alert').count(),0);
    assert.equal(await region.getByRole('tab',{name:'原始记录',exact:true}).getAttribute('aria-selected'),'true');await width();checks.push('invalid child remains isolated and parent result removal resets local state');
    const probe=await page.evaluate(()=>window.__scheduleEvidenceProbe);assert.deepEqual(probe,{storageWrites:0,fetches:0,csp:[]});
    assert.deepEqual(errors,[]);assert.equal(requests.length,requestCount);assert.equal(checks.length,6);
    if(captureScreenshot){await page.evaluate(()=>window.scrollTo(0,0));await captureScreenshot(await page.screenshot({animations:'disabled'}));}
    return {checks:checks.length,labels:checks,viewportWidth:390,apiRequests:0,posts:0,storageWrites:0,externalRequests:0,
      memoryOnlyBundle:true,actualComponent:true,actualSourcesParser:true,databaseUsed:false,realAuth:false,fullParentE2E:false,screenshotCaptured:!!captureScreenshot};
  }finally{
    await runAttendanceCleanupSteps([
      {name:'schedule-evidence-browser',run:async()=>{await browser?.close();}},
      {name:'schedule-evidence-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}
