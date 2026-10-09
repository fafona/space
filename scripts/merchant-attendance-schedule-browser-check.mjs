// Real component -> actual route handler/service -> real isolated service_role SQL.
// Only auth context/entitlement and HTTP routing are injected; no production auth.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { runAttendanceLabelsReuse } from './merchant-attendance-choice-labels-reuse-native.mjs';
import { checkAttendanceSchedule } from './merchant-attendance-schedule-native.mjs';
const require = createRequire(import.meta.url);
const { handleAttendanceSchedule } = require('../src/app/api/merchant-enterprise/attendance/schedule/route-handler.ts');
const { executeAttendanceSchedule } = require('../src/lib/merchantAttendanceSchedule.server.ts');
const { handleAttendanceAdmin } = require('../src/app/api/merchant-enterprise/attendance/admin/route-handler.ts');
const { executeAttendanceAdmin } = require('../src/lib/merchantAttendanceAdmin.server.ts');
const { createAttendanceDatabaseTransport } = require('./fixtures/attendance-database-transport.ts');
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const json = value => value === null ? 'null' : literal(JSON.stringify(value)) + '::jsonb';
async function browserCheck({ root, exec, pass, owner, employee, id, today, next }) {
  const origin = 'http://127.0.0.1:3131', canonical = 'https://www.faolla.com';
  const probe = net.createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(3131, '127.0.0.1', resolve); }); await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['scripts/attendance-self-browser-harness.mjs', '--schedule'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser; const errors = [], external = [], requests = [], transport = createAttendanceDatabaseTransport(exec);
  const controls = { lose: false, moduleEnabled: true, revoked: false };
  const service = { rpc: async (name, args) => {
    if (name !== 'faolla_attendance_schedule_v1') return transport.rpc(name, args);
    assert.equal(args.p_query.siteId, '99990001'); assert([owner, employee, id(2)].includes(args.p_auth_user_id));
    try { const r = JSON.parse(exec(`set role service_role;select jsonb_build_object('role',current_user,'data',public.faolla_attendance_schedule_v1(${json(args.p_query)},${literal(args.p_auth_user_id)},${json(args.p_command)},${args.p_allow_write === true}));`));
      assert.equal(r.role, 'service_role'); return { data: r.data, error: null };
    } catch (e) { const code = String(e).match(/ERROR:\s+(attendance_[a-z_]+)/)?.[1]; if (!code) throw e; return { data: null, error: { message: code } }; }
  } };
  try {
    await new Promise((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(Error('schedule_harness_timeout')), 20000);
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
        if (url.pathname.endsWith('/schedule')) {
          if (controls.revoked) response = Response.json({ ok: false, error: 'attendance_access_denied' }, { status: 403 });
          else response = await handleAttendanceSchedule(r, { ...deps, execute: value => executeAttendanceSchedule(value, service) });
        } else { assert.equal(url.pathname, '/api/merchant-enterprise/attendance/admin'); assert.equal(request.method(), 'GET'); response = await handleAttendanceAdmin(r, { ...deps, execute: value => executeAttendanceAdmin(value, service) }); }
        requests.push({ actor, method: request.method(), path: url.pathname, status: response.status });
        if (controls.lose && request.method() === 'POST' && response.status === 200) { controls.lose = false; return route.abort('failed'); }
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      } catch (e) { errors.push(String(e)); await route.abort(); }
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept()); page.setDefaultTimeout(10000);
    const region = () => page.getByRole('region', { name: '员工排班工作区' });
    const loadRange = async (from, through = from, panel = region()) => { await panel.getByLabel('开始日期', { exact: true }).fill(from); await panel.getByLabel('结束日期（含）').fill(through); await panel.getByRole('button', { name: '查询安排' }).click(); await panel.getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor(); };
    const selectWorker = async () => { await region().getByRole('button', { name: '搜索人员' }).click(); await region().getByRole('button', { name: '测试员工甲 · A01' }).click(); await region().getByRole('heading', { name: /新增安排/ }).waitFor(); };
    const posts = () => requests.filter(r => r.method === 'POST').length;
    await page.goto(origin); await page.getByRole('button', { name: '员工排班', exact: true }).click(); await region().getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor();
    await loadRange(today, next(6)); await selectWorker(); assert.equal(posts(), 0);
    await region().getByText(/当前排班版本 4/).waitFor(); pass('actual owner component discovers worker and reads database schedule without writes');
    await loadRange(next(3)); await region().getByLabel('第 1 段开始').fill('22:00'); await region().getByLabel('第 1 段结束').fill('06:00'); await region().getByLabel('次日结束').check();
    await region().getByRole('button', { name: '生成安排预览' }).click(); await region().getByLabel('安排理由', { exact: true }).fill('浏览器跨夜安排');
    await region().getByLabel(/已核对 1 段安排/).check(); controls.lose = true; await region().getByRole('button', { name: '发布排班', exact: true }).click();
    await region().getByRole('button', { name: '用原编号明确重试' }).waitFor(); assert.equal(posts(), 1);
    await region().getByRole('button', { name: '重新读取／查原收据' }).click(); await region().getByRole('status').filter({ hasText: '排班操作已确认' }).waitFor(); assert.equal(posts(), 1);
    await region().getByText('安排理由：浏览器跨夜安排', { exact: true }).waitFor();
    pass('real form publishes cross-midnight plan; lost successful response recovers via GET with no duplicate write');
    await page.getByRole('button', { name: '合成员工甲', exact: true }).click(); await page.getByRole('button', { name: '我的排班', exact: true }).click(); const self = page.getByRole('region', { name: '我的排班工作区' });
    await self.getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor(); await loadRange(next(3), next(3), self); await self.getByText('安排理由：浏览器跨夜安排', { exact: true }).waitFor();
    assert.equal(await self.getByRole('button', { name: '发布排班', exact: true }).count(), 0); assert.equal(await self.getByRole('button', { name: '取消此班次' }).count(), 0);
    await page.getByRole('button', { name: '合成员工乙', exact: true }).click(); await page.getByRole('button', { name: '我的排班', exact: true }).click(); await self.getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor(); await loadRange(next(3), next(3), self);
    await self.getByText('所选开始日期范围内暂无排班，不代表缺勤。').waitFor(); assert.equal(await self.getByText('浏览器跨夜安排', { exact: true }).count(), 0);
    pass('employee UI reads only own arrangement with no publish/cancel controls; second employee has no leaked plan');
    await page.getByRole('button', { name: '合成负责人', exact: true }).click(); await page.getByRole('button', { name: '员工排班', exact: true }).click(); await region().getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor();
    await loadRange(next(3)); await selectWorker(); await region().getByRole('button', { name: '取消此班次' }).click(); await region().getByLabel('取消理由').fill('浏览器取消并保留原记录');
    await region().getByRole('button', { name: '确认取消班次' }).click(); await region().getByText('已取消', { exact: true }).waitFor(); await region().getByText(/取消理由：浏览器取消并保留原记录/).waitFor();
    assert.equal(posts(), 2); pass('actual cancellation form preserves original plan and displays both reasons');
    await page.setViewportSize({ width: 390, height: 844 }); await loadRange(next(4), next(6));
    await region().getByLabel('按每周重复展开当前范围').check(); for (const checkbox of await region().getByLabel(/^周/).all()) await checkbox.check();
    await region().getByRole('button', { name: '生成安排预览' }).click(); await region().getByLabel('安排理由', { exact: true }).fill('手机重复排班'); await region().getByLabel(/已核对 3 段安排/).check();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    await region().getByRole('button', { name: '发布排班', exact: true }).click(); await region().getByRole('status').filter({ hasText: '排班操作已确认' }).waitFor();
    assert.equal(await region().getByText('安排理由：手机重复排班', { exact: true }).count(), 3); assert.equal(posts(), 3);
    pass('390px mobile weekly expansion preview and batch publication have no horizontal overflow');
    controls.moduleEnabled = false; await region().getByRole('button', { name: '重新读取／查原收据' }).click(); await region().getByRole('status').filter({ hasText: '已读取计划安排' }).waitFor();
    assert(await region().getByRole('button', { name: '生成安排预览' }).isDisabled()); assert.equal(await region().getByText('安排理由：手机重复排班', { exact: true }).count(), 3);
    controls.revoked = true; await region().getByRole('button', { name: '重新读取／查原收据' }).click(); await region().getByRole('status').filter({ hasText: '当前身份无权访问' }).waitFor();
    assert.equal(await region().getByText('安排理由：手机重复排班', { exact: true }).count(), 0); assert.equal(posts(), 3);
    pass('paused platform remains read-only; authoritative denial removes protected schedule UI');
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(transport.errors, []);
    console.log(JSON.stringify({ scheduleBrowserPassed: true, productionAccess: false, realAuthentication: false, artifactsWritten: false, finalRevision: 7 }));
  } finally { await browser?.close(); if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } }
}
runAttendanceLabelsReuse(process.argv.slice(2), native => checkAttendanceSchedule(native, browserCheck)).catch(error => { console.error(error); process.exitCode = 1; });
