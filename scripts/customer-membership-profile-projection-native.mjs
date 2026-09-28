// Local Windows PG15 acceptance only; creates and retains a NEW synthetic cluster.
// Run: node scripts/customer-membership-profile-projection-native.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = 'D:/codex-pg15-ordinary-identity/pgsql/bin';
const PREFIX = 'D:/codex-membership-profile-projection-native-20260928-';
const PORT = 56642, DATABASE = 'faolla_membership_profile_projection_native', SITE = '99990001';
const SLUG = '__merchant_memberships__:' + SITE, RPC = 'faolla_customer_membership_profiles_v1';
const MIGRATION = 'scripts/supabase-migrations/202609280060_customer_membership_profile_projection.sql';
const NOW = '2032-06-01T00:00:00.000Z';
const IDS = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
const sha = value => createHash('sha256').update(value).digest('hex');
const textSql = value => "'" + String(value).replaceAll("'", "''") + "'";
const jsonSql = value => textSql(JSON.stringify(value)) + '::jsonb';
const clone = value => JSON.parse(JSON.stringify(value));
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');

export function resolveNativeProjectionConfig(environment = {}, args = [], platform = process.platform) {
  assert.equal(args.length, 0, 'native_projection_no_arguments');
  assert.equal(platform, 'win32', 'native_projection_windows_only');
  assert.ok(environment.CI !== 'true' && environment.GITHUB_ACTIONS !== 'true', 'native_projection_not_a_ci_admission_path');
  return { port: PORT, database: DATABASE, prefix: PREFIX,
    binaries: Object.fromEntries(['psql', 'initdb', 'pg_ctl'].map(name => [name, path.win32.join(BIN, name + '.exe')])) };
}

export function syntheticMemberships(count, transactions) {
  assert.ok(Number.isInteger(count) && count >= 0 && count <= 1000 && Number.isInteger(transactions) && transactions >= 0
    && transactions <= 5000 && count * transactions <= 50_000, 'native_fixture_bounds');
  return Array.from({ length: count }, (_, index) => ({ id: 'membership-' + index, siteId: SITE, siteName: 'Synthetic merchant',
    accountId: 'synthetic-account-' + index, name: 'Synthetic member ' + index, email: `synthetic-${index}@example.test`,
    serial: index + 1, memberNo: 'synthetic-member-' + index, status: 'active', joinedAt: NOW, updatedAt: NOW,
    transactions: Array.from({ length: transactions }, (_, item) => ({ id: 'transaction-' + index + '-' + item,
      type: item % 2 ? 'redeem' : 'recharge', status: 'completed', at: NOW, pointDelta: 1, balanceDelta: 2.5,
      growthDelta: 1.25, note: 'Synthetic transaction ' + item, operatorId: 'synthetic-operator' })) }));
}

export function extractNativePagesDdl(source) {
  return [/create table if not exists public\.pages \([\s\S]*?\n\);/i,
    /create index if not exists pages_slug_idx[^;]+;/i,
    /create unique index if not exists pages_merchant_slug_unique_idx[^;]+;/i].map(pattern => {
    const match = source.match(pattern)?.[0]; assert.ok(match, 'native_pages_baseline_ddl_missing'); return match;
  }).join('\n');
}

export function assertNativeProfileParity(comparisons, expectedCount, expectedError = null) {
  for (const variant of ['legacy', 'projected']) {
    const result = comparisons[variant];
    assert.equal(result.error?.name ?? null, expectedError, 'native_expected_profile_error');
    if (expectedError === null) {
      assert.equal(result.value?.memberships.length ?? 0, expectedCount, 'native_expected_profile_count');
      assert.deepEqual((result.value?.memberships ?? []).map(member => member.id).sort(),
        Array.from({ length: expectedCount }, (_, index) => 'membership-' + index).sort(), 'native_expected_profile_ids');
      assert.equal(result.customerDirectory.length, expectedCount, 'native_expected_customer_count');
    }
  }
  assert.deepEqual(comparisons.projected.value, comparisons.legacy.value, 'actual_profile_loader_result_parity');
  assert.deepEqual(comparisons.projected.error, comparisons.legacy.error, 'actual_profile_loader_error_parity');
  assert.deepEqual(comparisons.projected.customerDirectory, comparisons.legacy.customerDirectory, 'actual_customer_reducer_complete_result_parity');
}

export function stopOwnedNativeProjection({ pgCtl, dataDirectory, readPid, run }) {
  const status = run(pgCtl, ['-D', dataDirectory, 'status'], undefined, true);
  assert.ok(status.status === 0 || status.status === 3, 'native_projection_owned_status_unknown');
  if (status.status === 0) {
    const pid = readPid().split(/\r?\n/);
    assert.equal(path.resolve(pid[1]), path.resolve(dataDirectory)); assert.equal(Number(pid[3]), PORT);
    assert.equal(run(pgCtl, ['-D', dataDirectory, '-m', 'fast', '-w', '-t', '20', 'stop'], undefined, true).status, 0, 'native_projection_owned_stop_failed');
    assert.equal(run(pgCtl, ['-D', dataDirectory, 'status'], undefined, true).status, 3, 'native_projection_owned_process_still_running');
  }
}

function profileRuntime(enabled, sourceHashes) {
  const modules = new Map(), forbidden = () => { throw Error('native_projection_forbidden_dependency'); };
  const fixedDate = new Proxy(Date, { construct: (target, args) => Reflect.construct(target, args.length ? args : [NOW]),
    get: (target, key) => key === 'now' ? () => Date.parse(NOW) : Reflect.get(target, key) });
  const context = createContext({ Date: fixedDate, AbortController, setTimeout, clearTimeout, console: { error: forbidden, warn: forbidden, log: forbidden },
    process: { env: enabled ? { MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_ENABLED: '1', MERCHANT_CUSTOMER_MEMBERSHIP_PROJECTION_SITE_IDS: SITE } : {} } });
  function load(name) {
    name = name.replace(/^@\//, '') + (name.endsWith('.ts') ? '' : '.ts');
    if (['lib/merchantMembershipLedgerDualWrite.server.ts', 'lib/merchantOrderMembershipTransaction.server.ts'].includes(name)) {
      return new Proxy({}, { get: (_target, key) => key === '__esModule' ? true : forbidden });
    }
    assert.ok(['lib/merchantMembershipsStore.ts', 'lib/merchantMemberships.ts', 'lib/merchantMembershipProfileProjection.server.ts', 'lib/mutationOperationId.ts', 'lib/merchantCustomers.ts'].includes(name), 'native_runtime_unexpected_module');
    if (modules.has(name)) return modules.get(name).exports;
    const source = readFileSync(path.join(ROOT, 'src', name), 'utf8'); sourceHashes['src/' + name] = sha(source);
    const moduleRecord = { exports: {} }; modules.set(name, moduleRecord);
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    new Script('(function(require,module,exports){' + compiled + '\n})', { filename: name }).runInContext(context)(load, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  }
  return { loadProfiles: load('lib/merchantMembershipsStore.ts').loadStoredMerchantMembershipProfiles,
    buildDirectory: load('lib/merchantCustomers.ts').buildMerchantCustomerDirectory };
}

export async function runNativeProjection(environment = process.env, args = process.argv.slice(2)) {
  const config = resolveNativeProjectionConfig(environment, args);
  for (const binary of Object.values(config.binaries)) assert.ok(existsSync(binary), 'native_projection_binary_missing');
  await new Promise((resolve, reject) => {
    const socket = net.createServer(); socket.once('error', () => reject(Error('native_projection_port_not_free')));
    socket.listen({ host: '127.0.0.1', port: PORT, exclusive: true }, () => socket.close(resolve));
  });
  const directory = path.resolve(mkdtempSync(PREFIX)), dataDirectory = path.join(directory, 'data');
  assert.equal(path.dirname(dataDirectory), directory, 'native_projection_directory_scope');
  const windows = environment.SystemRoot || 'C:\\Windows';
  const env = { SystemRoot: windows, WINDIR: windows, COMSPEC: path.join(windows, 'System32', 'cmd.exe'),
    PATH: BIN + ';' + path.join(windows, 'System32'), TEMP: directory, TMP: directory,
    PGHOSTADDR: '127.0.0.1', PGCONNECT_TIMEOUT: '5', PGSSLMODE: 'disable', PGPASSFILE: path.join(directory, 'no-credentials.pgpass'),
    PGAPPNAME: 'faolla_membership_profile_projection_native', PGOPTIONS: '-c lc_messages=C -c statement_timeout=20000 -c lock_timeout=5000' };
  const deadline = Date.now() + 240_000;
  const spawn = (binary, parameters, input, cleanup = false, backgroundStart = false) => {
    const remaining = cleanup ? 30_000 : deadline - Date.now(); assert.ok(remaining > 0, 'native_projection_deadline');
    assert.ok(!backgroundStart || (binary === config.binaries.pg_ctl && parameters.at(-1) === 'start'), 'native_projection_background_scope');
    const result = spawnSync(binary, parameters, { input, encoding: 'utf8', env, shell: false, windowsHide: true,
      stdio: backgroundStart ? 'ignore' : ['pipe', 'pipe', 'pipe'], timeout: Math.min(30_000, remaining), maxBuffer: 40_000_000 });
    assert.ok(!result.error && !result.signal, 'native_projection_process_failed:' + path.basename(binary) + ':'
      + (backgroundStart ? 'start' : cleanup ? 'cleanup' : 'foreground') + ':' + (result.error?.code || result.signal || 'unknown'));
    return { status: result.status, output: (result.stdout || '').trim(), error: result.stderr || '' };
  };
  const psql = (sql, database = DATABASE) => {
    assert.ok([DATABASE, 'postgres'].includes(database), 'native_projection_database_scope');
    return spawn(config.binaries.psql, ['--host=127.0.0.1', `--port=${PORT}`, '--username=postgres', `--dbname=${database}`,
      '--no-password', '--no-psqlrc', '--quiet', '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate'], sql);
  };
  const query = (sql, database) => { const result = psql(sql, database); assert.equal(result.status, 0, 'native_projection_sql_failed:' + result.error.slice(0, 160)); return result.output; };
  const json = sql => JSON.parse(query(sql));
  const service = sql => query('set role service_role; ' + sql);
  const rpc = () => JSON.parse(service(`select public.${RPC}('${SITE}');`));
  const sourceHashes = {}, runtimes = { projected: profileRuntime(true, sourceHashes), legacy: profileRuntime(false, sourceHashes) };
  const checks = [], results = [], pass = label => checks.push(label);
  const beforeIdentity = `select jsonb_build_object('database',current_database(),'user',current_user,'address',host(inet_server_addr()),
    'port',inet_server_port(),'major',current_setting('server_version_num')::integer/10000,'dataDirectory',current_setting('data_directory'));`;
  const rawSnapshot = () => json(`select jsonb_build_object('pages',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.pages p),'[]'),
    'registry',coalesce((select jsonb_agg(to_jsonb(m) order by version) from public.faolla_schema_migrations m),'[]'));`);
  const rawHash = () => sha(JSON.stringify(rawSnapshot()));
  const selectRows = filters => `select coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) from
    (select id,slug,blocks,updated_at from public.pages where ${filters.map(([key, value]) => key + '=' + textSql(value)).join(' and ')}) selected;`;
  const replace = (blocks, secondOwner) => {
    query(`delete from public.pages where id in (${IDS.map(textSql).join(',')});
      insert into public.pages(id,merchant_id,slug,blocks,created_at,updated_at) values
      ('${IDS[0]}','${SITE}','${SLUG}',${jsonSql(blocks)},'${NOW}','${NOW}')
      ${secondOwner === undefined ? '' : `,('${IDS[1]}',${secondOwner === null ? 'null' : textSql(secondOwner)},'${SLUG}',${jsonSql(blocks)},'${NOW}','${NOW}')`};`);
  };
  async function compareProfiles(expectedCount, expectedError = null) {
    const before = rawHash(), comparisons = {};
    for (const variant of ['legacy', 'projected']) {
      const trace = [];
      const client = { rpc: async (name, input) => {
        assert.equal(name, RPC); assert.deepEqual(clone(input), { p_site_id: SITE });
        const output = service(`select public.${RPC}('${SITE}');`); trace.push({ kind: 'rpc', bytes: Buffer.byteLength(output) });
        return { data: JSON.parse(output), error: null };
      }, from(table) {
        assert.equal(table, 'pages'); const filters = [];
        return { select(fields) { assert.equal(fields, 'id,slug,blocks,updated_at'); return this; },
          eq(key, value) { assert.ok(['merchant_id', 'slug'].includes(key)); filters.push([key, value]); return this; },
          then(fulfilled, rejected) { const output = service(selectRows(filters)); trace.push({ kind: 'select', bytes: Buffer.byteLength(output) });
            return Promise.resolve({ data: JSON.parse(output), error: null }).then(fulfilled, rejected); } };
      } };
      try {
        const value = clone(await runtimes[variant].loadProfiles(client, SITE));
        const customerDirectory = clone(runtimes[variant].buildDirectory({ siteId: SITE, memberships: value?.memberships ?? [], storedCustomers: [], orders: [], bookings: [] }));
        comparisons[variant] = { value, customerDirectory, error: null, trace };
      } catch (error) { comparisons[variant] = { value: null, customerDirectory: null, error: { name: error.name, message: error.message }, trace }; }
    }
    assertNativeProfileParity(comparisons, expectedCount, expectedError);
    assert.equal(rawHash(), before, 'profile_loaders_mutated_raw_pages_or_registry');
    return { profileSha256: sha(JSON.stringify(comparisons.legacy.value)), customerDirectorySha256: sha(JSON.stringify(comparisons.legacy.customerDirectory)),
      expectedCount, expectedError, error: comparisons.legacy.error,
      legacyCalls: comparisons.legacy.trace, projectedCalls: comparisons.projected.trace, rawTableSha256: before };
  }
  let startAttempted = false, report;
  try {
    const initialized = spawn(config.binaries.initdb, ['--pgdata=' + dataDirectory, '--username=postgres', '--no-locale', '--encoding=UTF8', '--auth-local=trust', '--auth-host=trust']);
    assert.equal(initialized.status, 0, 'native_projection_initdb_failed:' + initialized.error.slice(0, 160));
    startAttempted = true;
    // The background server must not retain Node's pg_ctl capture pipes.
    // Its startup diagnostics already go to this invocation's dedicated log.
    const started = spawn(config.binaries.pg_ctl, ['-D', dataDirectory, '-l', path.join(directory, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${PORT}`, 'start'], undefined, false, true);
    assert.equal(started.status, 0, 'native_projection_start_failed:' + started.error.slice(0, 160));
    const identity = JSON.parse(query(beforeIdentity, 'postgres'));
    assert.deepEqual({ ...identity, dataDirectory: path.resolve(identity.dataDirectory) },
      { database: 'postgres', user: 'postgres', address: '127.0.0.1', port: PORT, major: 15, dataDirectory: path.resolve(dataDirectory) });
    assert.equal(query(`select count(*) from pg_database where datname='${DATABASE}';`, 'postgres'), '0');
    query(`create database ${DATABASE} template template0;`, 'postgres');
    assert.equal(json(beforeIdentity).database, DATABASE);
    assert.equal(query("select count(*) from pg_class where relnamespace='public'::regnamespace;"), '0');
    const init = readFileSync(path.join(ROOT, 'scripts/supabase-init.sql'), 'utf8');
    sourceHashes['scripts/supabase-init.sql'] = sha(init);
    const migration = readFileSync(path.join(ROOT, MIGRATION), 'utf8'); sourceHashes[MIGRATION] = sha(migration);
    query(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role synthetic_untrusted nologin;
      grant usage on schema public to anon,authenticated,service_role,synthetic_untrusted;
      ${extractNativePagesDdl(init)}
      alter table public.pages enable row level security; grant select on public.pages to service_role;
      create table public.faolla_schema_migrations(version bigint primary key,name text not null,applied_at timestamptz not null default now());`);
    replace(syntheticMemberships(2, 2)); const beforeMigration = rawSnapshot().pages;
    const indexSql = "select jsonb_agg(jsonb_build_object('name',indexname,'definition',indexdef) order by indexname) from pg_indexes where schemaname='public' and tablename='pages';";
    const indexes = json(indexSql);
    query(migration); assert.deepEqual(rawSnapshot().pages, beforeMigration); const installed = rawHash();
    query(migration); assert.equal(rawHash(), installed); pass('fresh owned PG15 cluster; actual pages DDL; additive migration and replay preserve raw rows/registry');
    assert.deepEqual(json(indexSql), indexes, 'migration_preserves_existing_indexes');
    assert.deepEqual(json(`select jsonb_build_object('invoker',not prosecdef,'stable',provolatile='s','path',proconfig) from pg_proc where oid='public.${RPC}(text)'::regprocedure;`),
      { invoker: true, stable: true, path: ['search_path=pg_catalog, public'] });
    for (const role of ['anon', 'authenticated', 'synthetic_untrusted']) {
      assert.equal(query(`select has_function_privilege('${role}','public.${RPC}(text)','execute');`), 'f');
      const denied = psql(`set role ${role}; select public.${RPC}('${SITE}');`); assert.notEqual(denied.status, 0); assert.match(denied.error, /42501/);
    }
    assert.equal(rpc().status, 'projected');
    query('revoke select on public.pages from service_role;');
    const invokerDenied = psql(`set role service_role; select public.${RPC}('${SITE}');`);
    assert.notEqual(invokerDenied.status, 0); assert.match(invokerDenied.error, /42501/);
    query('grant select on public.pages to service_role;');
    query(`grant execute on function public.${RPC}(text) to public,anon,synthetic_untrusted;`); query(migration);
    for (const role of ['anon', 'authenticated', 'synthetic_untrusted']) assert.equal(query(`select has_function_privilege('${role}','public.${RPC}(text)','execute');`), 'f');
    assert.equal(rawHash(), installed); pass('service-only invoker/stable RPC; browser calls denied; replay removes unexpected grants without data changes');
    const contractCases = [];
    async function check(label, blocks, expected, expectedCount, secondOwner, expectedError = null) {
      replace(blocks, secondOwner); const before = rawHash(), value = rpc(); assert.equal(value.status, expected);
      if (expected === 'fallback') assert.deepEqual(value, { version: 1, status: 'fallback', siteId: SITE });
      else assert.deepEqual(value.rows[0].blocks, blocks.map(member => member && typeof member === 'object' && !Array.isArray(member) ? { ...member, transactions: [] } : member));
      const parity = await compareProfiles(expectedCount, expectedError); assert.equal(rawHash(), before); contractCases.push({ label, status: expected, ...parity });
    }
    const ordinary = syntheticMemberships(2, 2);
    await check('unique-owned-exact-slug', ordinary, 'projected', 2);
    await check('global-duplicate-foreign-owner', ordinary, 'fallback', 2, '99990002');
    await check('global-duplicate-null-owner', ordinary, 'fallback', 2, null);
    replace(ordinary); query(`update public.pages set merchant_id='99990002' where id='${IDS[0]}';`);
    assert.deepEqual(rpc(), { version: 1, status: 'fallback', siteId: SITE }); await compareProfiles(2); pass('foreign-only fallback');
    query(`delete from public.pages where id in (${IDS.map(textSql).join(',')});`);
    assert.deepEqual(rpc(), { version: 1, status: 'fallback', siteId: SITE }); await compareProfiles(0); pass('no-row fallback');
    await check('non-array-blocks', { synthetic: true }, 'fallback', 0);
    for (const field of ['balanceDelta', 'growthDelta']) {
      for (const money of [[2.5], { toString: null }]) {
        const members = syntheticMemberships(1, 1); members[0].transactions[0][field] = money;
        await check(field + '-' + (Array.isArray(money) ? 'array' : 'object'), members, 'fallback', 1, undefined, Array.isArray(money) ? null : 'TypeError');
      }
    }
    const odd = syntheticMemberships(2, 1); odd[0].transactions = { balanceDelta: { toString: null } };
    odd[1].transactions = [null, [], 'invalid', { at: 'invalid-date', balanceDelta: 'not-money' }];
    odd[1].joinedAt = 'invalid-date'; odd[1].updatedAt = 'invalid-date';
    // SQL preserves the invalid joinedAt element/ordinal; the unchanged TS
    // normalizer deliberately discards that profile, leaving membership-0.
    await check('non-array-history-and-invalid-dates-ordinal', [null, 'synthetic-invalid', [], ...odd], 'projected', 1);
    for (const site of ['', 'bad', SITE + '\n']) { const invalid = psql(`set role service_role; select public.${RPC}(${textSql(site)});`); assert.notEqual(invalid.status, 0); }
    pass('eligibility, conservative money guards, invalid shapes/dates, ordinal preservation and actual TypeScript result/error parity');
    query(`create schema native_fixture; grant usage on schema native_fixture to service_role;
      create function native_fixture.measure(projected boolean) returns jsonb language plpgsql security invoker as $measure$
      declare started timestamptz; payload jsonb; elapsed numeric;
      begin started:=clock_timestamp();
        if projected then payload:=public.${RPC}('${SITE}');
        else select coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb) into payload from
          (select id,slug,blocks,updated_at from public.pages where merchant_id='${SITE}' and slug='${SLUG}') selected; end if;
        elapsed:=extract(epoch from clock_timestamp()-started)*1000;
        return jsonb_build_object('payload',payload,'serverWallMs',elapsed,'nativeJsonBytes',octet_length(payload::text));
      end $measure$; grant execute on function native_fixture.measure(boolean) to service_role;`);
    for (const [count, transactions] of [[100, 0], [1000, 20], [10, 5000]]) {
      replace(syntheticMemberships(count, transactions)); const before = rawHash(), samples = [];
      let payloadHashes, byteCounts;
      for (let repeat = 0; repeat < 3; repeat++) {
        const sample = {};
        for (const variant of repeat % 2 ? ['projected', 'legacy'] : ['legacy', 'projected']) {
          const start = performance.now(); const measured = JSON.parse(service(`select native_fixture.measure(${variant === 'projected'});`));
          sample[variant] = { serverWallMs: measured.serverWallMs, psqlWallMs: performance.now() - start };
          const explainedSql = variant === 'projected' ? `select public.${RPC}('${SITE}');`
            : `select id,slug,blocks,updated_at from public.pages where merchant_id='${SITE}' and slug='${SLUG}';`;
          const plan = JSON.parse(service('explain (analyze,format json,timing off) ' + explainedSql))[0];
          sample[variant].explainExecutionMs = plan['Execution Time'];
          sample[variant].explainPlanningMs = plan['Planning Time'];
          const digest = sha(JSON.stringify(measured.payload));
          payloadHashes ??= {}; byteCounts ??= {};
          if (payloadHashes[variant]) assert.equal(payloadHashes[variant], digest); else payloadHashes[variant] = digest;
          byteCounts[variant] = { nativeSqlJsonBytes: measured.nativeJsonBytes, compactJsonBytes: jsonBytes(measured.payload) };
          if (variant === 'projected') { assert.equal(measured.payload.status, 'projected'); assert.equal(measured.payload.rows[0].blocks.length, count); }
        }
        samples.push(sample);
      }
      const parity = await compareProfiles(count); assert.equal(rawHash(), before);
      assert.equal(parity.projectedCalls.filter(call => call.kind === 'select').length, 0);
      if (transactions > 0) assert.ok(byteCounts.projected.nativeSqlJsonBytes < byteCounts.legacy.nativeSqlJsonBytes);
      results.push({ count, transactionsPerMembership: transactions, byteCounts, payloadHashes, samples, ...parity });
    }
    report = { schema: 'faolla-membership-profile-native-projection-v1', node: process.version, platform: process.platform,
      cluster: { directory, dataDirectory, port: PORT, database: DATABASE, major: 15, dataPreserved: true },
      sourceHashes, scriptSha256: sha(readFileSync(fileURLToPath(import.meta.url))), checks, contractCases, results,
      boundaries: { syntheticDatabaseOnly: true, productionTraffic: false, realPostgreSql: true, realPostgrest: false,
        realNetworkTransferMeasurement: false, actualTypeScriptLoader: true, privateInputs: false,
        bytes: 'Native PostgreSQL JSON text octets and separately compact parsed JSON bytes, not HTTP transfer or PostgreSQL disk-read reduction.',
        timing: 'Three descriptive native SQL wall samples measured with clock_timestamp inside a synthetic JSON wrapper; psqlWallMs additionally includes process/connection/serialization overhead. Separate EXPLAIN ANALYZE TIMING OFF measures the actual RPC SELECT versus unwrapped legacy SELECT. Not production latency or a GET/browser measurement; projection may cost additional DB CPU.',
        loader: 'Actual TypeScript modules execute in a fixed-clock isolated VM; RPC and fallback SELECT use only this owned PostgreSQL database. Writers/network and inherited application environment are unavailable.' } };
  } finally {
    if (startAttempted) {
      // Independent cleanup budget; never broaden beyond this new data path.
      stopOwnedNativeProjection({ pgCtl: config.binaries.pg_ctl, dataDirectory,
        readPid: () => readFileSync(path.join(dataDirectory, 'postmaster.pid'), 'utf8'), run: spawn });
    }
  }
  return { ...report, cluster: { ...report.cluster, stopped: true } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await runNativeProjection()) + '\n'); }
  catch (error) { process.stderr.write('native_projection_failed; owned synthetic data retained; ' + String(error.message).slice(0, 240) + '\n'); process.exitCode = 1; }
}
