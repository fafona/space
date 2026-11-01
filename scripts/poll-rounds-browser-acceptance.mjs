import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const firstId = "TP9999999926110101", secondId = "TP9999999926110102", oldId = "TP9999999926100101";
const initial = { pollId: firstId, heading: "第一轮", pollNameLabel: "昵称", pollStatus: "open", pollQuestions: [{ id: "q", prompt: "时间选择", type: "single", options: [{ id: "a", label: "上午" }, { id: "b", label: "下午" }] }] };
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}#root{max-width:1000px;margin:auto;padding:12px;box-sizing:border-box}section{margin:8px 0}input,select,textarea{max-width:100%;box-sizing:border-box}button{padding:6px;margin:3px}.grid{display:grid;gap:10px}.flex{display:flex;flex-wrap:wrap;gap:8px}label{min-width:0}p{overflow-wrap:anywhere}</style></head><body><div id="root"></div></body></html>';

async function bundle() {
  return (await build({ stdin: { contents: `
    import React,{useRef,useState} from 'react';import{createRoot}from'react-dom/client';
    import Editor from './src/components/admin/PollBlockEditor';
    import PollBlock from './src/components/blocks/PollBlock';
    import {BufferedEditorInput} from './src/components/admin/BufferedEditorControls';
    function App(){const[site,setSite]=useState('99999999');const[props,setProps]=useState(()=>JSON.parse(localStorage.getItem('poll-fixture')||'null')||${JSON.stringify(initial)});
      const pending=useRef({}),frame=useRef(null);
      const flush=()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;
        const patch=pending.current;pending.current={};if(!Object.keys(patch).length)return;
        setProps(current=>{const next={...current,...patch};localStorage.setItem('poll-fixture',JSON.stringify(next));return next})};
      const change=patch=>{pending.current={...pending.current,...patch};if(frame.current===null)frame.current=requestAnimationFrame(flush)};
      window.__pollProps=props;
      return <><button onClick={()=>setSite('88888888')}>切换测试商户</button>
      <BufferedEditorInput key={site+'/'+props.pollId} aria-label='投票标题' value={props.heading||''} onChange={event=>change({heading:event.currentTarget.value})}/>
      <Editor key={site} props={props} runtimeSiteId={site} runtimeBlockId='block-one' onChange={change} onFlushPendingChanges={flush}/>
      <div data-testid='runtime-preview'><PollBlock {...props} runtimeSiteId={site} runtimeBlockId='block-one' interactive={false}/></div></>}
    createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: process.cwd() },
    bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent", define: { "process.env": "{}" },
    plugins: [{ name: "synthetic-auth-only", setup(b) {
      b.onResolve({ filter: /^@\/lib\/authSessionRecovery$/ }, args => ({ path: args.path, namespace: "synthetic" }));
      b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "export const resolveFrontendAuthPayload=async()=>({authenticated:false});", loader: "js" }));
    } }],
  })).outputFiles[0].text;
}

async function fixture(browser, script, { mobile = false, handle = () => false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  const page = await context.newPage(), errors = [], unexpected = [];
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "https://poll-audit.invalid") {
      if (request.isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      if (await handle(route, request, url)) return;
      if (url.pathname === "/api/polls" && request.method() === "POST" && request.postDataJSON().action === "allocate_poll_id") {
        return route.fulfill({ json: { ok: true, pollId: secondId } });
      }
    }
    unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  await page.goto("https://poll-audit.invalid/admin");
  await page.addScriptTag({ content: script });
  await page.getByRole("combobox", { name: "选择投票轮次" }).waitFor();
  return { context, page, errors, unexpected };
}

test("actual desktop/mobile poll editor preserves buffered drafts, switches rounds, persists deletion and restores", { timeout: 90_000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    for (const mobile of [false, true]) {
      const { context, page, errors, unexpected } = await fixture(browser, script, { mobile });
      page.on("dialog", dialog => dialog.accept());
      await page.getByRole("textbox", { name: "投票标题" }).fill("第一轮刚输入的标题");
      await page.getByRole("button", { name: "新建一轮", exact: true }).click();
      await page.waitForFunction(id => window.__pollProps.pollId === id, secondId);
      assert.equal(await page.getByRole("combobox", { name: "选择投票轮次" }).locator("option").count(), 2);
      assert.equal(await page.evaluate(() => window.__pollProps.pollRoundHistory[0].settings.heading), "第一轮刚输入的标题");
      await page.getByRole("textbox", { name: "投票标题" }).fill("第二轮刚输入的标题");
      await page.getByRole("combobox", { name: "选择投票轮次" }).selectOption(firstId);
      assert.equal(await page.getByRole("textbox", { name: "投票标题" }).inputValue(), "第一轮刚输入的标题");
      await page.getByRole("combobox", { name: "选择投票轮次" }).selectOption(secondId);
      assert.equal(await page.getByRole("textbox", { name: "投票标题" }).inputValue(), "第二轮刚输入的标题");
      await page.getByRole("button", { name: "删除本轮", exact: true }).click();
      await page.getByText(/本轮投票已删除。/).waitFor();
      assert.equal(await page.getByTestId("runtime-preview").innerText(), "", "deleted poll must not be rendered publicly");
      assert.equal(await page.evaluate(() => window.__pollProps.pollId), secondId, "must not silently reopen the first round");
      await page.reload(); await page.addScriptTag({ content: script });
      await page.getByText(/本轮投票已删除。/).waitFor();
      await page.locator("summary").filter({ hasText: "已删除" }).click();
      await page.getByRole("button", { name: "恢复", exact: true }).click();
      await page.getByRole("combobox", { name: "投票状态", exact: true }).waitFor();
      assert.ok((await page.getByTestId("runtime-preview").innerText()).includes("时间选择"));
      assert.equal(await page.getByRole("textbox", { name: "投票标题" }).inputValue(), "第二轮刚输入的标题");
      assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("cancelled actions and failed allocation never alter the round or history", { timeout: 60_000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, unexpected } = await fixture(browser, script, { handle: async (route, request, url) => {
      if (url.pathname === "/api/polls" && request.method() === "POST") {
        await route.fulfill({ status: 503, json: { error: "synthetic-allocation-failed" } }); return true;
      } return false;
    } });
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "新建一轮", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__pollProps), initial);
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "删除本轮", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__pollProps), initial);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "新建一轮", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "synthetic-allocation-failed" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__pollProps), initial);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  } finally { await browser.close(); }
});

test("legacy selector is block-scoped, defaults recovered polls closed and does not resurrect deleted ones", { timeout: 60_000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    const { context, page, errors, unexpected } = await fixture(browser, script, { handle: async (route, request, url) => {
      if (url.pathname !== "/api/polls" || request.method() !== "GET") return false;
      if (url.searchParams.get("pollId") === oldId) {
        await route.fulfill({ json: { ok: true, pollId: oldId, ballots: [{ id: "synthetic", createdAt: "2026-10-01", pollSnapshot: { heading: "旧版轮次", questions: initial.pollQuestions, openAt: "", closeAt: "", audience: "everyone" } }] } }); return true;
      }
      await route.fulfill({ json: { ok: true, rounds: [{ pollId: oldId, blockId: "block-one", heading: "旧版轮次" }, { pollId: "another-block-poll", blockId: "other", heading: "不相关" }] } }); return true;
    } });
    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "读取旧版历史轮次" }).click();
    const selector = page.getByRole("combobox", { name: "选择投票轮次" });
    await selector.locator(`option[value='${oldId}']`).waitFor({ state: "attached" });
    assert.equal(await selector.locator("option").count(), 2);
    await selector.selectOption(oldId);
    await page.getByRole("status").filter({ hasText: "已从旧选票恢复" }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "投票状态", exact: true }).inputValue(), "closed");
    await page.getByRole("button", { name: "删除本轮", exact: true }).click();
    await page.getByRole("button", { name: "读取旧版历史轮次" }).click();
    await page.getByRole("status").filter({ hasText: "已读取本投票区块" }).waitFor();
    assert.equal(await selector.locator(`option[value='${oldId}']`).count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  } finally { await browser.close(); }
});

test("late allocation after switching merchant cannot modify the replacement editor", { timeout: 60_000 }, async () => {
  const script = await bundle(), browser = await chromium.launch({ headless: true });
  try {
    let release, started;
    const waiting = new Promise(resolve => { started = resolve; });
    const { context, page, errors, unexpected } = await fixture(browser, script, { handle: async (route, request, url) => {
      if (url.pathname !== "/api/polls" || request.method() !== "POST") return false;
      started();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { ok: true, pollId: secondId } }); return true;
    } });
    page.on("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "新建一轮", exact: true }).click();
    await waiting;
    await page.getByRole("button", { name: "切换测试商户" }).click();
    release();
    await page.waitForLoadState("networkidle");
    assert.deepEqual(await page.evaluate(() => window.__pollProps), initial);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  } finally { await browser.close(); }
});
