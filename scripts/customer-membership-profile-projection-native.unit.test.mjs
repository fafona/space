import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { assertNativeProfileParity, extractNativePagesDdl, resolveNativeProjectionConfig,
  stopOwnedNativeProjection, syntheticMemberships } from './customer-membership-profile-projection-native.mjs';

test('native runner accepts no remote, credential, binary or database overrides and is not a CI bypass', () => {
  const config = resolveNativeProjectionConfig({ PGHOST: 'remote', PGPASSWORD: 'private' }, [], 'win32');
  assert.equal(config.port, 56642); assert.equal(config.database, 'faolla_membership_profile_projection_native');
  assert.match(config.prefix, /membership-profile-projection-native-20260928-/);
  assert.ok(Object.values(config.binaries).every(binary => binary.startsWith('D:\\codex-pg15-ordinary-identity\\pgsql\\bin\\')));
  for (const args of [['--host=remote'], ['--password=private'], ['--port=56487'], ['--data=old'], ['--psql=other']]) {
    assert.throws(() => resolveNativeProjectionConfig({}, args, 'win32'), /no_arguments/);
  }
  assert.throws(() => resolveNativeProjectionConfig({ CI: 'true' }, [], 'win32'), /not_a_ci_admission/);
  assert.throws(() => resolveNativeProjectionConfig({ GITHUB_ACTIONS: 'true' }, [], 'win32'), /not_a_ci_admission/);
  assert.throws(() => resolveNativeProjectionConfig({}, [], 'linux'), /windows_only/);
});

test('synthetic fixtures are bounded and retain deterministic history and profile identities', () => {
  assert.deepEqual(syntheticMemberships(2, 3), syntheticMemberships(2, 3));
  const members = syntheticMemberships(2, 3);
  assert.equal(members.length, 2); assert.equal(members[1].transactions.length, 3);
  assert.equal(members[1].id, 'membership-1'); assert.equal(members[0].siteId, '99990001');
  for (const args of [[-1, 0], [1001, 0], [1, 5001], [11, 5000], [1, -1], [1, 0.1], [NaN, 1], [1, '3']]) {
    assert.throws(() => syntheticMemberships(...args), /fixture_bounds/);
  }
});

test('baseline DDL extraction requires the actual pages table and both indexes', () => {
  assert.throws(() => extractNativePagesDdl('create table wrong(id int);'), /ddl_missing/);
  const source = 'create table if not exists public.pages (\nid uuid\n);\ncreate index if not exists pages_slug_idx on public.pages(slug);\ncreate unique index if not exists pages_merchant_slug_unique_idx on public.pages(merchant_id,slug);';
  assert.equal(extractNativePagesDdl(source), source);
});

test('normal native comparisons cannot falsely pass if both loaders throw or both discard profiles', () => {
  const good = { value: { memberships: [{ id: 'membership-0' }] }, customerDirectory: [{ id: 'synthetic-customer' }], error: null };
  assertNativeProfileParity({ legacy: good, projected: structuredClone(good) }, 1);
  const failed = { value: null, customerDirectory: null, error: { name: 'TypeError', message: 'Cannot convert object to primitive value' } };
  assert.throws(() => assertNativeProfileParity({ legacy: failed, projected: failed }, 1), /expected_profile_error/);
  assertNativeProfileParity({ legacy: failed, projected: failed }, 1, 'TypeError');
  const empty = { value: { memberships: [] }, customerDirectory: [], error: null };
  assert.throws(() => assertNativeProfileParity({ legacy: empty, projected: empty }, 1), /expected_profile_count/);
  const altered = structuredClone(good); altered.customerDirectory[0].id = 'different';
  assert.throws(() => assertNativeProfileParity({ legacy: good, projected: altered }, 1), /complete_result_parity/);
});

test('cleanup uses a separate bounded budget and stops only a matching new datadir and port', () => {
  const dataDirectory = path.resolve('synthetic-owned/data'), calls = [], statuses = [0, 0, 3];
  stopOwnedNativeProjection({ pgCtl: 'fixed-pg_ctl', dataDirectory, readPid: () => `123\n${dataDirectory}\n0\n56642\n`,
    run(binary, args, input, cleanup) { calls.push({ binary, args, input, cleanup }); return { status: statuses.shift() }; } });
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.cleanup === true && call.args[1] === dataDirectory));
  assert.equal(calls[1].args.at(-1), 'stop');
  for (const badStatus of [1, 4, null]) assert.throws(() => stopOwnedNativeProjection({ pgCtl: 'fixed', dataDirectory,
    readPid: () => assert.fail('must not read an unverified pid file'), run: () => ({ status: badStatus }) }), /status_unknown/);
  assert.throws(() => stopOwnedNativeProjection({ pgCtl: 'fixed', dataDirectory,
    readPid: () => '123\n/another-directory\n0\n56642\n', run: () => ({ status: 0 }) }));
  assert.throws(() => stopOwnedNativeProjection({ pgCtl: 'fixed', dataDirectory,
    readPid: () => `123\n${dataDirectory}\n0\n56487\n`, run: () => ({ status: 0 }) }));
});
