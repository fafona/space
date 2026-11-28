// Independent, default-off application candidate; never imported by frozen src.
import { createHash, X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { createServerMerchantCheckoutRuntimeClient as createEnv } from "../../src/lib/merchantCheckoutRuntime.server";
import { createPgRuntimeCore, type PgClient, type PgGate } from "./merchant-checkout-pg-core";

type Environment = Record<string, string | undefined>;
type Options = { environment?: Environment; fetch?: typeof fetch; now?: () => number; timeoutMs?: number };
export const pgLoginRole = "faolla_checkout_runtime_login";
function privateAddress(host: string) {
  if (host === "::1") return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
  }
  return false;
}
export function pgRuntimeConfiguration(environment: Environment, timeout: number) {
  try {
    if (typeof window !== "undefined" || !Number.isInteger(timeout) || timeout < 1 || timeout > 12000) return null;
    const host = environment.FAOLLA_CHECKOUT_PG_HOST ?? "", portText = environment.FAOLLA_CHECKOUT_PG_PORT ?? "";
    const database = environment.FAOLLA_CHECKOUT_PG_DATABASE ?? "", user = environment.FAOLLA_CHECKOUT_PG_USER ?? "", password = environment.FAOLLA_CHECKOUT_PG_PASSWORD ?? "";
    if (!privateAddress(host) || !/^[1-9][0-9]{0,4}$/.test(portText) || Number(portText) > 65535 || !/^[a-z][a-z0-9_]{0,62}$/.test(database)
      || user !== pgLoginRole || password.length < 32 || password.length > 512 || /[\r\n\u0000]/.test(password)) return null;
    const policy = environment.FAOLLA_CHECKOUT_PG_TLS, ca = environment.FAOLLA_CHECKOUT_PG_CA_PEM ?? "";
    let ssl: false | { ca: string; rejectUnauthorized: true; minVersion: "TLSv1.2" };
    if (policy === "disabled-loopback" && ["127.0.0.1", "::1"].includes(host) && ca === "") ssl = false;
    else if (policy === "verify-full" && ca.length <= 65536 && /^-----BEGIN CERTIFICATE-----/.test(ca)) {
      const certificate = new X509Certificate(ca);
      if (!certificate.ca) return null;
      ssl = { ca, rejectUnauthorized: true, minVersion: "TLSv1.2" };
    } else return null;
    // Every connection identity/transport field is explicit. No PG* defaults,
    // connection URI, .pgpass, SSL downgrade or user-selected role/SQL options.
    const config = { host, port: Number(portText), database, user, password, ssl, options: "", client_encoding: "UTF8", sslnegotiation: "postgres", pipeline: false,
      connectionTimeoutMillis: Math.min(timeout, 3000), query_timeout: timeout, statement_timeout: timeout, lock_timeout: Math.min(timeout, 1000),
      idle_in_transaction_session_timeout: timeout, application_name: "faolla-checkout-pg" };
    return { config, binding: createHash("sha256").update(JSON.stringify(config)).digest("hex") };
  } catch { return null; }
}
const gateKey = Symbol.for("faolla.checkout.pg.bounded-clients.v1");
function processGate(): PgGate | null {
  const globals = globalThis as typeof globalThis & { [gateKey]?: PgGate };
  if (!Object.hasOwn(globals, gateKey)) Object.defineProperty(globals, gateKey, { value: Object.seal({ active: 0 }), writable: false });
  const gate = globals[gateKey];
  return gate && Number.isInteger(gate.active) && gate.active >= 0 && gate.active <= 4 ? gate : null;
}
export function createServerMerchantCheckoutRuntimeClient(options: Options = {}) {
  const environment = options.environment ?? process.env, transport = environment.FAOLLA_CHECKOUT_TRANSPORT;
  if (transport === undefined || transport === "env") return createEnv(options);
  if (transport !== "postgres") return null;
  const timeout = options.timeoutMs ?? 12000, configured = pgRuntimeConfiguration(environment, timeout), gate = processGate();
  if (!configured || !gate) return null;
  return createPgRuntimeCore({ timeoutMs: timeout, gate,
    current: () => environment.FAOLLA_CHECKOUT_TRANSPORT === "postgres" && pgRuntimeConfiguration(environment, timeout)?.binding === configured.binding,
    clientFactory: () => {
      // Server-only dependency, declared in the separate candidate manifest.
      const pg = createRequire(import.meta.url)("pg") as { Client: new (config: unknown) => PgClient };
      return new pg.Client(configured.config);
    },
  });
}
