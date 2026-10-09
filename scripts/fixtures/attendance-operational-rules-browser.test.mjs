import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createOperationalBrowserModel, operationalBrowserLimits } from './attendance-operational-rules-browser.mjs';
const require = createRequire(import.meta.url), p = require('../../src/lib/merchantAttendanceOperationalRuleLedger.ts'), f = require('../../src/lib/merchantAttendanceOperationalRuleLedgerTestFixtures.ts');
const headers = model => ({ 'x-synthetic-actor': model.seed.actor, 'x-synthetic-owner': 'true', 'x-synthetic-rules-enabled': 'true' });
const url = query => 'http://127.0.0.1' + p.OPERATIONAL_RULE_LEDGER_API + '?' + p.operationalRuleLedgerQueryString(query);
test('inert browser runner caps one owned context and discloses synthetic history/Auth/no SQL', async () => {
  assert.deepEqual(operationalBrowserLimits, { ttlMs: 180000, http: 100, api: 40 });
  const source = await readFile(new URL('./attendance-operational-rules-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /write: false/); assert.match(source, /server\.listen\(0, '127\.0\.0\.1'/); assert.match(source, /runAttendanceCleanupSteps/); assert.match(source, /--run-local/); assert.match(source, /actualSql: false/);
  assert.doesNotMatch(source, /screenshot|storageState|launchPersistentContext|pg_dump|execSync/);
});
test('synthetic26 prefix history pages through real async strict parser without claiming HTTP writes', async () => {
  const model = await createOperationalBrowserModel(), q = { siteId: model.seed.siteId, mode: 'history', scope: { kind: 'enterprise' }, cursor: null };
  const first = await model.respond(url(q), 'GET', '', headers(model)); assert.equal(first.body.data.data.items.length, 25); assert.equal(first.body.data.data.nextCursor.beforeRevision, 2);
  const next = await model.respond(url({ ...q, cursor: first.body.data.data.nextCursor }), 'GET', '', headers(model)); assert.deepEqual(next.body.data.data.items.map(i => i.item.revision), [1]); assert.equal(next.body.data.data.nextCursor, null); assert.equal(model.writes.length, 0); assert.equal(model.setupWrites, 26);
});
test('actual model write flow verifies hashes then permits flag-off safe withdraw and former-owner original GET', async () => {
  const model = await createOperationalBrowserModel(), scope = { kind: 'enterprise' }, q = { siteId: model.seed.siteId, mode: 'detail', scope }, h = headers(model);
  const post = async command => model.respond('http://127.0.0.1' + p.OPERATIONAL_RULE_LEDGER_API, 'POST', JSON.stringify({ query: q, command }), h);
  const c = f.operationalRuleLedgerSaveCommand(scope, 26, 1000); await post(c);
  const pv = await model.respond(url({ ...q, mode: 'preview', sourceDraftRevision: 27, effectiveOn: '2026-10-10', endsOn: null }), 'GET', '', h), v = pv.body.data.data;
  await post({ siteId: q.siteId, scope, action: 'publish', operationId: f.operationalRuleLedgerId(1001), expectedRevision: 27, reason: '合成发布', sourceDraftRevision: 27, effectiveOn: v.effectiveOn, endsOn: null, previewFingerprint: v.previewFingerprint });
  h['x-synthetic-rules-enabled'] = 'false'; const withdraw = { siteId: q.siteId, scope, action: 'withdraw', operationId: f.operationalRuleLedgerId(1002), expectedRevision: 28, reason: '合成撤销', publishedRevision: 28 }, lost = await post(withdraw); assert.equal(lost.text, '{"ok":');
  h['x-synthetic-owner'] = 'false'; const recovered = await model.respond(url({ siteId: q.siteId, mode: 'recover', operationId: withdraw.operationId }), 'GET', '', h); assert.deepEqual(recovered.body.data.receipt, model.writes[2].receipt);
  await assert.rejects(model.respond(url(q), 'GET', '', h), /current_owner_required/); assert.deepEqual(model.writes.map(w => w.command.action), ['save_draft', 'publish', 'withdraw']);
});
test('scope catalogs preserve complete current identity and a distinct saved personal Auth', async () => {
  const model = await createOperationalBrowserModel(), h = headers(model); assert.notEqual(model.personal.employeeAuthUserId, model.oldPersonal.employeeAuthUserId);
  for (const catalog of ['workers', 'routes', 'saved_personal']) { const q = { siteId: model.seed.siteId, mode: 'catalog', catalog, ...(catalog === 'saved_personal' ? { afterScope: null } : { afterId: null }) }; const r = await model.respond(url(q), 'GET', '', h); assert.equal(r.body.data.data.items.length, 1); }
  const r = await model.respond(url({ siteId: model.seed.siteId, mode: 'detail', scope: model.oldPersonal }), 'GET', '', h); assert.equal(r.body.data.canWrite, false); assert.equal(r.body.data.data.context, null); assert.equal(r.body.data.data.canWithdraw, true);
});
