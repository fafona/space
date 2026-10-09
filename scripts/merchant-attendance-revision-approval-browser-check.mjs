// Existing Chromium, loopback-only in-memory harness; no screenshots/build artifacts.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='http://127.0.0.1:3131';
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(3131,'127.0.0.1',resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,['scripts/attendance-self-browser-harness.mjs','--revision-approval'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
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
    try{await p.goto(origin);await p.getByRole('form',{name:'确认修订审批'}).waitFor();await fn(p);checks++;console.log(`PASS ${name}`);}finally{await context.close();}
  };
  const mode=(p,v)=>p.getByLabel('模拟连续审批场景').selectOption(v),form=p=>p.getByRole('form',{name:'确认修订审批'});
  const choose=async(p,action='approve')=>{await form(p).getByLabel('修订审批决定',{exact:true}).selectOption(action);await form(p).getByLabel('修订审批理由（单行 1—500 字，员工可见）',{exact:true}).fill('合成核对确认');await form(p).getByRole('checkbox').check();};
  const submit=(p,action='批准')=>form(p).getByRole('button',{name:`确认${action}修订`,exact:true}).click(),refresh=p=>p.getByRole('button',{name:'重新核对／查原收据',exact:true}).click();
  const counts=async p=>{await p.getByRole('button',{name:'读取连续审批计数'}).click();return JSON.parse(await p.getByLabel('连续审批计数',{exact:true}).innerText());};
  const noOverflow=async p=>assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await run('desktop explicit choice/reason/ack, acknowledgement resets and raw/captured/current separation',async p=>{
    assert.equal(await form(p).getByLabel('修订审批决定',{exact:true}).inputValue(),'');assert(await form(p).getByRole('button').isDisabled());assert.equal((await counts(p)).posts,0);
    await choose(p);await form(p).getByLabel('修订审批理由（单行 1—500 字，员工可见）',{exact:true}).fill('修改后重新核对');assert(!await form(p).getByRole('checkbox').isChecked());await form(p).getByRole('checkbox').check();
    await submit(p);await p.getByText('当前采用本次批准结果。',{exact:true}).waitFor();assert.equal(await form(p).count(),0);assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 3/);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).pending,false);await noOverflow(p);
  });
  await run('mobile approval blocker permits explicit reject, preserving current source and responsive layout',async p=>{
    await mode(p,'blocked');await refresh(p);await p.getByText('当前不能批准；仍可说明理由后明确驳回，不产生新核定工时。',{exact:true}).waitFor();assert.equal(await form(p).getByRole('option',{name:'批准为下一版核定'}).evaluate(option=>option.disabled),true);await choose(p,'reject');await submit(p,'驳回');
    await p.getByText('已驳回，不产生新核定',{exact:true}).waitFor();assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 2/);assert.equal((await counts(p)).posts,1);await noOverflow(p);
  },true);
  await run('lost reply remount uses GET; later revision stays distinct from original decision',async p=>{
    await mode(p,'lost');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();assert.equal((await counts(p)).pending,true);
    await p.getByRole('button',{name:'卸载连续审批'}).click();await mode(p,'advanced');await p.getByRole('button',{name:'重新进入连续审批'}).click();
    await p.getByText('已有后续批准替换当前工时，本次历史结果保留。',{exact:true}).waitFor();assert.match(await p.getByRole('region',{name:'本次审批结果',exact:true}).innerText(),/修订 3/);assert.match(await p.getByRole('region',{name:'当前有效核定',exact:true}).innerText(),/修订 4/);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).pending,false);
  });
  await run('missing receipt only resends after explicit action and targets cannot change while pending',async p=>{
    await mode(p,'unsent');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();assert(await p.getByLabel('修订申请编号',{exact:true}).isDisabled());await refresh(p);assert.equal((await counts(p)).posts,1);
    await mode(p,'normal');await p.getByRole('button',{name:'明确按原编号重试审批'}).click();await p.getByText('当前采用本次批准结果。',{exact:true}).waitFor();assert.equal((await counts(p)).posts,2);assert.equal((await counts(p)).writes,1);
  });
  await run('paused mode allows committed receipt recovery without new POST',async p=>{
    await mode(p,'lost');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();await mode(p,'paused');await refresh(p);
    await p.getByText('平台暂停新审批，只核对历史和恢复既有收据。',{exact:true}).waitFor();assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).pending,false);assert.equal(await form(p).count(),0);
  });
  await run('permission loss hides private result but retains original uncertain operation',async p=>{
    await mode(p,'lost');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();await mode(p,'denied');await refresh(p);
    await p.getByRole('status').filter({hasText:'不是此企业的有效负责人'}).waitFor();assert.equal(await p.getByRole('region',{name:'当前有效核定',exact:true}).count(),0);assert.equal((await counts(p)).pending,true);assert.equal((await counts(p)).posts,1);
  });
  await run('withdrawn request fences undelivered command without claiming success',async p=>{
    await mode(p,'unsent');await choose(p);await submit(p);await p.getByRole('button',{name:'明确按原编号重试审批'}).waitFor();await mode(p,'withdrawn');await refresh(p);
    await p.getByRole('status').filter({hasText:'未确认本次审批成功'}).waitFor();assert.equal((await counts(p)).pending,false);assert.equal((await counts(p)).posts,1);assert.equal(await form(p).count(),0);await noOverflow(p);
  },true);
  await run('explicit refresh clears only unsubmitted draft, never sends approval',async p=>{
    await choose(p);await refresh(p);await p.waitForFunction(()=>document.querySelector('select[aria-label="修订审批决定"]')?.value==='');assert.equal(await form(p).getByLabel('修订审批决定',{exact:true}).inputValue(),'');assert.equal(await form(p).getByLabel('修订审批理由（单行 1—500 字，员工可见）',{exact:true}).inputValue(),'');assert.equal((await counts(p)).posts,0);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({checks,passed:true,externalRequests:0,productionAccess:false,artifactsWritten:false}));
}finally{await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
