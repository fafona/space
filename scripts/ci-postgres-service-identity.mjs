import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CI_POSTGRES_SERVICE_ID = "FAOLLA_CI_POSTGRES_SERVICE_CONTAINER_ID";
export const CI_POSTGRES_BOUND_ID = "FAOLLA_CI_POSTGRES_CONTAINER_ID";
export const CI_POSTGRES_BOUND_ADDRESS = "FAOLLA_CI_POSTGRES_SERVER_IPV4";
const invalid = "ci_postgres_service_identity_invalid";
const containerIdPattern = /^[a-f0-9]{64}$/;
const inspectFormat = '{"id":{{json .Id}},"networks":{{json .NetworkSettings.Networks}}}';
function fail() { throw new Error(invalid); }
function containerId(value) { return typeof value === "string" && value.length === 64 && containerIdPattern.test(value); }
function privateIpv4(value) {
  if (typeof value !== "string" || value !== value.trim() || value.length > 15 ||
      !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const bytes = value.split(".").map(Number);
  return bytes.every((byte) => byte <= 255) &&
    (bytes[0] === 10 || (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
      (bytes[0] === 192 && bytes[1] === 168));
}

export function parseCiPostgresServiceIdentity(output, expectedContainerId) {
  try {
    if (!containerId(expectedContainerId) || typeof output !== "string" ||
        Buffer.byteLength(output, "utf8") > 65_536) fail();
    const parsed = JSON.parse(output);
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join(",") !== "id,networks" ||
        parsed.id !== expectedContainerId || !parsed.networks || typeof parsed.networks !== "object" ||
        Array.isArray(parsed.networks)) fail();
    const networks = Object.values(parsed.networks);
    if (networks.length !== 1 || !networks[0] || typeof networks[0] !== "object" || Array.isArray(networks[0]) ||
        !privateIpv4(networks[0].IPAddress)) fail();
    return { containerId: expectedContainerId, serverAddress: networks[0].IPAddress };
  } catch { return fail(); }
}

/** Only a GitHub service-container identity captured by the preceding inspect
 * step may replace the server-side address assertion. The client connection is
 * still fixed loopback and the runner still verifies its fixed empty database.
 */
export function expectedDisposablePostgresServerAddress(environment, port, localPort) {
  const keys = [CI_POSTGRES_SERVICE_ID, CI_POSTGRES_BOUND_ID, CI_POSTGRES_BOUND_ADDRESS];
  if (port === localPort) {
    if (keys.some((key) => environment[key] !== undefined)) fail();
    return "127.0.0.1";
  }
  if (port !== "5432" || environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true" ||
      !containerId(environment[CI_POSTGRES_BOUND_ID]) ||
      !privateIpv4(environment[CI_POSTGRES_BOUND_ADDRESS]) ||
      environment[CI_POSTGRES_SERVICE_ID] !== environment[CI_POSTGRES_BOUND_ID]) fail();
  return environment[CI_POSTGRES_BOUND_ADDRESS];
}

export function bindCiPostgresServiceIdentity({ environment = process.env,
  inspect = (args) => spawnSync("docker", args, { encoding: "utf8", windowsHide: true,
    timeout: 10_000, maxBuffer: 65_536 }),
  writeEnvironment = (target, content) => appendFileSync(target, content, "utf8"),
} = {}) {
  try {
    const id = environment[CI_POSTGRES_SERVICE_ID];
    const target = environment.GITHUB_ENV;
    if (environment.CI !== "true" || environment.GITHUB_ACTIONS !== "true" ||
        !containerId(id) || typeof target !== "string" || !path.isAbsolute(target) ||
        /[\r\n\0]/.test(target) || environment[CI_POSTGRES_BOUND_ID] !== undefined ||
        environment[CI_POSTGRES_BOUND_ADDRESS] !== undefined) fail();
    const result = inspect(["inspect", "--type=container", "--format", inspectFormat, id]);
    if (!result || result.error || result.signal || result.status !== 0) fail();
    const captured = parseCiPostgresServiceIdentity(result.stdout, id);
    writeEnvironment(target, `${CI_POSTGRES_BOUND_ID}=${captured.containerId}\n${CI_POSTGRES_BOUND_ADDRESS}=${captured.serverAddress}\n`);
    return captured;
  } catch { return fail(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail();
    bindCiPostgresServiceIdentity();
    console.log("[ci-postgres] service identity bound");
  } catch {
    console.error(`[ci-postgres] ${invalid}`);
    process.exitCode = 1;
  }
}
