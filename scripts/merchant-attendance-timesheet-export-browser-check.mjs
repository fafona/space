// Real downloads from the actual React export widget, synthetic transport only.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--timesheet-export'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('harness_start_timeout')),15000);
    child.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
    child.stderr.on('data',chunk=>errors.push(String(chunk)));child.once('exit',code=>{clearTimeout(timer);reject(Error(`harness_exited_${code}`));});});
  browser=await chromium.launch({headless:true});
  const run=async(name,fn,mobile=false)=>{
    const context=await browser.newContext({acceptDownloads:true,viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);const downloads=[];page.on('download',d=>downloads.push(d));
    try{await page.goto(origin);await fn(page,downloads);checks++;console.log('PASS '+name);}finally{for(const d of downloads)await d.delete();await context.close();}
  };
  const section=p=>p.getByRole('region',{name:'受控工时导出',exact:true});
  const ack=p=>section(p).getByRole('checkbox');
  const button=p=>section(p).getByRole('button');
  const mode=(p,v)=>p.getByLabel('模拟场景').selectOption(v);
  const open=p=>p.getByLabel('开放导出').check();
  const counts=async p=>{await p.getByRole('button',{name:'读取计数',exact:true}).click();return JSON.parse(await p.getByLabel('请求计数').innerText());};
  const download=async p=>{await ack(p).check();const waiting=p.waitForEvent('download');await button(p).click();const d=await waiting;assert.match(d.suggestedFilename(),/^attendance-99990009-2026-09-01-2026-09-30-[a-f0-9-]+\.csv$/);
    const stream=await d.createReadStream(),parts=[];for await(const part of stream)parts.push(part);const bytes=Buffer.concat(parts);assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);
    const csv=bytes.toString('utf8');assert(csv.includes('来源读取SHA256'));assert(csv.includes('28800000000'));assert(!csv.includes('viewerEmployeeId'));assert.equal(await d.failure(),null);
    await section(p).getByRole('status').filter({hasText:'已请求浏览器下载'}).waitFor();assert.equal(await ack(p).isChecked(),false);return csv;
  };
  await run('default-off no request; explicit consent, actual owner CSV download, new operation for deliberate repeat',async(p,downloads)=>{
    assert.equal(await section(p).count(),0);assert.equal((await counts(p)).calls,0);await open(p);assert.equal(await button(p).isDisabled(),true);
    const first=await download(p);assert(first.includes('当前负责人可见班次'));await download(p);assert.equal(downloads.length,2);
    const c=await counts(p);assert.equal(c.calls,2);assert.equal(new Set(c.ids).size,2);
  });
  await run('self and manager actual CSV have constrained scope labels and no account-binding identifiers',async(p,downloads)=>{
    await open(p);for(const access of ['self','manager']){await p.getByLabel('当前视角').selectOption(access);const csv=await download(p);assert(csv.includes('非个人完整月报'));assert(!csv.includes('00000000-0000-4000-8000-000000000002'));}
    assert.equal(downloads.length,2);
  });
  await run('lost response and receipt replay never silently retry or download stale contents',async(p,downloads)=>{
    await open(p);await mode(p,'lost');await ack(p).check();await button(p).click();await section(p).getByRole('status').filter({hasText:'服务器可能已有来源读取记录'}).waitFor();
    assert.equal((await counts(p)).calls,1);assert.equal(downloads.length,0);await mode(p,'replay');await ack(p).check();await button(p).click();
    await section(p).getByRole('status').filter({hasText:'不重复下载'}).waitFor();assert.equal(downloads.length,0);assert.equal((await counts(p)).calls,2);
  });
  await run('hide, changed query, feature disable and unmount discard held responses without downloads',async(p,downloads)=>{
    await open(p);await mode(p,'held');
    for(const action of ['模拟后台','切换查询结果','切换挂载','disable']){
      await ack(p).check();await button(p).click();await section(p).getByRole('status').filter({hasText:'正在重新核验'}).waitFor();
      if(action==='disable')await p.getByLabel('开放导出').uncheck();else await p.getByRole('button',{name:action,exact:true}).click();
      await p.getByRole('button',{name:'释放响应',exact:true}).click();
      if(action==='模拟后台')await p.getByRole('button',{name:'模拟前台',exact:true}).click();
      if(action==='切换挂载')await p.getByRole('button',{name:'切换挂载',exact:true}).click();if(action==='disable')await open(p);
      await counts(p);assert.equal(downloads.length,0);assert.equal(await ack(p).isChecked(),false);
    }
    assert.equal((await counts(p)).calls,4);
  });
  await run('revoked export and expired manager grant clear caller result, no download',async(p,downloads)=>{
    await open(p);await p.getByLabel('当前视角').selectOption('manager');
    for(const m of ['denied','expired']){await mode(p,m);await ack(p).check();await button(p).click();await section(p).waitFor({state:'detached'});assert.equal(downloads.length,0);
      if(m==='denied')await p.getByRole('button',{name:'切换挂载',exact:true}).click();}
    assert.equal((await counts(p)).denials,2);
  });
  await run('mobile export layout and memory-only state; closing leaves no persistent report',async p=>{
    await open(p);await download(p);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await p.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);
    await p.getByRole('button',{name:'切换挂载',exact:true}).click();assert.equal(await section(p).count(),0);
  },true);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks,passed:true,actualChromium:true,actualDownloads:true,productionRequests:0,retainedCsvFiles:0,fullLoginPath:false}));
}finally{await browser?.close();if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}}
