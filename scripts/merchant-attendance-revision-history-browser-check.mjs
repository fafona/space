// Actual components, existing Chromium, loopback/in-memory only; no artifacts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--revision-history'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('harness_timeout')),15000);child.stdout.on('data',chunk=>{text+=String(chunk);if(text.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});child.stderr.on('data',chunk=>errors.push(String(chunk)));child.once('exit',code=>{clearTimeout(timer);reject(Error(`harness_exit_${code}`));});});
  browser=await chromium.launch({headless:true});
  const region=p=>p.getByRole('region',{name:'负责人修订待办与历史',exact:true});
  const run=async(name,fn,mobile=false)=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
    const p=await context.newPage();p.setDefaultTimeout(7000);p.on('pageerror',e=>errors.push(e.message));p.on('dialog',dialog=>dialog.accept());
    try{await p.goto(origin);await region(p).waitFor();await fn(p);checks++;console.log('PASS '+name);}finally{await context.close();}
  };
  const filter=async(p,status='submitted')=>{const r=region(p);await r.getByLabel('提交起始日（UTC）',{exact:true}).fill('2026-09-01');await r.getByLabel('提交截止日（UTC，含当天）',{exact:true}).fill('2026-09-30');await r.getByLabel('申请状态',{exact:true}).selectOption(status);await r.getByRole('button',{name:'查询修订列表'}).click();};
  const mode=(p,v)=>p.getByLabel('模拟列表场景').selectOption(v);
  const counts=async p=>{await p.getByRole('button',{name:'读取列表计数'}).click();return JSON.parse(await p.getByLabel('列表计数',{exact:true}).innerText());};
  const noOverflow=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await run('owner real entry lists pending and opens fresh detail with no automatic approval',async p=>{
    await filter(p);await region(p).getByRole('button',{name:'查看修订详情'}).click();await p.getByRole('form',{name:'确认修订审批'}).waitFor();assert.equal(await region(p).count(),0);
    const c=await counts(p);assert.equal(c.historyPosts,0);assert.equal(c.ownerPosts,0);assert(c.historyGets>=1);await noOverflow(p);
  });
  await run('owner approval returns to list with current terminal state, only one explicit POST',async p=>{
    await filter(p);await region(p).getByRole('button',{name:'查看修订详情'}).click();const f=p.getByRole('form',{name:'确认修订审批'});await f.waitFor();await f.getByLabel('修订审批决定',{exact:true}).selectOption('approve');await f.getByLabel('修订审批理由（单行 1—500 字，员工可见）',{exact:true}).fill('合成核对完成');await f.getByRole('checkbox').check();await f.getByRole('button',{name:'确认批准修订'}).click();await p.getByText('当前采用本次批准结果。',{exact:true}).waitFor();
    await p.getByRole('button',{name:'修订待办／已处理记录'}).click();await region(p).waitFor();await filter(p,'approved');await region(p).getByText('已批准',{exact:true}).filter({visible:true}).first().waitFor();await region(p).getByRole('button',{name:'查看修订详情'}).click();await p.getByRole('region',{name:'本次审批结果',exact:true}).waitFor();assert.equal(await f.count(),0);assert.equal((await counts(p)).ownerPosts,1);
  });
  await run('mobile sparse filtered page advances and does not falsely claim no matching history',async p=>{
    await mode(p,'sparse');await filter(p,'approved');await region(p).getByRole('status').filter({hasText:'仍有下一页'}).waitFor();assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),0);await noOverflow(p);
    await region(p).getByRole('button',{name:'下一页候选'}).click();await region(p).getByText(/第 2 页/).waitFor();assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),11);assert(await region(p).getByRole('button',{name:'下一页候选'}).isDisabled());await noOverflow(p);assert.equal((await counts(p)).historyPosts,0);
  },true);
  await run('owner permission loss on next page removes previous names and stops pagination',async p=>{
    await mode(p,'sparse');await filter(p,'all');await region(p).getByText(/本页扫描 50 个候选/).waitFor();assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),50);await mode(p,'denied');await region(p).getByRole('button',{name:'下一页候选'}).click();
    await region(p).getByRole('status').filter({hasText:'资料已隐藏'}).waitFor();assert.equal(await region(p).getByText('合成员工 · TEST-REVISION',{exact:true}).count(),0);assert(await region(p).getByRole('button',{name:'下一页候选'}).isDisabled());assert.equal((await counts(p)).ownerPosts,0);
  });
  await run('invalid oversized date range clears rows, does not query or silently fall back',async p=>{
    await filter(p);await region(p).getByRole('button',{name:'查看修订详情'}).waitFor();const before=(await counts(p)).historyGets;await region(p).getByLabel('提交截止日（UTC，含当天）',{exact:true}).fill('2026-11-01');await region(p).getByRole('button',{name:'查询修订列表'}).click();
    await region(p).getByRole('status').filter({hasText:'最多 31 个 UTC 日'}).waitFor();assert.equal((await counts(p)).historyGets,before);assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),0);
  });
  await run('employee actual workspace history opens own request detail, read-only path and mobile layout',async p=>{
    await p.getByLabel('验收身份').selectOption('self');await p.getByRole('button',{name:'本班次修订历史',exact:true}).click();const r=p.getByRole('region',{name:'本人班次修订历史',exact:true});await r.getByRole('button',{name:'查看修订详情'}).waitFor();assert.equal(await r.getByLabel('提交起始日（UTC）').count(),0);await noOverflow(p);
    await r.getByRole('button',{name:'查看修订详情'}).click();await p.getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();assert.equal((await counts(p)).selfPosts,0);assert.equal((await counts(p)).historyPosts,0);await noOverflow(p);
  },true);
  await run('paused lists remain readable and never expose a list-level approval button',async p=>{
    await mode(p,'paused');await filter(p,'all');await region(p).getByText('平台已暂停新增考勤；列表仍按当前权限只读，不能据此发起新审批。',{exact:true}).waitFor();assert.equal(await region(p).getByRole('form',{name:'确认修订审批'}).count(),0);assert.equal((await counts(p)).ownerPosts,0);
  });
  await run('failed transport is distinct from an empty page and refresh can recover',async p=>{
    await filter(p);await region(p).getByRole('button',{name:'查看修订详情'}).waitFor();await mode(p,'offline');await region(p).getByRole('button',{name:'刷新回首页'}).click();await region(p).getByRole('status').filter({hasText:'列表未能可靠读取'}).waitFor();assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),0);
    await mode(p,'normal');await region(p).getByRole('button',{name:'刷新回首页'}).click();await region(p).getByRole('button',{name:'查看修订详情'}).waitFor();assert.equal((await counts(p)).historyPosts,0);
  });
  await run('initial queue loads once and visibility refresh preserves applied range without parent detail probes',async p=>{
    await region(p).getByText(/当前查询：/).waitFor();assert.equal((await counts(p)).historyGets,1);assert.equal((await counts(p)).ownerGets,0);
    await filter(p,'all');await region(p).getByRole('button',{name:'查看修订详情'}).waitFor();const before=(await counts(p)).historyGets;
    await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
    await region(p).getByRole('status').filter({hasText:'列表已隐藏'}).waitFor();assert.equal(await region(p).getByRole('button',{name:'查看修订详情'}).count(),0);
    await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'));});
    await region(p).getByRole('button',{name:'查看修订详情'}).waitFor();assert.equal((await counts(p)).historyGets,before+1);assert.equal((await counts(p)).ownerGets,0);assert.match(await region(p).innerText(),/2026-09-01 至 2026-09-30/);
  });
  await run('uncertain approval blocks queue navigation and remount recovers detail before listing',async p=>{
    await filter(p);await region(p).getByRole('button',{name:'查看修订详情'}).click();const f=p.getByRole('form',{name:'确认修订审批'});await f.waitFor();await mode(p,'lost');
    await f.getByLabel('修订审批决定',{exact:true}).selectOption('approve');await f.getByLabel('修订审批理由（单行 1—500 字，员工可见）',{exact:true}).fill('合成丢回包恢复');await f.getByRole('checkbox').check();await f.getByRole('button',{name:'确认批准修订'}).click();await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();
    assert(await p.getByRole('button',{name:'修订待办／已处理记录'}).isDisabled());await p.getByRole('button',{name:'卸载列表验收'}).click();await mode(p,'normal');await p.getByRole('button',{name:'重新进入列表验收'}).click();
    await p.getByText('当前采用本次批准结果。',{exact:true}).waitFor();assert.equal(await region(p).count(),0);assert.equal((await counts(p)).ownerPosts,1);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks,passed:true,externalRequests:0,productionAccess:false,fullLogin:false,artifactsWritten:false}));
}finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
