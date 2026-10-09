// Actual component DOM in a fresh Chromium context. Synthetic transport only.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../",import.meta.url)),origin="http://127.0.0.1:3131";
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(3131,"127.0.0.1",resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,["scripts/attendance-self-browser-harness.mjs","--scoped-timesheet"],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
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
  const counts=async p=>{await p.getByRole("button",{name:"读取计数",exact:true}).click();return JSON.parse(await p.getByLabel("请求计数",{exact:true}).innerText());};
  const screen=p=>p.getByRole("region",{name:"受限周期工时核对",exact:true}),result=p=>p.getByRole("article",{name:"可见工时查询结果",exact:true});
  const mode=(p,v)=>p.getByLabel("模拟场景",{exact:true}).selectOption(v);
  const open=async(p,access="self")=>{await p.getByLabel("当前视角").selectOption(access);await p.getByLabel("开放受限报表").check();await p.getByRole("button",{name:access==="self"?"我的周期工时核对":"授权范围工时核对",exact:true}).click();
    await screen(p).getByText(/企业日期时区：/).waitFor();};
  const dates=async p=>{await screen(p).getByLabel("开始日期",{exact:true}).fill("2026-09-01");await screen(p).getByLabel("结束日期（含）",{exact:true}).fill("2026-09-30");};
  const choose=async(p,second=false)=>screen(p).getByRole("button",{name:second?/合成人员甲 · W-1/:/合成人员甲 · W-0/}).click();
  const query=p=>screen(p).getByRole("button",{name:"查询可见工时",exact:true}).click();
  await run("default-off self launcher, explicit read and visible subset/provenance disclosure",async p=>{
    assert.equal(await p.getByRole("button",{name:"我的周期工时核对",exact:true}).count(),0);assert.equal((await counts(p)).reads,0);
    await open(p);assert.equal((await counts(p)).reports,0);assert.equal(await screen(p).getByLabel("人员／工号／地点").count(),0);
    await dates(p);await query(p);await result(p).waitFor();assert((await result(p).innerText()).includes("−1 小时 0 分 0 秒"));
    await result(p).locator("summary").filter({hasText:"按日可见工作段"}).click();assert.equal(await result(p).locator("tbody").nth(1).locator("tr").count(),30);
    await result(p).locator("summary").filter({hasText:/^1\./}).click();await result(p).getByText(/批准申请：/).waitFor();
    assert((await screen(p).innerText()).includes("不是完整个人月报"));assert.equal((await counts(p)).writes,0);
  });
  await run("manager paired selection, same worker different site, dates and versioned paging",async p=>{
    await open(p,"manager");assert.equal(await screen(p).getByRole("button",{name:"查询可见工时",exact:true}).isDisabled(),true);
    await choose(p);await dates(p);await query(p);await result(p).waitFor();const n=(await counts(p)).reports;
    await choose(p,true);assert.equal(await result(p).count(),0);assert.equal((await counts(p)).reports,n);await query(p);await result(p).getByRole("heading",{name:/授权分店乙/}).waitFor();
    await screen(p).getByLabel("开始日期",{exact:true}).fill("2026-09-02");assert.equal(await result(p).count(),0);
    await screen(p).getByRole("button",{name:"组合下一页",exact:true}).click();await screen(p).getByRole("button",{name:/合成人员 25/}).waitFor();assert.equal(await screen(p).getByRole("button",{name:"查询可见工时",exact:true}).isDisabled(),true);
    await screen(p).getByLabel("人员／工号／地点").fill("不存在");await screen(p).getByRole("button",{name:"搜索授权组合",exact:true}).click();await screen(p).getByText(/没有匹配且当前获授权/).waitFor();
  });
  await run("revocation, changed scope and tampered totals clear names and report",async p=>{
    await open(p,"manager");
    for(const m of ["denied","revision","tampered","large"]){
      if(m!=="denied"){await mode(p,"normal");await screen(p).getByRole("button",{name:"重新读取当前权限与范围",exact:true}).click();await screen(p).getByRole("button",{name:/合成人员甲 · W-0/}).waitFor();}
      await choose(p);await dates(p);await query(p);await result(p).waitFor();await mode(p,m);await query(p);
      await screen(p).getByRole("status").filter({hasText:m==="denied"?"权限":m==="revision"?"授权已更新":m==="tampered"?"无法完整核对":"缩短日期"}).waitFor();
      assert.equal(await result(p).count(),0);assert.equal(await screen(p).getByRole("button",{name:/合成人员甲/}).count(),0);
    }
  });
  await run("hide/return drops late response without prefetch; self rebind errors clear identity",async p=>{
    await open(p);await dates(p);await mode(p,"held");await query(p);await p.getByRole("button",{name:"模拟后台",exact:true}).click();
    assert.equal(await result(p).count(),0);assert.equal(await screen(p).getByText(/合成员工本人/).count(),0);
    await p.getByRole("button",{name:"释放响应",exact:true}).click();await mode(p,"normal");const n=(await counts(p)).reports;
    await p.getByRole("button",{name:"模拟前台",exact:true}).click();await screen(p).getByText(/合成员工本人/).waitFor();assert.equal((await counts(p)).reports,n);
    await dates(p);await mode(p,"rebound");await query(p);await screen(p).getByRole("status").filter({hasText:"已换绑"}).waitFor();assert.equal(await result(p).count(),0);assert.equal(await screen(p).getByText(/合成员工本人/).count(),0);
  });
  await run("monotonic display and finite grant timers clear without requesting renewal",async p=>{
    await p.clock.install();await open(p,"manager");await choose(p);await dates(p);await query(p);await result(p).waitFor();const n=(await counts(p)).reads;
    await p.clock.fastForward(300001);await screen(p).getByRole("status").filter({hasText:"已到期"}).waitFor();assert.equal(await result(p).count(),0);assert.equal((await counts(p)).reads,n);
    await mode(p,"expiring");await screen(p).getByRole("button",{name:"重新读取当前权限与范围",exact:true}).click();await screen(p).getByRole("button",{name:/合成人员甲 · W-0/}).waitFor();const m=(await counts(p)).reads;
    await p.clock.fastForward(5001);await screen(p).getByRole("status").filter({hasText:"已到期"}).waitFor();assert.equal(await screen(p).getByRole("button",{name:/合成人员甲/}).count(),0);assert.equal((await counts(p)).reads,m);
  });
  await run("mobile open break, paused history, local overflow only and feature disable unmount",async p=>{
    await open(p);await dates(p);await mode(p,"open");await query(p);await result(p).getByText(/1 个可见班次尚未结束/).waitFor();
    await result(p).locator("summary").filter({hasText:/^1\./}).click();assert.equal(await result(p).getByText(/下班 UTC：尚未结束/).count(),2);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
    await mode(p,"paused");await query(p);await result(p).getByText(/新考勤已暂停/).waitFor();await result(p).locator("summary").filter({hasText:"按日可见工作段"}).click();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
    assert.equal(await p.evaluate(()=>Object.keys(localStorage).length+Object.keys(sessionStorage).length),0);assert.equal((await counts(p)).writes,0);
    await p.getByLabel("开放受限报表").uncheck();assert.equal(await screen(p).count(),0);
  },true);
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,passed:true,actualChromium:true,syntheticTransport:true,productionRequests:0,fullLoginPath:false}));
}finally{await browser?.close();if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}}
