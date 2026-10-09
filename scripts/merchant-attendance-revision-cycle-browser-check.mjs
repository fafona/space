// Only loopback, existing Chromium, synthetic transport and ephemeral contexts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--revision-cycle'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('harness_timeout')),15000);
    child.stdout.on('data',chunk=>{text+=String(chunk);if(text.includes('Attendance synthetic component QA')){clearTimeout(timer);resolve();}});
    child.stderr.on('data',chunk=>errors.push(String(chunk)));child.once('exit',code=>{clearTimeout(timer);reject(Error(`harness_exit_${code}`));});});
  browser=await chromium.launch({headless:true});
  const run=async(name,fn,mobile=false)=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block'});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
    const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(7000);p.on('dialog',dialog=>dialog.accept());
    try{await p.goto(origin);await p.getByRole('form',{name:'提交再次修订'}).waitFor();await fn(p);checks++;console.log(`PASS ${name}`);}finally{await context.close();}
  };
  const mode=(p,v)=>p.getByLabel('模拟修订场景').selectOption(v);
  const form=p=>p.getByRole('form',{name:'提交再次修订'});
  const choose=async p=>{await form(p).getByLabel('修订下班时间',{exact:true}).fill('2026-09-28T18:30');await form(p).getByLabel('修订理由（单行 1—500 字）',{exact:true}).fill('合成时间重新核对');await form(p).getByRole('checkbox',{name:/我已核对全部时间/}).check();};
  const submit=p=>form(p).getByRole('button',{name:'明确提交修订申请',exact:true}).click();
  const refresh=p=>p.getByRole('button',{name:'重新读取／查原收据',exact:true}).click();
  const counts=async p=>{await p.getByRole('button',{name:'读取修订计数',exact:true}).click();return JSON.parse(await p.getByLabel('修订计数',{exact:true}).innerText());};
  const noOverflow=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await run('desktop current source prefill, unchanged disabled, explicit consent and immutable current after submission',async p=>{
    assert.match(await form(p).getByLabel('修订下班时间',{exact:true}).inputValue(),/17:30/);assert(await form(p).getByRole('button',{name:'明确提交修订申请'}).isDisabled());assert.equal((await counts(p)).posts,0);
    await choose(p);await form(p).getByLabel('修订理由（单行 1—500 字）',{exact:true}).fill('变更理由重新确认');assert(!await form(p).getByRole('checkbox',{name:/我已核对全部时间/}).isChecked());
    await form(p).getByRole('checkbox',{name:/我已核对全部时间/}).check();await submit(p);await p.getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();
    assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 2/);assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).pending,false);await noOverflow(p);
  });
  await run('mobile paused pending withdrawal, responsive layout and new-submission gate',async p=>{
    await noOverflow(p);await choose(p);await submit(p);await p.getByRole('form',{name:'撤回待审修订'}).waitFor();await mode(p,'paused');await refresh(p);
    const w=p.getByRole('form',{name:'撤回待审修订'});await w.getByLabel('撤回理由',{exact:true}).fill('合成撤回');await w.getByRole('checkbox').check();await w.getByRole('button',{name:'明确撤回修订'}).click();
    await p.getByRole('heading',{name:'本次修订 · 已撤回',exact:true}).waitFor();assert.equal((await counts(p)).posts,2);await p.getByRole('button',{name:'返回当前核定／准备新申请'}).click();assert.equal(await form(p).count(),0);await noOverflow(p);
  },true);
  await run('lost submit response then approval recovers on remount using GET without duplicate writes',async p=>{
    await mode(p,'lost');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试'}).waitFor();assert.equal((await counts(p)).pending,true);
    await p.getByRole('button',{name:'模拟负责人批准'}).click();await p.getByRole('button',{name:'卸载修订页面'}).click();await mode(p,'normal');await p.getByRole('button',{name:'重新进入修订'}).click();
    await p.getByRole('heading',{name:'本次修订 · 已批准',exact:true}).waitFor();assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 3/);assert.match(await p.getByRole('region',{name:'提交时的核定基准',exact:true}).innerText(),/修订 2/);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).pending,false);assert.equal(await p.getByRole('form',{name:'撤回待审修订'}).count(),0);
  });
  await run('missing request only retries after explicit user action, preserving one original operation',async p=>{
    await mode(p,'missing');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试'}).waitFor();await refresh(p);assert.equal((await counts(p)).posts,1);
    await mode(p,'normal');await p.getByRole('button',{name:'明确按原编号重试'}).click();await p.getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();assert.equal((await counts(p)).posts,2);assert.equal((await counts(p)).pending,false);
  });
  await run('invalid local time blocks submission and refresh discards only the unsubmitted draft',async p=>{
    await choose(p);await form(p).getByLabel('修订上班时间',{exact:true}).fill('2026-03-29T02:30');assert(await form(p).getByRole('button',{name:'明确提交修订申请'}).isDisabled());assert.equal((await counts(p)).posts,0);
    await refresh(p);await form(p).waitFor();assert.equal(await form(p).getByLabel('修订理由（单行 1—500 字）',{exact:true}).inputValue(),'');assert.equal((await counts(p)).posts,0);
  });
  await run('rejection never changes current hours, then employee can explicitly prepare another request',async p=>{
    await choose(p);await submit(p);await p.getByRole('heading',{name:'本次修订 · 待负责人审批',exact:true}).waitFor();await p.getByRole('button',{name:'模拟负责人驳回'}).click();await refresh(p);
    await p.getByRole('heading',{name:'本次修订 · 已驳回',exact:true}).waitFor();assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 2/);assert.equal(await p.getByRole('form',{name:'撤回待审修订'}).count(),0);
    await p.getByRole('button',{name:'返回当前核定／准备新申请'}).click();await form(p).waitFor();assert.equal((await counts(p)).posts,1);
  },true);
  await run('permission loss hides sources and retains uncertain operation without another POST',async p=>{
    await mode(p,'lost');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试'}).waitFor();await mode(p,'denied');await refresh(p);
    await p.getByRole('status').filter({hasText:'没有本人修订访问权限'}).waitFor();assert.equal(await p.getByRole('region',{name:'当前有效核定',exact:true}).count(),0);assert.equal((await counts(p)).pending,true);assert.equal((await counts(p)).posts,1);assert(await p.getByRole('button',{name:'明确按原编号重试'}).isDisabled());
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks,passed:true,externalRequests:0,productionAccess:false,artifactsWritten:false}));
}finally{
  await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
}
