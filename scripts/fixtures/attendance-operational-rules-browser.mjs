// INERT by default. Local synthetic wire ledger only; no database or real Auth.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAttendanceCleanupSteps } from './attendance-cleanup.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)), require = createRequire(import.meta.url);
export const operationalBrowserLimits = Object.freeze({ ttlMs: 180000, http: 100, api: 40 });
const api = '/api/merchant-enterprise/attendance/operational-rules', admin = '/api/merchant-enterprise/attendance/admin', groups = '/api/merchant-enterprise/attendance/groups';
const paths = new Set([api, admin, groups]), statics = new Set(['/', '/qa.js', '/qa.css', '/favicon.ico']);
export async function createOperationalBrowserModel() {
  const f = require('../../src/lib/merchantAttendanceOperationalRuleLedgerTestFixtures.ts'), p = require('../../src/lib/merchantAttendanceOperationalRuleLedger.ts'), a = require('../../src/lib/merchantAttendanceAdmin.ts'), g = require('../../src/lib/merchantAttendanceGroups.ts');
  const seed = { siteId: f.operationalRuleLedgerSite, actor: f.operationalRuleLedgerActor, other: f.operationalRuleLedgerId(99), endpoint: api, location: f.operationalRuleLedgerId(6), routeEmployee: f.operationalRuleLedgerId(8), routeAuth: f.operationalRuleLedgerId(9) };
  const scope = f.operationalRuleLedgerScope(), personal = f.operationalRuleLedgerScope('personal'), oldPersonal = { ...personal, employeeAuthUserId: f.operationalRuleLedgerId(55) };
  const rows = [], writes = [], receipts = new Map();
  // Explicit synthetic immutable prefix, not HTTP writes and not SQL evidence.
  for (let n = 1; n <= 26; n++) rows.push(await f.operationalRuleLedgerDraft(scope, n));
  let draft = rows.at(-1), publication = null;
  const references = rules => ({ subject: null, locations: rules.locationScope.mode === 'value' ? rules.locationScope.value.map(locationId => ({ locationId, version: 1, active: true })) : [],
    routes: rules.reviewRouting.mode === 'value' ? ['correction', 'missing', 'leave', 'work_arrangement'].flatMap(category => { const v = rules.reviewRouting.value[category]; return v === 'owner' ? [] : [{ category, employeeId: v.delegateEmployeeId, employeeAuthUserId: v.delegateAuthUserId, employeeVersion: 1, active: true }]; }) : [] });
  const result = (data, canWrite = false, actorId = seed.actor) => ({ ...f.operationalRuleLedgerResult(data, canWrite), actorId });
  async function preview(query) { assert(draft); const v = { scope, revision: rows.length, sourceDraftRevision: draft.revision, context: draft.context, rulesFingerprint: draft.rulesFingerprint,
    references: draft.references, referenceFingerprint: draft.referenceFingerprint, effectiveOn: query.effectiveOn, endsOn: null, effectiveAt: query.effectiveOn + 'T00:00:00.000000Z', endsAt: null };
    return { kind: 'preview', ...v, previewFingerprint: await p.operationalRuleLedgerPreviewFingerprint(seed.siteId, v), applied: false }; }
  async function respond(url, method, text, headers) {
    const u = new URL(url), actorId = headers['x-synthetic-actor'], owner = headers['x-synthetic-owner'] === 'true', enabled = headers['x-synthetic-rules-enabled'] === 'true';
    assert([seed.actor, seed.other].includes(actorId)); assert(paths.has(u.pathname)); let body, query = null, command = null, lost = false;
    if (u.pathname === admin) { assert(owner && actorId === seed.actor); assert.equal(method, 'GET'); query = a.parseAttendanceAdminQuery(u.href); assert.equal(query.siteId, seed.siteId); assert.equal(query.cursor, null); assert.equal(query.operationId, null); assert(['settings', 'locations'].includes(query.view));
      body = { ok: true, moduleEnabled: true, siteId: seed.siteId, view: query.view, version: 1, settings: { timeZone: 'UTC', enabled: true, webClockEnabled: true, webBreakPaid: false }, items: query.view === 'locations' ? [{ id: seed.location, name: '合成地点240', timeZone: 'UTC', active: true }] : [], nextCursor: null, receipt: null }; a.parseAttendanceAdminResult(body, query);
    } else if (u.pathname === groups) { assert(owner && actorId === seed.actor); assert.equal(method, 'GET'); query = g.parseGroupsHttpQuery(u.href); assert.equal(query.view, 'groups'); assert.equal(query.cursorId, null);
      body = { ok: true, moduleEnabled: true, protocol: 'groups-v1', siteId: seed.siteId, actorId, settingsVersion: 1, timeZone: 'UTC', view: 'groups', group: null, worker: null, items: [{ groupId: f.operationalRuleLedgerId(2), revision: 1, name: '合成考勤组240', description: '', active: true, createdAt: f.operationalRuleLedgerReadAt, updatedAt: f.operationalRuleLedgerReadAt }], nextCursor: null, detail: null, receipt: null }; g.parseGroupsResponse(body, query, null, actorId);
    } else {
      const parsed = method === 'POST' ? p.parseOperationalRuleLedgerBody(p.parseOperationalRuleLedgerJson(text, 'request')) : null; query = parsed?.query ?? p.parseOperationalRuleLedgerHttpQuery(u.href); command = parsed?.command ?? null;
      assert.equal(query.siteId, seed.siteId); assert.equal(actorId, seed.actor); assert(query.mode === 'recover' && method === 'GET' || owner, 'current_owner_required');
      let raw;
      if (command) { assert.equal(command.scope.kind, 'enterprise'); assert.equal(command.expectedRevision, rows.length); assert(!receipts.has(command.operationId), 'duplicate_post');
        assert(enabled || command.action === 'withdraw'); const common = { scope, action: command.action, operationId: command.operationId, actorId, revision: rows.length + 1, reason: command.reason, recordedAt: f.operationalRuleLedgerReadAt, commandFingerprint: await p.operationalRuleLedgerCommandFingerprint(command, actorId) }; let item;
        if (command.action === 'save_draft') { const refs = references(command.rules); assert.deepEqual(command.expectedContext, f.operationalRuleLedgerContext()); item = { ...common, context: command.expectedContext, rules: command.rules, references: refs, rulesFingerprint: await p.operationalRuleLedgerRulesFingerprint(command.rules), referenceFingerprint: await p.operationalRuleLedgerReferenceFingerprint(seed.siteId, scope, command.expectedContext, refs) }; draft = item; }
        else if (command.action === 'publish') { assert(draft); const view = await preview(command); assert.equal(command.sourceDraftRevision, draft.revision); assert.equal(command.previewFingerprint, view.previewFingerprint);
          item = { ...draft, ...common, sourceDraftRevision: draft.revision, effectiveOn: view.effectiveOn, endsOn: view.endsOn, effectiveAt: view.effectiveAt, endsAt: view.endsAt, previewFingerprint: view.previewFingerprint }; publication = item; draft = null;
        } else { assert(publication); assert.equal(command.publishedRevision, publication.revision); item = { ...common, publishedRevision: publication.revision }; publication = null; lost = true; }
        rows.push(item); raw = await f.operationalRuleLedgerReceiptResult(command); receipts.set(command.operationId, raw.receipt); writes.push({ command, receipt: raw.receipt, lost });
      } else if (query.mode === 'recover') { raw = { ...result({ kind: 'receipt' }), receipt: receipts.get(query.operationId) ?? null }; }
      else if (query.mode === 'catalog') { assert.equal('afterId' in query ? query.afterId : query.afterScope, null);
        const data = query.catalog === 'workers' ? { kind: 'catalog', catalog: 'workers', items: [{ workerId: personal.workerId, workerName: '合成人员240', employeeId: personal.employeeId, employeeAuthUserId: personal.employeeAuthUserId }], nextId: null }
          : query.catalog === 'routes' ? { kind: 'catalog', catalog: 'routes', items: [{ employeeId: seed.routeEmployee, employeeName: '合成路由成员240', employeeAuthUserId: seed.routeAuth }], nextId: null }
            : { kind: 'catalog', catalog: 'saved_personal', items: [{ scope: oldPersonal, revision: 2, updatedAt: f.operationalRuleLedgerReadAt }], nextScope: null }; raw = result(data);
      } else if (query.mode === 'detail') {
        if (p.operationalRuleLedgerEqual(query.scope, oldPersonal)) { raw = await f.operationalRuleLedgerDetail(oldPersonal, false, true); raw = { ...raw, canWrite: false, data: { ...raw.data, context: null } }; }
        else if (query.scope.kind !== 'enterprise') { assert(p.operationalRuleLedgerEqual(query.scope, personal) || p.operationalRuleLedgerEqual(query.scope, f.operationalRuleLedgerScope('group'))); raw = await f.operationalRuleLedgerDetail(query.scope); raw = { ...raw, canWrite: enabled }; }
        else raw = result({ kind: 'detail', scope, revision: rows.length, context: f.operationalRuleLedgerContext(), draft, currentPublication: null, nextPublication: publication, canWithdraw: !!publication }, enabled);
      } else if (query.mode === 'preview') { assert(enabled); assert.equal(query.scope.kind, 'enterprise'); assert.equal(query.endsOn, null); raw = result(await preview(query), true); }
      else { assert.equal(query.mode, 'history'); assert.equal(query.scope.kind, 'enterprise'); const atRevision = query.cursor?.atRevision ?? rows.length, top = query.cursor ? query.cursor.beforeRevision - 1 : atRevision;
        const items = rows.filter(r => r.revision <= top).slice(-25).reverse().map(item => ({ item, withdrawnByRevision: item.action === 'publish' ? rows.find(r => r.action === 'withdraw' && r.publishedRevision === item.revision && r.revision <= atRevision)?.revision ?? null : null }));
        raw = result({ kind: 'history', scope, atRevision, items, nextCursor: top > 25 ? { siteId: seed.siteId, scope, atRevision, beforeRevision: items.at(-1).item.revision } : null }); }
      body = { ok: true, data: raw }; await p.parseOperationalRuleLedgerResponse(body, query, actorId, command);
    }
    return { body, text: lost ? '{"ok":' : JSON.stringify(body), query, command, lost, owner, enabled };
  }
  return { seed, respond, writes, rows, oldPersonal, personal, setupWrites: 26 };
}
async function bounded(promise, ms = 12000) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('operational_browser_deadline')), ms); })]); } finally { clearTimeout(timer); } }
async function assets(seed) {
  const { build } = await import('esbuild'), { compile } = await import('@tailwindcss/node'), { default: ts } = await import('typescript');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/fixtures/attendance-operational-rules-browser-entry.tsx'], bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: ['es2020'], jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), outfile: 'qa.js', logLevel: 'warning', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"', __RULES_BROWSER_SEED__: JSON.stringify(seed) } });
  const candidates = new Set(); for (const name of Object.keys(bundle.metafile.inputs)) { assert(!/node:crypto|\.server\.ts$/.test(name), 'server_import'); if (!/\.tsx?$/.test(name) || name.includes('node_modules')) continue;
    const ast = ts.createSourceFile(name, await readFile(path.join(root, name), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const visit = n => { if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) n.text.split(/\s+/).filter(Boolean).forEach(v => candidates.add(v)); ts.forEachChild(n, visit); }; visit(ast); }
  const css = (await compile('@import "tailwindcss";', { base: root, onDependency: () => {} })).build([...candidates]) + 'body{margin:0;background:#f8fafc;font-family:Arial,sans-serif}.qa-main{max-width:1200px;margin:auto;min-width:0}';
  return { js: bundle.outputFiles.find(f => f.path.endsWith('.js')).contents, css };
}
export async function verifyOperationalRulesBrowser() {
  const started = Date.now(), deadline = started + operationalBrowserLimits.ttlMs, model = await createOperationalBrowserModel(), requests = [], errors = [], inflight = new Set();
  let totalHttp = 0, server, browser, context, page, origin, files, closing = false, stage = 'setup', failure, report, accept = true;
  const timer = setTimeout(() => { closing = true; void context?.close().catch(() => {}); server?.closeAllConnections(); }, Math.max(1, deadline - Date.now()));
  const button = name => page.getByRole('button', { name, exact: true });
  const settle = async () => { await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await bounded(Promise.allSettled([...inflight])); };
  const click = async (locator, mode, method = 'GET', endpoint = api) => { const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === method && (!mode || new URL(r.url()).searchParams.get('mode') === mode)), locator.click()]); await response.finished(); assert.equal(response.status(), 200, await response.text()); await settle(); return response; };
  const close = async () => { await button('关闭运营规则台账').click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); };
  try {
    files = await bounded(assets(model.seed), 45000);
    server = createServer((req, res) => { const work = (async () => { assert(!closing && Date.now() < deadline); assert(++totalHttp <= operationalBrowserLimits.http); assert.equal(req.headers.host, new URL(origin).host); const u = new URL(req.url, origin);
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      if (statics.has(u.pathname)) { assert.equal(req.method, 'GET'); assert.equal(u.search, ''); if (u.pathname === '/favicon.ico') return res.writeHead(204).end(); const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/qa.css"><div id="qa-root"></div><script type="module" src="/qa.js"></script></html>';
        return res.writeHead(200, { 'Content-Type': u.pathname === '/' ? 'text/html;charset=utf-8' : u.pathname === '/qa.js' ? 'text/javascript;charset=utf-8' : 'text/css;charset=utf-8' }).end(u.pathname === '/' ? html : u.pathname === '/qa.js' ? files.js : files.css); }
      assert(paths.has(u.pathname)); assert(requests.length < operationalBrowserLimits.api); let text = '', bytes = 0; for await (const chunk of req) { bytes += chunk.length; assert(bytes <= 40960); text += chunk.toString('utf8'); }
      const value = await model.respond(u.href, req.method, text, req.headers); requests.push({ method: req.method, path: u.pathname, query: value.query, operationId: value.command?.operationId, owner: value.owner, enabled: value.enabled }); res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' }).end(value.text);
    })(); inflight.add(work); void work.catch(e => { errors.push(e.message); if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); }).finally(() => inflight.delete(work)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const address = server.address(); assert(address && typeof address === 'object' && address.address === '127.0.0.1'); origin = `http://127.0.0.1:${address.port}`;
    const { chromium } = await import('playwright'); const launch = chromium.launch({ headless: true }); void launch.then(b => { if (closing) return b.close(); }).catch(() => {}); browser = await bounded(launch, 15000); context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, viewport: { width: 390, height: 900 } });
    await context.route('**/*', async route => { const r = route.request(), u = new URL(r.url()); if (u.origin !== origin || !(statics.has(u.pathname) && r.method() === 'GET' && !u.search || paths.has(u.pathname) && (r.method() === 'GET' || r.method() === 'POST' && u.pathname === api))) { errors.push('external_or_unknown_request'); return route.abort(); } await route.continue(); });
    page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('popup', () => errors.push('popup')); page.on('download', () => errors.push('download')); page.on('dialog', d => void (accept ? d.accept() : d.dismiss()).catch(e => { if (!closing) errors.push(e.message); }));
    stage = 'actual_admin_zero_initial'; await page.goto(origin); await button('八字段运营规则台账').waitFor(); await settle(); const before = requests.length; await button('八字段运营规则台账').click(); await button('读取当前台账').waitFor(); await settle(); assert.equal(requests.length, before);
    stage = 'trusted_scopes'; await click(button('读取考勤组目录'), null, 'GET', groups); await button('选用此考勤组').click(); await click(button('读取当前台账'), 'detail'); assert.equal(requests.at(-1).query.scope.kind, 'group');
    await click(button('读取当前人员目录'), 'catalog'); await button('选用此当前人员身份').click(); await click(button('读取当前台账'), 'detail'); assert.deepEqual(requests.at(-1).query.scope, model.personal);
    await click(button('读取保存的个人范围'), 'catalog'); await button('选择此保存个人范围').click(); await click(button('读取当前台账'), 'detail'); assert.deepEqual(requests.at(-1).query.scope, model.oldPersonal); assert.equal(await button('明确保存规则草稿').isEnabled(), false); await button('选择企业层').click(); await click(button('读取当前台账'), 'detail');
    stage = 'eight_fields_and_save'; const form = page.getByRole('region', { name: '八字段运营规则台账', exact: true });
    for (const name of ['允许打卡渠道', '地点范围', '班次来源', '休息类型', '补正窗口', '审核路由', '周期方式', '提醒配置']) await form.getByLabel(name + '处理方式', { exact: true }).last().selectOption('value');
    await form.getByLabel('允许PIN渠道', { exact: true }).check(); await click(button('读取地点目录'), null, 'GET', admin); await form.getByLabel('选择地点 合成地点240', { exact: true }).check();
    await click(button('读取路由成员目录'), 'catalog'); await form.getByLabel('首次补正路由', { exact: true }).selectOption({ label: '合成路由成员240' }); await form.getByLabel('班次来源值', { exact: true }).selectOption('unplanned'); await form.getByLabel('补正窗口天数（0–365）', { exact: true }).fill('7'); await form.getByLabel('周期方式值', { exact: true }).selectOption('weekly'); await form.getByLabel('未闭合班次提醒', { exact: true }).selectOption('enabled');
    await click(button('读取当前台账'), 'detail'); await page.getByLabel('规则操作理由', { exact: true }).fill('Synthetic240 explicit eight fields'); accept = false; await button('关闭运营规则台账').click(); await button('明确保存规则草稿').waitFor(); assert.equal(model.writes.length, 0); accept = true;
    await click(button('明确保存规则草稿'), null, 'POST'); await page.getByRole('region', { name: '规则台账最小回执', exact: true }).waitFor(); assert.equal(model.writes.length, 1); assert(Object.values(model.writes[0].command.rules).every(v => v.mode === 'value'));
    stage = 'future_preview_publish'; await click(button('读取当前台账'), 'detail'); await page.getByLabel('规则未来开始日期', { exact: true }).fill('2026-10-10'); await click(button('核验已保存草稿的未来发布'), 'preview'); await page.getByLabel('规则操作理由', { exact: true }).fill('Synthetic240 explicit future publication');
    accept = false; await button('明确发布未来规则').click(); assert.equal(model.writes.length, 1); accept = true; await click(button('明确发布未来规则'), null, 'POST'); assert.equal(model.writes.length, 2);
    stage = 'history25_and3'; await click(button('读取台账历史'), 'history'); assert.equal(await page.locator('[data-rule-revision]').count(), 25); const first = await page.locator('[data-rule-revision]').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('data-rule-revision')))); assert.deepEqual(first, Array.from({ length: 25 }, (_, n) => 28 - n));
    await click(button('下一页台账历史'), 'history'); assert.equal(requests.at(-1).query.cursor.beforeRevision, 4); assert.deepEqual(await page.locator('[data-rule-revision]').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('data-rule-revision')))), [3, 2, 1]); assert.equal(await button('下一页台账历史').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, '390_document_overflow'); assert.equal(await form.evaluate(e => e.scrollWidth > e.clientWidth), false, '390_panel_overflow'); await close();
    stage = 'flagoff_safe_withdraw'; await page.evaluate(() => window.__rulesHarness.configure({ enabled: false })); await button('查看／撤销已保存规则').waitFor(); await settle(); await button('查看／撤销已保存规则').click(); await button('读取当前台账').waitFor(); await click(button('读取当前台账'), 'detail'); assert.equal(await button('明确保存规则草稿').isEnabled(), false);
    await page.getByLabel('规则操作理由', { exact: true }).fill('Synthetic240 safely withdraw future only'); await click(button('明确撤销未来发布'), null, 'POST'); await button('核对原规则操作编号').waitFor(); assert.equal(model.writes.length, 3);
    const pending = await page.evaluate(() => { const keys = Object.keys(sessionStorage).filter(k => k.startsWith('faolla:attendance:operational-rule-ledger:v1:')); if (keys.length !== 1) throw Error('one_pending'); return { key: keys[0], raw: sessionStorage.getItem(keys[0]) }; }); assert.deepEqual(JSON.parse(pending.raw).command, model.writes[2].command); assert.equal(JSON.parse(pending.raw).commandFingerprint, model.writes[2].receipt.commandFingerprint);
    await close(); stage = 'former_owner_recovery_only'; await page.evaluate(() => window.__rulesHarness.configure({ recovery: true })); const count = requests.length; await button('查找本标签页待确认编号').click(); await button('读取这个原编号').waitFor(); assert.equal(requests.length, count); await click(button('读取这个原编号'), 'recover'); assert.equal(requests.at(-1).owner, false); assert.equal(await page.evaluate(key => sessionStorage.getItem(key), pending.key), null); assert.equal(model.writes.length, 3);
    stage = 'hidden_auth_late_body'; await page.evaluate(() => window.__rulesHarness.configure({ recovery: false })); await button('查看／撤销已保存规则').waitFor(); await button('查看／撤销已保存规则').click(); await button('读取当前台账').waitFor(); await page.evaluate(() => window.__rulesHarness.hold()); await button('读取当前台账').click(); await page.waitForFunction(() => window.__rulesHarness.held()); await page.evaluate(() => window.__rulesHarness.visibility(true)); await page.evaluate(() => window.__rulesHarness.configure({ other: true })); await page.evaluate(() => { window.__rulesHarness.release(); window.__rulesHarness.visibility(false); }); await settle(); assert.equal(await page.getByRole('region', { name: '八字段运营规则台账', exact: true }).count(), 0); assert.equal(await page.getByRole('region', { name: '规则台账最小回执', exact: true }).count(), 0);
    assert.deepEqual(errors, []); assert.equal(requests.filter(r => r.method === 'POST').length, 3); assert.deepEqual(model.writes.map(w => w.command.action), ['save_draft', 'publish', 'withdraw']);
    report = { groups: 6, actualOwnerAdmin: true, actualLauncherPanelFields: true, independentFormerOwnerRecovery: true, syntheticAuth: true, actualSql: false, runtimeRulesAdopted: false,
      gets: requests.filter(r => r.method === 'GET').length, posts: 3, apiRequests: requests.length, totalHttp, syntheticSetupHistoryRows: 26, historyPages: [25, 3], syntheticHttpWrites: 3,
      lostReply: 'truncated JSON after synthetic commit, not TCP outage', noAutomaticPost: true, mobileWidth: 390, horizontalOverflow: false, externalRequests: 0, consoleErrors: 0, diskBundle: false, port: new URL(origin).port, elapsedMs: Date.now() - started };
  } catch (error) { failure = Error(`operational_browser_failed:${stage}:${error.message}:${JSON.stringify({ errors, requests: requests.slice(-4) })}`, { cause: error }); throw failure; }
  finally { closing = true; clearTimeout(timer); await runAttendanceCleanupSteps([{ name: 'held body', run: async () => { if (page && !page.isClosed()) await page.evaluate(() => window.__rulesHarness?.release()).catch(() => {}); } },
    { name: 'owned context', run: () => context ? bounded(context.close(), 6000) : undefined }, { name: 'owned browser', run: () => browser ? bounded(browser.close(), 6000) : undefined },
    { name: 'HTTP work', run: () => bounded(Promise.allSettled([...inflight]), 6000) }, { name: 'owned listener', run: () => { server?.closeAllConnections(); return server?.listening ? bounded(new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())), 6000) : undefined; } },
    { name: 'esbuild', run: async () => { (await import('esbuild')).stop(); } }]).catch(error => { if (failure) throw new AggregateError([failure, error], 'operational_browser_cleanup_failed'); throw error; });
    assert(!browser?.isConnected() && !server?.listening); if (failure) console.error(JSON.stringify({ cleanup: 'operational-browser', browserClosed: !browser?.isConnected(), listenerStopped: !server?.listening, port: origin ? new URL(origin).port : null, apiRequests: requests.length, totalHttp })); }
  return { ...report, browserClosed: true, listenerStopped: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--run-local') console.log(JSON.stringify(await verifyOperationalRulesBrowser()));
  else if (process.argv.length === 2) console.log('Inert. node --import tsx scripts/fixtures/attendance-operational-rules-browser.mjs --run-local');
  else throw Error('explicit_run_local_only');
}
