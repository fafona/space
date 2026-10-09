// Actual component DOM in a fresh Chromium context. Synthetic transport only.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {fileURLToPath} from "node:url";
import {chromium} from "playwright";
const root=fileURLToPath(new URL("../",import.meta.url)),origin="http://127.0.0.1:3131";
const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(3131,"127.0.0.1",resolve);});await new Promise(resolve=>probe.close(resolve));
const child=spawn(process.execPath,["scripts/attendance-self-browser-harness.mjs","--timesheet"],{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
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
  const counts=async p=>{await p.getByRole("button",{name:"读取查询计数",exact:true}).click();return JSON.parse(await p.getByLabel("查询计数",{exact:true}).innerText());};
  const screen=p=>p.getByRole("region",{name:"周期工时核对",exact:true});
  const result=p=>p.getByRole("article",{name:"工时查询结果",exact:true});
  const mode=(p,v)=>p.getByLabel("模拟报表场景").selectOption(v);
  const open=async p=>{await p.getByLabel("开放候选工时报表").check();await p.getByRole("button",{name:"周期工时核对（只读）",exact:true}).click();await screen(p).getByRole("button",{name:/^合成人员甲/}).waitFor();};
  const dates=async p=>{await screen(p).getByLabel("开始日期",{exact:true}).fill("2026-09-01");await screen(p).getByLabel("结束日期（含）",{exact:true}).fill("2026-09-30");};
  const select=async(p,name=/^合成人员甲/)=>screen(p).getByRole("button",{name}).click();
  const query=async p=>{await screen(p).getByRole("button",{name:"查询工时",exact:true}).click();};
  await run("gated actual admin entry, explicit query, negative difference, source and daily disclosure",async p=>{
    assert.equal(await p.getByRole("button",{name:"周期工时核对（只读）",exact:true}).count(),0);assert.equal((await counts(p)).reports,0);
    await open(p);assert.equal((await counts(p)).reports,0);await select(p);await dates(p);await query(p);await result(p).waitFor();
    assert((await result(p).innerText()).includes("−1 小时 0 分 0 秒"));
    await result(p).locator("summary").filter({hasText:"按日明细"}).click();assert.equal(await result(p).getByRole("region",{name:"每日工作段明细"}).locator("tbody tr").count(),30);
    await result(p).locator("summary").filter({hasText:/^1\./}).click();await result(p).getByText(/批准申请：/).waitFor();
    assert.equal((await counts(p)).writes,0);assert.equal((await counts(p)).reports,1);
  });
  await run("date and person changes clear rendered result, inactive/unbound history and paging",async p=>{
    await open(p);await select(p);await dates(p);await query(p);await result(p).waitFor();
    await screen(p).getByLabel("开始日期",{exact:true}).fill("2026-09-02");assert.equal(await result(p).count(),0);assert.equal((await counts(p)).reports,1);
    await query(p);await result(p).waitFor();await select(p,/^停用人员乙/);assert.equal(await result(p).count(),0);await query(p);await result(p).getByText(/当前未绑定员工账号/).waitFor();await result(p).getByText(/此区间没有相关班次/).waitFor();
    await screen(p).getByRole("button",{name:"人员下一页",exact:true}).click();assert.equal(await result(p).count(),0);await screen(p).getByRole("button",{name:/^合成人员 26/}).waitFor();assert.equal(await screen(p).getByRole("button",{name:"人员下一页",exact:true}).isDisabled(),true);
  });
  await run("permission loss, excessive rows and wrong totals leave no previous report",async p=>{
    for(const m of ["denied","large","tampered"]){
      if(m==="denied")await open(p);else{await mode(p,"normal");await screen(p).getByRole("button",{name:"重新读取设置与人员",exact:true}).click();await screen(p).getByRole("button",{name:/^合成人员甲/}).waitFor();}
      await select(p);await dates(p);await query(p);await result(p).waitFor();await mode(p,m);await query(p);
      await screen(p).getByRole("status").filter({hasText:m==="denied"?"权限":m==="large"?"缩短日期":"无法完整核对"}).waitFor();assert.equal(await result(p).count(),0);assert.equal(await screen(p).getByRole("button",{name:/^合成人员甲/}).count(),0);
    }
  });
  await run("hidden view aborts delayed read, clears names, then reauthenticates without report prefetch",async p=>{
    await open(p);await select(p);await dates(p);await mode(p,"held");await query(p);await p.getByRole("button",{name:"模拟切到后台",exact:true}).click();
    assert.equal(await result(p).count(),0);assert.equal(await screen(p).getByRole("button",{name:/^合成人员甲/}).count(),0);
    await p.getByRole("button",{name:"释放延迟响应",exact:true}).click();await mode(p,"normal");const count=(await counts(p)).reports;
    await p.getByRole("button",{name:"模拟返回前台",exact:true}).click();await screen(p).getByRole("button",{name:/^合成人员甲/}).waitFor();assert.equal(await result(p).count(),0);assert.equal((await counts(p)).reports,count);assert.equal(await screen(p).getByRole("button",{name:"查询工时",exact:true}).isDisabled(),true);
  });
  await run("mobile open break and paused history, scroll-contained tables and zero writes",async p=>{
    await open(p);await select(p);await dates(p);await mode(p,"open");await query(p);await result(p).getByText(/1 个班次尚未结束/).waitFor();
    await result(p).locator("summary").filter({hasText:/^1\./}).click();assert.equal(await result(p).getByText("下班 UTC：尚未结束，不推算",{exact:false}).count(),2);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);
    await mode(p,"paused");await query(p);await result(p).getByText("新考勤已暂停，本次只读核对既有记录。",{exact:true}).waitFor();
    await result(p).locator("summary").filter({hasText:"按日明细"}).click();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);assert.equal((await counts(p)).writes,0);
    assert.equal(await p.evaluate(()=>Object.keys(localStorage).length),0);assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).length),0);
  },true);
  await run("disabling candidate unmounts report and restores existing admin",async p=>{
    await open(p);await select(p);await dates(p);await query(p);await result(p).waitFor();await p.getByLabel("开放候选工时报表").uncheck();assert.equal(await result(p).count(),0);await p.getByRole("heading",{name:"员工考勤配置",exact:true}).waitFor();
  });
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,passed:true,actualChromium:true,syntheticTransport:true,productionRequests:0,fullLoginPath:false}));
}finally{await browser?.close();if(child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}}
