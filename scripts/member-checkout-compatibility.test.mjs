import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationFingerprint, compileProtocolSources, loadCompatibilityBaseline, readCompatibilityCatalog, inspectCompatibilityCatalog, compatibilityCatalogSql } from './member-checkout-compatibility-check.mjs';

const body = '\nBEGIN RETURN NULL; END;\n';
function fixture() {
  const text = `CREATE TABLE faolla_checkout_design.example(id text);
CREATE FUNCTION public.faolla_checkout_example(p_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$${body}$$;
CREATE FUNCTION faolla_checkout_design.guard_example() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$${body}$$;
CREATE CONSTRAINT TRIGGER example_guard AFTER INSERT OR UPDATE OR DELETE ON public.pages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION faolla_checkout_design.guard_example();`;
  const expected = compileProtocolSources([{ file: 'database/proposals/synthetic.sql', text }]);
  const catalog = {
    functions: expected.functions.map(p => ({ ...p, body, ownerBypassesRls: true, sqlBody: false, publicExecute: false, executors: [] })),
    tables: [{ name: 'faolla_checkout_design.example', kind: 'r', rls: true, forced: true, policies: 0, publicAccess: false, accessors: [] }],
    triggers: expected.triggers.map(t => ({ ...t, enabled: 'O', args: 0, qualified: false, columns: '' })),
    schemas: [{ name: 'faolla_checkout_design', publicAccess: false, accessors: [] }],
  };
  return { expected, catalog };
}
const inspect = x => inspectCompatibilityCatalog(x.expected, x.catalog);

test('pinned application and all SQL sources still match the tested baseline, including literal Next catch-all paths', async () => {
  const baseline = await loadCompatibilityBaseline(); assert.deepEqual(baseline.issues, []);
  assert.deepEqual(await applicationFingerprint(), baseline.manifest.application);
  assert.equal(baseline.manifest.sources.length, 37); assert.equal(baseline.expected.functions.length, 79);
  assert.equal(baseline.expected.tables.length, 23); assert.equal(baseline.expected.triggers.length, 26);
});

test('matching private catalogue is diagnostic evidence only, never deployment or runtime authority', () => {
  const x = fixture(), before = structuredClone(x.catalog), result = inspect(x);
  assert.equal(result.protocolObjectsMatch, true); assert.equal(result.deploymentReady, false); assert.ok(result.notVerified.includes('approved-runtime-transport-and-least-privilege'));
  assert.deepEqual(x.catalog, before);
});

test('missing or altered function body, signature, execution mode, language or argument binding fails closed', () => {
  for (const patch of [{ body: 'RETURN NEW;' }, { types: ['uuid'] }, { returnType: 'text' }, { returnsSet: true }, { securityDefiner: true }, { strict: true }, { parallel: 's' }, { volatility: 'v' }, { language: 'sql' }, { args: ['p_other'] }, { config: ['search_path=public'] }, { sqlBody: true }]) {
    const x = fixture(); Object.assign(x.catalog.functions[0], patch); assert.equal(inspect(x).protocolObjectsMatch, false);
  }
  const x = fixture(); x.catalog.functions.pop(); assert.ok(inspect(x).issues.some(v => v.startsWith('function_missing:')));
});

test('PUBLIC defaults and inherited/effective API execution grants remain exposure, not an automatic readiness fix', () => {
  for (const patch of [{ publicExecute: true }, { publicExecute: undefined }, { executors: '{}' }, { executors: null }, { executors: ['anon'] }, { executors: ['authenticated'] }, { executors: ['service_role'] }]) {
    const x = fixture(); Object.assign(x.catalog.functions[0], patch); assert.ok(inspect(x).issues.some(v => v.startsWith('private_function_exposed:'))); assert.equal(inspect(x).deploymentReady, false);
  }
});

test('private definer guard requires its bypass-capable owner and cannot silently become an invoker', () => {
  for (const patch of [{ ownerBypassesRls: false }, { securityDefiner: false }]) {
    const x = fixture(); Object.assign(x.catalog.functions[1], patch); assert.equal(inspect(x).protocolObjectsMatch, false);
  }
});

test('missing, replica-only, disabled, reassigned, conditional or no-longer-deferred guard is rejected', () => {
  for (const patch of [{ enabled: 'D' }, { enabled: 'R' }, { function: 'public.other()' }, { type: 31 }, { deferred: false }, { deferrable: false }, { constraint: false }, { qualified: true }, { columns: '1' }, { args: 1 }]) {
    const x = fixture(); Object.assign(x.catalog.triggers[0], patch); assert.ok(inspect(x).issues.some(v => v.startsWith('trigger_changed:')));
  }
  const x = fixture(); x.catalog.triggers.length = 0; assert.ok(inspect(x).issues.some(v => v.startsWith('trigger_missing_or_duplicate:')));
});

test('private RLS, policies and schema/table grants cannot be weakened', () => {
  for (const patch of [{ rls: false }, { forced: false }, { policies: 1 }, { publicAccess: true }, { publicAccess: undefined }, { accessors: '{}' }, { accessors: ['service_role'] }]) {
    const x = fixture(); Object.assign(x.catalog.tables[0], patch); assert.equal(inspect(x).protocolObjectsMatch, false);
  }
  for (const patch of [{ publicAccess: true }, { publicAccess: undefined }, { accessors: '{}' }, { accessors: ['anon'] }]) { const x = fixture(); Object.assign(x.catalog.schemas[0], patch); assert.equal(inspect(x).protocolObjectsMatch, false); }
});

test('duplicate, missing, unexpected private or malformed catalogue records are not an empty safe schema', () => {
  for (const key of ['functions', 'tables', 'triggers']) {
    const x = fixture(); x.catalog[key].push(x.catalog[key][0]); assert.equal(inspect(x).protocolObjectsMatch, false);
  }
  const x = fixture(); x.catalog.tables.push({ ...x.catalog.tables[0], name: 'faolla_checkout_design.unknown' }); assert.equal(inspect(x).protocolObjectsMatch, false);
  const y = fixture(); y.catalog.functions.push({ ...y.catalog.functions[0], name: 'faolla_member_checkout_unapproved_v1' }); assert.ok(inspect(y).issues.some(v => v.startsWith('unexpected_private_function:')));
  const z = fixture(); z.catalog.triggers.push({ ...z.catalog.triggers[0], name: 'unapproved' }); assert.ok(inspect(z).issues.some(v => v.startsWith('unexpected_private_trigger:')));
  assert.equal(inspectCompatibilityCatalog(x.expected, null).protocolObjectsMatch, false);
});

test('catalogue transport executes only fixed SELECT metadata reads and redacts query failures', async () => {
  const x = fixture(), calls = [];
  assert.deepEqual(await readCompatibilityCatalog(async sql => { calls.push(sql); return { rows: x.catalog[Object.entries(compatibilityCatalogSql).find(([, v]) => v === sql)[0]] }; }), x.catalog);
  assert.equal(calls.length, 4); for (const sql of calls) {
    assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /;/);
    // Privilege names inside a SQL string literal are metadata, not writes.
    assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g, "''"), /\b(?:BEGIN|UPDATE|INSERT|DELETE|GRANT|REVOKE|ALTER|DROP)\b/i);
  }
  for (const key of ['functions','tables','schemas']) assert.match(compatibilityCatalogSql[key], /ARRAY\(SELECT r\.rolname::text /); // pg decodes text[], not name[]
  await assert.rejects(readCompatibilityCatalog(async () => { throw Error('PRIVATE credential query failed'); }), /^Error: checkout_compatibility_catalog_unavailable$/);
  await assert.rejects(readCompatibilityCatalog(async () => ({ rows: null })), /^Error: checkout_compatibility_catalog_unavailable$/);
});

test('limited DDL compiler refuses unsupported declarations rather than dropping them', () => {
  for (const text of ['CREATE FUNCTION unqualified() RETURNS integer AS $$SELECT 1$$ LANGUAGE sql;',
    'CREATE FUNCTION public.bad(p_a text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL$$;',
    'CREATE TRIGGER bad BEFORE UPDATE ON public.pages FOR EACH ROW WHEN (true) EXECUTE FUNCTION public.guard();']) assert.throws(() => compileProtocolSources([{ file: 'database/proposals/test.sql', text }]), /checkout_compatibility_artifact_invalid/);
});
