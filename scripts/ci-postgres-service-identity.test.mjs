import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CI_POSTGRES_SERVICE_ID, CI_POSTGRES_BOUND_ID, CI_POSTGRES_BOUND_ADDRESS,
  parseCiPostgresServiceIdentity, expectedDisposablePostgresServerAddress,
  bindCiPostgresServiceIdentity } from "./ci-postgres-service-identity.mjs";

const id = "a".repeat(64);
const address = "172.19.0.2";
const failure = { message: "ci_postgres_service_identity_invalid" };
const output = (serverAddress = address, containerId = id) => JSON.stringify({ id: containerId,
  networks: { github_network: { IPAddress: serverAddress, Gateway: "172.19.0.1" } } });
const environment = () => ({ CI: "true", GITHUB_ACTIONS: "true", [CI_POSTGRES_SERVICE_ID]: id,
  GITHUB_ENV: path.resolve("synthetic-github-environment") });
const bound = () => ({ ...environment(), [CI_POSTGRES_BOUND_ID]: id, [CI_POSTGRES_BOUND_ADDRESS]: address });

test("one exact service-container private IPv4 is captured, not a runner destination or gateway", () => {
  for (const value of [address, "10.1.2.3", "192.168.100.2"]) {
    assert.deepEqual(parseCiPostgresServiceIdentity(output(value), id), { containerId: id, serverAddress: value });
  }
});

test("missing, malformed, multi-value, public or loopback server addresses fail closed", () => {
  for (const value of [undefined, null, [], [address], 42, "", "127.0.0.1", "8.8.8.8", "::1", "172.32.0.2",
    "172.19.0.256", "172.019.0.2", `${address}\n`, `${address},172.19.0.3`, `${address}\nOTHER=1`]) {
    const malformed = JSON.stringify({ id, networks: { github_network: { IPAddress: value } } });
    assert.throws(() => parseCiPostgresServiceIdentity(malformed, id), failure);
  }
});

test("inspect output must bind the exact container and exactly one network", () => {
  for (const value of ["", "not json", "null", "[]", output(address, "b".repeat(64)),
    JSON.stringify({ id, networks: {} }), JSON.stringify({ id, networks: { one: { IPAddress: address }, two: { IPAddress: address } } }),
    JSON.stringify({ id, networks: [], extra: true }), JSON.stringify({ id, networks: { one: null } }),
    output() + output(), " ".repeat(65_537) + output()]) {
    assert.throws(() => parseCiPostgresServiceIdentity(value, id), failure);
  }
  for (const value of [null, id.toUpperCase(), "a".repeat(12), `${id}\n`, [id]]) {
    assert.throws(() => parseCiPostgresServiceIdentity(output(), value), failure);
  }
});

test("CI binding inspects only the trusted ID and emits only the two bounded environment values", () => {
  const calls = []; const writes = [];
  const result = bindCiPostgresServiceIdentity({ environment: environment(), inspect: (args) => {
    calls.push(args); return { status: 0, stdout: output() };
  }, writeEnvironment: (...args) => writes.push(args) });
  assert.deepEqual(result, { containerId: id, serverAddress: address });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "inspect");
  assert.equal(calls[0][1], "--type=container"); assert.equal(calls[0].at(-1), id);
  assert.equal(calls[0][3], '{"id":{{json .Id}},"networks":{{json .NetworkSettings.Networks}}}');
  assert.deepEqual(writes, [[environment().GITHUB_ENV, `${CI_POSTGRES_BOUND_ID}=${id}\n${CI_POSTGRES_BOUND_ADDRESS}=${address}\n`]]);
});

test("untrusted CI context or preexisting address override performs zero inspect and zero environment writes", () => {
  for (const replacement of [{ CI: "false" }, { GITHUB_ACTIONS: undefined }, { [CI_POSTGRES_SERVICE_ID]: undefined },
    { [CI_POSTGRES_SERVICE_ID]: `${id};anything` }, { [CI_POSTGRES_SERVICE_ID]: `${id}\n` }, { GITHUB_ENV: "relative-file" }, { GITHUB_ENV: "" },
    { [CI_POSTGRES_BOUND_ID]: id }, { [CI_POSTGRES_BOUND_ADDRESS]: address }]) {
    assert.throws(() => bindCiPostgresServiceIdentity({ environment: { ...environment(), ...replacement },
      inspect: () => assert.fail("must not inspect"), writeEnvironment: () => assert.fail("must not write") }), failure);
  }
});

test("inspect errors, malformed results and environment write failures return a fixed safe error", () => {
  for (const response of [null, { status: 1, stderr: "private detail" }, { status: 0, signal: "SIGTERM", stdout: output() },
    { status: 0, error: new Error("private detail"), stdout: output() }, { status: 0, stdout: "private detail" }]) {
    assert.throws(() => bindCiPostgresServiceIdentity({ environment: environment(), inspect: () => response,
      writeEnvironment: () => assert.fail("must not write") }), failure);
  }
  assert.throws(() => bindCiPostgresServiceIdentity({ environment: environment(), inspect: () => { throw new Error("private detail"); } }), failure);
  assert.throws(() => bindCiPostgresServiceIdentity({ environment: environment(), inspect: () => ({ status: 0, stdout: output() }),
    writeEnvironment: () => { throw new Error("private detail"); } }), failure);
});

test("runner CI address is allowed only for GitHub, fixed 5432 and the identical service-container ID", () => {
  assert.equal(expectedDisposablePostgresServerAddress(bound(), "5432", "56451"), address);
  for (const replacement of [{ CI: undefined }, { GITHUB_ACTIONS: "false" }, { [CI_POSTGRES_SERVICE_ID]: undefined },
    { [CI_POSTGRES_SERVICE_ID]: "b".repeat(64) }, { [CI_POSTGRES_BOUND_ID]: undefined },
    { [CI_POSTGRES_BOUND_ADDRESS]: undefined }, { [CI_POSTGRES_BOUND_ADDRESS]: "8.8.8.8" }]) {
    assert.throws(() => expectedDisposablePostgresServerAddress({ ...bound(), ...replacement }, "5432", "56451"), failure);
  }
  assert.throws(() => expectedDisposablePostgresServerAddress(bound(), "5433", "56451"), failure);
});

test("local server assertion remains 127.0.0.1 and refuses every CI identity override", () => {
  for (const localPort of ["56451", "56461"]) {
    assert.equal(expectedDisposablePostgresServerAddress({}, localPort, localPort), "127.0.0.1");
    for (const key of [CI_POSTGRES_SERVICE_ID, CI_POSTGRES_BOUND_ID, CI_POSTGRES_BOUND_ADDRESS]) {
      assert.throws(() => expectedDisposablePostgresServerAddress({ [key]: "" }, localPort, localPort), failure);
    }
  }
});

for (const [folder, flag, portVariable, psqlVariable, localPort, directory] of [
  ["checkout", "CHECKOUT_INTEGRATION_ALLOW_DISPOSABLE_DATABASE", "CHECKOUT_TEST_PORT", "CHECKOUT_TEST_PSQL", "56451", "checkout-test-pg"],
  ["recovery", "RECOVERY_INTEGRATION_ALLOW_DISPOSABLE_DATABASE", "RECOVERY_TEST_PORT", "RECOVERY_TEST_PSQL", "56461", "recovery-test-pg"],
]) {
  test(`${folder} rejects an unbound or malformed CI service identity before spawning psql`, () => {
    for (const value of [undefined, "", "127.0.0.1", `${address},172.19.0.3`]) {
      const env = { ...process.env, ...bound(), [flag]: "1", [portVariable]: "5432", [psqlVariable]: "must-not-start-a-database-client" };
      if (value === undefined) delete env[CI_POSTGRES_BOUND_ADDRESS]; else env[CI_POSTGRES_BOUND_ADDRESS] = value;
      const result = spawnSync(process.execPath, [fileURLToPath(new URL(`./${folder}-integration/run.mjs`, import.meta.url))],
        { env, encoding: "utf8", timeout: 5000, windowsHide: true });
      assert.equal(result.error, undefined); assert.equal(result.status, 1);
      assert.match(result.stderr, /ci_postgres_service_identity_invalid/);
      assert.doesNotMatch(result.stderr, /ENOENT|spawn must-not-start/);
    }
  });
  test(`${folder} keeps fixed loopback, database, port and local directory validation`, () => {
    const source = readFileSync(new URL(`./${folder}-integration/run.mjs`, import.meta.url), "utf8");
    assert.match(source, /--host=127\.0\.0\.1/);
    assert.match(source, new RegExp(`port === "${localPort}"`));
    assert.ok(source.includes(`.runtime/${directory}`));
    assert.match(source, /show data_directory/i);
    assert.match(source, /host\(inet_server_addr\(\)\).*expectedServerAddress/);
    assert.match(source, /Refusing a non-empty database|refusing a nonempty database/);
  });
}
