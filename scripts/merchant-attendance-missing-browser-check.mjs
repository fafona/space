// Real component -> actual route handler/service -> real isolated service_role SQL.
// Only auth context/entitlement and HTTP routing are injected; no production auth.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { checkAttendanceMissing } from './merchant-attendance-missing-native.mjs';
const require = createRequire(import.meta.url);
const { handleAttendanceMissing } = require('../src/app/api/merchant-enterprise/attendance/missing/route-handler.ts');
const { executeAttendanceMissing } = require('../src/lib/merchantAttendanceMissing.server.ts');
const { handleAttendanceAdmin } = require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const { executeAttendanceAdmin } = require('../src/lib/merchantAttendanceAdmin.server.ts');
const { createAttendanceDatabaseTransport } = require('./fixtures/attendance-database-transport.ts');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => value === null ? 'null' : literal(JSON.stringify(value)) + '::jsonb';
export async function browserCheck(env, {revisionChecks=null}={}) {
  const { root, exec, pass, owner, employee, id, day }=env;
  const origin = 'http://127.0.0.1:3131', canonical = 'https://www.faolla.com';
  const probe = net.createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(3131, '127.0.0.1', resolve); }); await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['scripts/attendance-self-browser-harness.mjs', '--missing'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; const errors = [], external = [], requests = [], transport = createAttendanceDatabaseTransport(exec);
  const controls = { lose: false, moduleEnabled: true, revoked: false };
  const service = { rpc: async (name, args) => {
    if (name !== 'faolla_attendance_missing_v1') return transport.rpc(name, args);
    assert.equal(args.p_query.siteId, '99990001'); assert([owner, employee, id(2)].includes(args.p_auth_user_id));
    try { const r = JSON.parse(exec(`set role service_role;select jsonb_build_object('role',current_user,'data',public.faolla_attendance_missing_v1(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write === true}));`));
      assert.equal(r.role, 'service_role'); return { data: r.data, error: null };
    } catch (e) { const code = String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1]; if (!code) throw e; return { data: null, error: { message: code } }; }
  } };
  try {
    await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(Error('missing_harness_timeout')), 20000);
      child.stdout.on('data', value => { output += value; if (output.includes('Attendance synthetic component QA')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', value => errors.push(String(value))); child.once('exit', code => { clearTimeout(timer); reject(Error('harness_exit_' + code)); });
    });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) {
        if (request.method() !== 'GET' || !['/', '/harness.js', '/harness.css'].includes(url.pathname)) return route.abort();
        return route.continue();
      }
      try {
        const headers = new Headers(await request.allHeaders()); const actor = headers.get('x-attendance-test-actor'); assert(['owner','a','b'].includes(actor));
        const authUserId = actor === 'owner' ? owner : actor === 'a' ? employee : id(2);
        if (headers.get('origin') === origin) headers.set('origin', canonical); headers.set('host', 'www.faolla.com');
        if (headers.get('referer')?.startsWith(origin)) headers.set('referer', canonical + '/');
        const r = new Request(canonical + url.pathname + url.search, { method: request.method(), headers, body: request.postData() ?? undefined });
        const deps = { enabled: () => true, authenticate: async () => ({ user: { id: authUserId }, accessToken: 'synthetic', authenticationMethods: ['password'] }),
          entitlement: async () => ({ permissionConfig: { allowEnterpriseManagement: true, allowEmployeeAttendance: controls.moduleEnabled } }) };
        let response;
        if (url.pathname.endsWith('/missing')) {
          if (controls.revoked) response = Response.json({ ok: false, error: 'attendance_access_denied' }, { status: 403 });
          else response = await handleAttendanceMissing(r, { ...deps, execute: value => executeAttendanceMissing(value, service) });
        } else { assert.equal(url.pathname, '/api/merchant-enterprise/attendance/admin'); assert.equal(request.method(), 'GET'); response = await handleAttendanceAdmin(r, { ...deps, execute: value => executeAttendanceAdmin(value, service) }); }
        requests.push({ actor, method: request.method(), path: url.pathname, status: response.status, command: request.method() === 'POST' ? JSON.parse(request.postData()).command : null });
        if (controls.lose && request.method() === 'POST' && response.status === 200) { controls.lose = false; return route.abort('failed'); }
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      } catch (e) { errors.push(String(e)); await route.abort(); }
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept()); page.setDefaultTimeout(10000);

    const panel = access => page.getByRole('region', { name: access === 'owner' ? '整段漏卡审核工作区' : '整段漏卡申请工作区' });
    const open = async actor => { await page.getByRole('button', { name: actor === 'owner' ? '合成负责人' : actor === 'a' ? '合成员工甲' : '合成员工乙', exact: true }).click();
      const close=page.getByRole('button',{name:'关闭整段漏卡',exact:true});if(await close.count())await close.click();
      await page.getByRole('button', { name: actor === 'owner' ? '整段漏卡审核' : '整段漏卡申请', exact: true }).click();
      const p=panel(actor==='owner'?'owner':'self');await p.getByRole('status').filter({hasText:'已读取整段漏卡申请'}).waitFor(); return p; };
    const posts = () => requests.filter(r => r.method === 'POST');
    const ready = p => p.getByRole('status').filter({hasText:'原操作已确认'}).waitFor();
    const submit = async (p, n, reason, breaks=false) => {
      await p.getByLabel('申报开始时间',{exact:true}).fill(day(n)+'T09:00');await p.getByLabel('申报结束时间',{exact:true}).fill(day(n)+'T17:00');
      if(breaks){await p.getByRole('button',{name:'增加休息时段'}).click();await p.getByLabel('休息 1 开始',{exact:true}).fill(day(n)+'T12:00');await p.getByLabel('休息 1 结束',{exact:true}).fill(day(n)+'T13:00');}
      await p.getByLabel('漏卡原因',{exact:true}).fill(reason);await p.getByLabel('确认整段无打卡，起止、休息及理由真实，提交负责人审核').check();
      await p.getByRole('button',{name:'提交整段申请',exact:true}).click();
    };
    await page.goto(origin); let self=await open('a');assert.equal(posts().length,0);
    controls.lose=true;await submit(self,-5,'浏览器整段漏卡含休息',true);
    await self.getByRole('button',{name:'用原编号明确重试'}).waitFor();assert.equal(posts().length,1);
    const first=posts()[0].command.operationId;
    await self.getByRole('button',{name:'重新读取／查原收据'}).click();await ready(self);assert.equal(posts().length,1);
    await self.getByText('漏卡原因：浏览器整段漏卡含休息',{exact:true}).waitFor();
    await self.getByText(/休息 1：.*无薪/).waitFor();
    pass('employee form submits whole missing shift with explicit unpaid break; lost response recovers by GET only');
    self=await open('b');await self.getByText('当前提交日期范围内没有申请，不代表没有出勤。').waitFor();
    assert.equal(await self.getByText('漏卡原因：浏览器整段漏卡含休息',{exact:true}).count(),0);
    assert.equal(await self.getByRole('button',{name:'批准整段申请',exact:true}).count(),0);
    pass('second employee cannot see first employee declarations; self view never offers approval');
    let ownerPanel=await open('owner');await ownerPanel.getByRole('button',{name:'查看申请 '+first.slice(-4),exact:true}).click();
    await ownerPanel.getByLabel('审核意见',{exact:true}).fill('核对完整申报后批准');
    await ownerPanel.getByLabel('已核对完整申报及当前冲突提示，明确作出审核决定').check();
    controls.lose=true;await ownerPanel.getByRole('button',{name:'批准整段申请',exact:true}).click();
    await ownerPanel.getByRole('button',{name:'用原编号明确重试'}).waitFor();assert.equal(posts().length,2);
    await ownerPanel.getByRole('button',{name:'重新读取／查原收据'}).click();await ready(ownerPanel);
    await ownerPanel.getByRole('heading',{name:'漏卡员工甲 · 已批准',exact:true}).waitFor();assert.equal(posts().length,2);
    await ownerPanel.getByText(/已批准申报尚未纳入统一工时报表/).waitFor();
    pass('actual owner entry approves with current evidence; lost approval result restores immutable decision without double POST');
    await page.setViewportSize({width:390,height:844});self=await open('a');
    await submit(self,-6,'手机申请等待撤回');await ready(self);const second=posts()[2].command.operationId;
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false);
    controls.moduleEnabled=false;await self.getByRole('button',{name:'重新读取／查原收据'}).click();
    await self.getByRole('status').filter({hasText:'已读取整段漏卡申请'}).waitFor();
    await self.getByRole('button',{name:'查看申请 '+second.slice(-4),exact:true}).click();
    await self.getByLabel('撤回理由',{exact:true}).fill('手机核对后撤回');await self.getByLabel('确认撤回此申请，保留历史记录').check();
    await self.getByRole('button',{name:'撤回申请',exact:true}).click();await ready(self);
    await self.getByRole('heading',{name:'漏卡员工甲 · 已撤回',exact:true}).waitFor();assert.equal(posts().length,4);
    pass('390px mobile request has no horizontal overflow; platform pause still allows explicit self withdrawal');
    controls.moduleEnabled=true;self=await open('a');await submit(self,-7,'待负责人驳回');await ready(self);const third=posts()[4].command.operationId;
    ownerPanel=await open('owner');await ownerPanel.getByRole('button',{name:'查看申请 '+third.slice(-4),exact:true}).click();
    await ownerPanel.getByLabel('审核意见',{exact:true}).fill('依据不足，请重新核实');await ownerPanel.getByLabel('已核对完整申报及当前冲突提示，明确作出审核决定').check();
    await ownerPanel.getByRole('button',{name:'驳回整段申请',exact:true}).click();await ready(ownerPanel);
    await ownerPanel.getByRole('heading',{name:'漏卡员工甲 · 已驳回',exact:true}).waitFor();assert.equal(posts().length,6);
    pass('owner rejection preserves submitted facts and explicit review reason');
    controls.revoked=true;await ownerPanel.getByRole('button',{name:'重新读取／查原收据'}).click();
    await ownerPanel.getByRole('status').filter({hasText:'当前身份无权操作'}).waitFor();
    assert.equal(await ownerPanel.getByText('漏卡原因：待负责人驳回',{exact:true}).count(),0);assert.equal(posts().length,6);
    pass('authoritative permission denial hides protected declarations without new writes');
    if(revisionChecks){controls.revoked=false;await revisionChecks({...env,page,panel,open,posts,ready,controls,requests});}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(transport.errors,[]);
    console.log(JSON.stringify({missingBrowserPassed:true,productionAccess:false,realAuthentication:false,artifactsWritten:false,posts:posts().length}));
  } finally {await browser?.close();if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runAttendanceLabelsReuse(process.argv.slice(2),native=>checkAttendanceMissing(native,browserCheck)).catch(error=>{console.error(error);process.exitCode=1;});
