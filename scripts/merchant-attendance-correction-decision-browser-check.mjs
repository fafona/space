// Existing local Chromium only; isolated contexts, synthetic transport, no production requests.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../",import.meta.url)),origin="http://127.0.0.1:3131";
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(3131,"127.0.0.1",resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,["scripts/attendance-self-browser-harness.mjs","--correction-decision"],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
let browser,checks=0;const errors=[],external=[];
try{
  await new Promise((resolve,reject)=>{let output="";const timer=setTimeout(()=>reject(Error("harness_start_timeout")),15000);
    child.stdout.on("data",chunk=>{output+=String(chunk);if(output.includes("Attendance synthetic component QA")){clearTimeout(timer);resolve();}});
    child.stderr.on("data",chunk=>errors.push(String(chunk)));child.once("exit",code=>{clearTimeout(timer);reject(Error(`harness_exited_${code}`));});});
  browser=await chromium.launch({headless:true});
  const run=async(name,fn,mobile=false)=>{
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:960},isMobile:mobile,hasTouch:mobile,serviceWorkers:"block"});
    await context.route("**/*",route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(7000);
    try{await page.goto(origin);await fn(page);checks++;console.log(`PASS ${name}`);}finally{await context.close();}
  };
  const mode=(p,value)=>p.getByLabel("模拟审批场景").selectOption(value);
  const counts=async p=>{await p.getByRole("button",{name:"读取审批计数",exact:true}).click();return JSON.parse(await p.getByLabel("审批计数",{exact:true}).innerText());};
  const open=async p=>{
    await p.getByLabel("提交开始日期",{exact:true}).fill("2026-09-30");await p.getByLabel("提交结束日期（含）",{exact:true}).fill("2026-09-30");
    await p.getByRole("button",{name:"查询申请",exact:true}).click();await p.getByRole("button",{name:"核对差异与冲突",exact:true}).click();
    await p.getByRole("button",{name:"进入本申请审批",exact:true}).click();await p.getByRole("form",{name:"确认补正决定"}).waitFor();
  };
  const form=p=>p.getByRole("form",{name:"确认补正决定"});
  const choose=async(p,action="approve")=>{await form(p).getByLabel("选择决定",{exact:true}).selectOption(action);await form(p).getByRole("textbox",{name:/^决定理由/}).fill("已核对合成记录");await form(p).getByRole("checkbox").check();};
  const submit=p=>form(p).getByRole("button",{name:/确认批准|确认驳回/}).click();
  const confirmed=p=>p.getByRole("heading",{name:/已批准 · 独立核定修订/}).waitFor();
  await run("desktop explicit approval, consent reset, terminal state and updated readonly detail",async p=>{
    await open(p);assert.equal((await counts(p)).posts,0);assert.equal(await form(p).getByLabel("选择决定",{exact:true}).inputValue(),"");
    await choose(p);await form(p).getByRole("textbox",{name:/^决定理由/}).fill("重新核对的理由");assert.equal(await form(p).getByRole("checkbox").isChecked(),false);
    assert.equal(await form(p).getByRole("button",{name:"确认批准",exact:true}).isDisabled(),true);await form(p).getByRole("checkbox").check();await submit(p);await confirmed(p);
    assert.deepEqual(await counts(p),{reads:1,posts:1,writes:1});assert.equal(await form(p).count(),0);
    await p.getByRole("button",{name:"返回核对列表",exact:true}).click();await confirmed(p);
  });
  await run("lost response reentry recovers only via GET and never repeats approval",async p=>{
    await open(p);await mode(p,"lost");await choose(p);await submit(p);await p.getByText("先处理本标签页待确认审批，不能换目标或发起新决定。",{exact:true}).waitFor();
    await mode(p,"normal");await p.getByRole("button",{name:"重新进入界面",exact:true}).click();await p.getByRole("button",{name:"审批操作／恢复待确认",exact:true}).click();await confirmed(p);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).writes,1);
  });
  await run("unsent operation requires explicit original-number retry",async p=>{
    await open(p);await mode(p,"unsent");await choose(p);await submit(p);await p.getByText("先处理本标签页待确认审批，不能换目标或发起新决定。",{exact:true}).waitFor();
    await mode(p,"normal");await p.getByRole("button",{name:"重新核对／查原收据",exact:true}).click();assert.equal((await counts(p)).posts,1);
    await p.getByRole("button",{name:"先查收据，再用原编号重试",exact:true}).click();await confirmed(p);assert.equal((await counts(p)).posts,2);assert.equal((await counts(p)).writes,1);
  });
  await run("mobile legacy may reject, cannot approve, no horizontal overflow",async p=>{
    await mode(p,"legacy");await open(p);assert.equal(await form(p).locator('option[value="approve"]').evaluate(el=>el.disabled),true,await p.locator("main").innerText());
    await choose(p,"reject");await submit(p);await p.getByRole("heading",{name:/已驳回 · 原申请保留/}).waitFor();assert.equal((await counts(p)).writes,1);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
  },true);
  await run("dirty draft cancellation preserves edits; confirmed leave sends no decision",async p=>{
    await open(p);await choose(p);p.once("dialog",d=>d.dismiss());await p.getByRole("button",{name:"返回核对列表",exact:true}).click();
    assert.equal(await form(p).getByRole("textbox",{name:/^决定理由/}).inputValue(),"已核对合成记录");
    p.once("dialog",d=>d.accept());await p.getByRole("button",{name:"返回核对列表",exact:true}).click();await p.getByRole("button",{name:"进入本申请审批",exact:true}).waitFor();
    assert.equal((await counts(p)).posts,0);
  });
  await run("policy/evidence change blocks first command and requires fresh confirmation",async p=>{
    await open(p);await choose(p);await mode(p,"changed");await submit(p);await p.getByRole("status").filter({hasText:"核对条件已经变化"}).waitFor();
    assert.equal((await counts(p)).writes,0);await mode(p,"normal");await p.getByRole("button",{name:"重新核对／查原收据",exact:true}).click();
    await form(p).waitFor();assert.equal(await form(p).getByRole("checkbox").isChecked(),false);assert.equal(await form(p).getByLabel("选择决定",{exact:true}).inputValue(),"");
  });
  await run("desktop immutable decision and later current version are distinct, with no extra approval",async p=>{
    await open(p);await choose(p);await submit(p);await confirmed(p);await mode(p,"revised");await p.getByRole("button",{name:"重新核对／查原收据",exact:true}).click();
    const history=p.getByRole("article",{name:"本次审批结果",exact:true}),current=p.getByRole("article",{name:"当前有效工时",exact:true});
    await current.getByText(/当前核定 · 修订 6/).waitFor();assert.match(await history.innerText(),/修订 1/);assert.match(await history.innerText(),/8 小时 30 分/);assert.match(await current.innerText(),/7 小时 0 分/);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).writes,1);assert.equal(await form(p).count(),0);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
  });
  await run("mobile rejected request can show another current source without changing its outcome",async p=>{
    await open(p);await choose(p,"reject");await submit(p);await p.getByRole("heading",{name:/已驳回 · 原申请保留/}).waitFor();
    await mode(p,"other_root");await p.getByRole("button",{name:"重新核对／查原收据",exact:true}).click();
    const history=p.getByRole("article",{name:"本次审批结果",exact:true}),current=p.getByRole("article",{name:"当前有效工时",exact:true});
    await current.getByText("当前工时来自该班次的另一份获批申请，并非本次申请。",{exact:true}).waitFor();assert.match(await history.innerText(),/已驳回，没有产生核定工时/);
    const h=await history.boundingBox(),c=await current.boundingBox();assert(h&&c&&c.y>=h.y+h.height);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).writes,1);
  },true);
  await run("lost original response recovers with a later current revision without submitting again",async p=>{
    await open(p);await mode(p,"lost");await choose(p);await submit(p);await p.getByText("先处理本标签页待确认审批，不能换目标或发起新决定。",{exact:true}).waitFor();
    await mode(p,"revised");await p.getByRole("button",{name:"重新进入界面",exact:true}).click();await p.getByRole("button",{name:"审批操作／恢复待确认",exact:true}).click();
    await p.getByRole("article",{name:"当前有效工时",exact:true}).getByText(/当前核定 · 修订 6/).waitFor();
    assert.equal((await counts(p)).posts,1);assert.equal((await counts(p)).writes,1);assert.equal(await p.getByText("先处理本标签页待确认审批，不能换目标或发起新决定。",{exact:true}).count(),0);
  });
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checks,passed:true,actualChromium:true,syntheticTransport:true,productionRequests:0,fullLoginPath:false}));
}finally{
  await browser?.close();if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}
}
