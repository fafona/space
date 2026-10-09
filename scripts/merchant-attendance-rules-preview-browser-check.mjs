// Standalone draft UI acceptance, NOT an authenticated attendance application.
// In-memory assets, loopback only, no API/DB/storage/download/retained artifacts.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright';
import {runAttendanceCleanupSteps} from './fixtures/attendance-cleanup.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
async function assets(){
  const bundle=await build({absWorkingDir:root,entryPoints:['scripts/fixtures/attendance-rules-preview-browser.tsx'],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:['es2020'],jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),outfile:'qa.js',
    define:{'process.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'warning'});
  const candidates=new Set();
  for(const filename of Object.keys(bundle.metafile.inputs).filter(name=>/\.tsx?$/.test(name)&&!name.includes('node_modules'))){
    const source=ts.createSourceFile(filename,await readFile(path.join(root,filename),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=node=>{
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)||ts.isTemplateHead(node)||ts.isTemplateMiddle(node)||ts.isTemplateTail(node))
        node.text.split(/\s+/).filter(Boolean).forEach(candidate=>candidates.add(candidate));
      ts.forEachChild(node,visit);
    };visit(source);
  }
  const css=(await compile('@import "tailwindcss";',{base:root,onDependency:()=>{}})).build([...candidates])
    +'body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif}.qa-toolbar{padding:12px;background:#fff7ed;font-size:13px}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.qa-controls button,.qa-controls select{background:white;border:1px solid #94a3b8;padding:6px}.qa-main{max-width:1160px;margin:auto;padding:12px}';
  return {javascript:bundle.outputFiles.find(file=>file.path.endsWith('.js')).contents,css};
}

const labels={late:'迟到宽限',early:'早退宽限',open:'未结束班次提醒阈值（非工时）',rest:'单段已结束休息参考下限'};
const tiers={enterprise:'企业假设',group:'组假设',personal:'个人假设'};
const result=page=>page.locator('[data-attendance-rule-preview-result]');
const draft=page=>page.locator('[data-attendance-rules-preview]');
const date=page=>page.getByLabel('未来拟生效日期（仅试算）',{exact:true});
const select=(page,tier,key)=>page.getByLabel(`${tiers[tier]} · ${labels[key]}模式`,{exact:true});
const minutes=(page,tier,key)=>page.getByLabel(`${tiers[tier]} · ${labels[key]}（分钟）`,{exact:true});
const submit=async page=>{await page.getByRole('button',{name:'试算',exact:true}).click();};
const article=(page,key)=>result(page).locator('article').filter({has:page.getByRole('heading',{name:labels[key],exact:true})});
const choose=async(page,tier,key,mode,value)=>{await select(page,tier,key).selectOption(mode);if(value!==undefined)await minutes(page,tier,key).fill(value);};
const sample=async page=>{await date(page).fill('2026-10-05');await choose(page,'enterprise','late','value','7');await submit(page);await result(page).waitFor();};
const absent=async page=>assert.equal(await result(page).count(),0,'stale_result_visible');

export async function checkAttendanceRulesPreviewBrowser(){
  const files=await assets(),errors=[],requests=[];let origin,browser,checks=0;
  const server=createServer((request,response)=>{
    if(request.headers.host!==new URL(origin).host||request.method!=='GET')return response.writeHead(403).end();
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'");
    const url=new URL(request.url??'/',origin);
    if(url.pathname==='/')return response.writeHead(200,{'Content-Type':'text/html;charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隔离考勤规则草稿</title><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>');
    if(url.pathname==='/qa.js')return response.writeHead(200,{'Content-Type':'text/javascript;charset=utf-8'}).end(files.javascript);
    if(url.pathname==='/qa.css')return response.writeHead(200,{'Content-Type':'text/css;charset=utf-8'}).end(files.css);
    return response.writeHead(403).end();
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert(address&&typeof address==='object');origin=`http://127.0.0.1:${address.port}`;
    browser=await chromium.launch({headless:true});
    const run=async(name,check,width=1280)=>{
      const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width,height:960}});
      try{
        await context.addInitScript(()=>{
          const probe={storageWrites:0,csp:[]};Object.defineProperty(window,'__rulesPreviewProbe',{value:probe});
          for(const method of ['setItem','removeItem','clear']){
            const original=Storage.prototype[method];
            Storage.prototype[method]=function(...args){probe.storageWrites++;return original.apply(this,args);};
          }
          document.addEventListener('securitypolicyviolation',event=>probe.csp.push(event.violatedDirective));
        });
        await context.route('**/*',async route=>{
          const request=route.request(),url=new URL(request.url());
          if(url.origin!==origin||request.method()!=='GET'||!['/','/qa.js','/qa.css'].includes(url.pathname)||url.search){errors.push('forbidden_request');return route.abort();}
          requests.push(url.pathname);return route.continue();
        });
        const page=await context.newPage();page.setDefaultTimeout(7000);
        page.on('pageerror',error=>errors.push(error.message));
        page.on('download',()=>errors.push('unexpected_download'));
        page.on('dialog',dialog=>{errors.push('unexpected_dialog');void dialog.dismiss();});
        await page.goto(origin);await page.getByRole('heading',{name:'考勤规则草稿试算（未保存、未生效）',exact:true}).waitFor();
        try{await check(page);}catch(error){
          process.stderr.write(`${JSON.stringify({name,selectLabels:await page.locator('select').evaluateAll(elements=>elements.slice(0,4).map(element=>({id:element.id,labels:[...element.labels].map(label=>label.textContent)})))})}\n`);
          throw error;
        }
        assert.equal(await page.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0,'storage_written');
        assert.deepEqual(await page.evaluate(()=>window.__rulesPreviewProbe),{storageWrites:0,csp:[]});
        checks++;process.stdout.write(`PASS ${name}\n`);
      }finally{await context.close();}
    };
    await run('explicit-date-and-unconfigured',async page=>{
      await submit(page);assert.match(await page.getByRole('alert').innerText(),/未来/);await absent(page);
      await date(page).fill('2026-10-05');await submit(page);await result(page).waitFor();
      assert.equal(await result(page).getByText('未配置（不是 0）',{exact:true}).count(),4);
      assert.equal(await result(page).getByText('无：各层均继承',{exact:true}).count(),4);
    });
    await run('fieldwise-zero-disabled-and-provenance',async page=>{
      await date(page).fill('2026-10-05');
      await choose(page,'enterprise','late','value','9');await choose(page,'group','late','value','0');
      await choose(page,'enterprise','early','value','8');await choose(page,'personal','early','disabled');
      await choose(page,'enterprise','open','value','720');await submit(page);await result(page).waitFor();
      assert.match(await article(page,'late').innerText(),/0 分钟/);assert.match(await article(page,'late').innerText(),/组假设：指定分钟数/);
      assert.doesNotMatch(await article(page,'late').innerText(),/企业假设：/);
      assert.match(await article(page,'early').innerText(),/明确停用（不是 0）/);
      assert.match(await article(page,'open').innerText(),/720 分钟/);assert.match(await article(page,'rest').innerText(),/未配置/);
      assert.match(await result(page).innerText(),/2026-10-04T22:00:00.000Z/);
    });
    await run('changing-any-input-clears-result',async page=>{
      await sample(page);await minutes(page,'enterprise','late').fill('8');await absent(page);await submit(page);await result(page).waitFor();
      await select(page,'group','early').selectOption('disabled');await absent(page);await submit(page);await result(page).waitFor();
      await date(page).fill('2026-10-06');await absent(page);
    });
    await run('blank-is-not-zero',async page=>{
      await date(page).fill('2026-10-05');await choose(page,'enterprise','late','value','');await submit(page);await absent(page);
      assert.match(await page.getByRole('alert').innerText(),/空白不等于 0/);
      await minutes(page,'enterprise','late').fill('0');await submit(page);await result(page).waitFor();assert.match(await article(page,'late').innerText(),/0 分钟/);
    });
    await run('invalid-minute-inputs-do-not-keep-result',async page=>{
      await sample(page);
      for(const value of ['-1','1.5','1e2','1441','NaN',' ']){
        await minutes(page,'enterprise','late').fill(value);await submit(page);await absent(page);assert.equal(await page.getByRole('alert').count(),1);
      }
    });
    await run('no-today-or-past-effective-date',async page=>{
      await sample(page);for(const value of ['2026-10-04','2026-10-03']){
        await date(page).fill(value);await submit(page);await absent(page);assert.match(await page.getByRole('alert').innerText(),/未来/);
      }
    });
    await run('hidden-clears-with-explicit-blank-restart',async page=>{
      await sample(page);await page.getByRole('button',{name:'隐藏验收文档',exact:true}).click();await absent(page);assert.equal(await draft(page).locator('form').count(),0);
      await page.getByRole('button',{name:'显示验收文档',exact:true}).click();assert.equal(await draft(page).locator('form').count(),0);
      await page.getByRole('button',{name:'重新开始空白草稿',exact:true}).click();assert.equal(await date(page).inputValue(),'');assert.equal(await select(page,'enterprise','late').inputValue(),'inherit');
    });
    await run('pagehide-synchronously-clears',async page=>{
      await sample(page);
      const cleared=await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide'));return !document.querySelector('[data-attendance-rule-preview-result]')&&!document.querySelector('[data-attendance-rules-preview] form');});
      assert.equal(cleared,true);await absent(page);
    });
    await run('timezone-change-does-not-reinterpret-old-draft',async page=>{
      await sample(page);await page.getByLabel('验收时区',{exact:true}).selectOption('America/Los_Angeles');await absent(page);
      assert.equal(await date(page).inputValue(),'');assert.equal(await select(page,'enterprise','late').inputValue(),'inherit');
      await sample(page);assert.match(await result(page).innerText(),/2026-10-05T07:00:00.000Z/);
    });
    await run('unmount-and-remount-remain-blank',async page=>{
      await sample(page);await page.getByRole('button',{name:'卸载验收草稿',exact:true}).click();assert.equal(await draft(page).count(),0);
      await page.getByRole('button',{name:'重挂验收草稿',exact:true}).click();await date(page).waitFor();await absent(page);assert.equal(await date(page).inputValue(),'');
    });
    await run('mobile-layout-and-explicit-clear',async page=>{
      await sample(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal_overflow');
      assert.equal(await select(page,'personal','rest').evaluate(element=>element.getBoundingClientRect().width>200),true);
      await page.getByRole('button',{name:'清空草稿与试算',exact:true}).click();await absent(page);assert.equal(await minutes(page,'enterprise','late').inputValue(),'');
    },390);
    await run('reload-does-not-restore-drafts',async page=>{
      await sample(page);await page.reload();await date(page).waitFor();await absent(page);assert.equal(await date(page).inputValue(),'');
    });
    assert.deepEqual(errors,[]);assert(requests.length>0);
    return {checks,apiRequests:0,browserStorageWrites:0,externalRequests:0,productionAccess:false,applicationIntegration:false};
  }finally{
    await runAttendanceCleanupSteps([
      {name:'draft-preview-browser',run:async()=>{await browser?.close();}},
      {name:'draft-preview-loopback',run:async()=>{if(server.listening){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}}},
    ]);
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  checkAttendanceRulesPreviewBrowser().then(result=>process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error=>{process.stderr.write(`${error.stack}\n`);process.exitCode=1;});
}
