import { createHash } from "node:crypto";
import { isIP } from "node:net";

// Additive nf_tables backend only. No default host dependencies, shell, CLI,
// global flush, save/restore of foreign tables, retry or held certificate.
// The caller freezes Docker/topology and durable operation state separately.
// inet forwarding requires the already-enabled br_netfilter path; we never
// change sysctls. Kernel flow/offload bypasses and unsupported objects reject.
const MAX = 2_097_152;
const PREFIX = "FAOM_";
const PRIORITY = 200;
const ROLES = ["kong", "db", "rest", "auth", "realtime", "storage", "meta", "studio", "functions", "analytics", "vector", "imgproxy", "supavisor"];
const PAIRS = [["kong", "rest"], ["kong", "auth"], ["rest", "db"], ["auth", "db"]];
const FAMILIES = new Set(["ip", "ip6", "inet", "bridge"]);
const STATEMENTS = new Set(["match", "counter", "accept", "drop", "return", "jump", "goto", "reject", "xt"]);
const EXPRESSION_KEYS = new Set(["match", "left", "right", "op", "meta", "key", "ct", "dir", "family", "payload", "protocol", "field", "base", "offset", "len", "set", "concat", "prefix", "addr", "range", "&", "|", "^", "<<", ">>", "binary", "value"]);
const fail = (code = "production_maintenance_nft_unverified") => { throw new Error(code); };
const text = (value, max = MAX) => typeof value === "string" && Buffer.byteLength(value) <= max && !value.includes("\0");
const integer = (value, low = 0, high = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= low && value <= high;
const name = (value) => text(value, 128) && /^[A-Za-z0-9_.:-]+$/.test(value);
const hash = (value) => createHash("sha256").update(value).digest("hex");
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && !["__proto__", "constructor", "prototype"].includes(key) &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
}
const exact = (value, keys) => record(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const keys = (value, required, optional = []) => record(value) && required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
function array(value, max = 30_000) {
  return Array.isArray(value) && value.length <= max && Reflect.ownKeys(value).length === value.length + 1 &&
    Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, i)).every((d) => d?.enumerable && Object.hasOwn(d, "value"));
}
function clone(value, depth = 0, budget = { count: 0 }) {
  if (++budget.count > 200_000 || depth > 40) fail();
  if (value === null || typeof value === "boolean" || text(value) || integer(value, -Number.MAX_SAFE_INTEGER)) return value;
  if (Array.isArray(value)) {
    if (value.length > 30_000 || Reflect.ownKeys(value).length !== value.length + 1) fail();
    return Array.from({ length: value.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(value, i);
      if (!d?.enumerable || !Object.hasOwn(d, "value")) fail();
      return clone(d.value, depth + 1, budget);
    });
  }
  if (!record(value)) fail();
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, clone(value[key], depth + 1, budget)]));
}
const canonical = (value) => JSON.stringify(clone(value));
const same = (left, right) => canonical(left) === canonical(right);
function call(d, command, args, options) {
  const answer = options === undefined ? d.run(command, args) : d.run(command, args, options);
  if (!exact(answer, ["stdout", "stderr"]) || !text(answer.stdout) || !text(answer.stderr) || answer.stderr.trim()) fail();
  return answer.stdout;
}

function matchExpression(value) {
  if (Array.isArray(value)) { for (const item of value) matchExpression(item); return; }
  if (value === null || typeof value !== "object") return;
  // firewalld reverse-path filtering uses a FIB lookup. This is a read-only
  // expression, not a route update: retain its complete fixed-shape semantics.
  // https://netfilter.org/projects/nftables/manpage.html (FIB EXPRESSIONS)
  if (record(value) && Object.hasOwn(value, "fib")) {
    const fib = value.fib;
    if (!exact(value, ["fib"]) || !exact(fib, ["result", "flags"]) || !["oif", "oifname", "type", "check"].includes(fib.result)) fail();
    const flags = typeof fib.flags === "string" ? [fib.flags] : fib.flags;
    if (!array(flags, 3) || !flags.length || new Set(flags).size !== flags.length ||
        flags.some((flag) => !["saddr", "daddr", "mark", "iif", "oif"].includes(flag)) ||
        flags.filter((flag) => ["saddr", "daddr"].includes(flag)).length !== 1 ||
        flags.includes("iif") && flags.includes("oif") || flags.includes("oif") && fib.result !== "type") fail();
    return;
  }
  if (!record(value) || Object.keys(value).some((key) => !EXPRESSION_KEYS.has(key))) fail();
  for (const item of Object.values(value)) matchExpression(item);
}
function statement(value) {
  if (!record(value) || Object.keys(value).length !== 1) fail();
  const [kind, body] = Object.entries(value)[0];
  if (!STATEMENTS.has(kind)) fail("production_maintenance_nft_unsupported");
  if (kind === "counter") {
    if (!exact(body, ["packets", "bytes"]) || ![body.packets, body.bytes].every((n) => Number.isFinite(n) && Number.isInteger(n) && n >= 0)) fail();
    return { counter: { packets: 0, bytes: 0 } };
  }
  if (kind === "match") {
    if (!exact(body, ["left", "op", "right"]) || !["==", "!=", "in", "<", ">", "<=", ">=", "&", "^"].includes(body.op)) fail();
    matchExpression(body.left); matchExpression(body.right);
  }
  if (["accept", "drop", "return"].includes(kind) && body !== null) fail();
  if (["jump", "goto"].includes(kind) && (!exact(body, ["target"]) || !name(body.target))) fail();
  // nft 0.9.3 reports its xt compatibility statements as null. The exact
  // iptables/ip6tables/ebtables-save baselines are mandatory even with no xt.
  if (kind === "xt" && body !== null && (!keys(body, ["type", "name"], ["rev"]) || !["match", "target", "watcher"].includes(body.type) ||
      !name(body.name) || /^(?:FLOWOFFLOAD|TEE|NFQUEUE|QUEUE|TPROXY)$/i.test(body.name) || (Object.hasOwn(body, "rev") && !integer(body.rev)))) fail();
  return clone(value);
}
function normalizeNft(value) {
  // Normalize only statistics of an actual counter statement, before bounded
  // cloning, so harmless uint64 counters need not fit JavaScript's safe range.
  if (!exact(value, ["nftables"]) || !array(value.nftables)) fail();
  const result = [];
  const tables = new Set(), chains = new Set();
  let meta = false;
  for (const entry of value.nftables) {
    if (!record(entry) || Object.keys(entry).length !== 1) fail();
    const [kind, raw] = Object.entries(entry)[0];
    if (kind === "metainfo") {
      if (meta || !keys(raw, ["version", "release_name", "json_schema_version"]) || !text(raw.version, 80) || !text(raw.release_name, 80) || !integer(raw.json_schema_version, 1, 1)) fail();
      meta = true; result.push(clone(entry)); continue;
    }
    if (!["table", "chain", "rule"].includes(kind)) fail("production_maintenance_nft_unsupported");
    if (!record(raw) || !FAMILIES.has(raw.family) || !name(raw.table ?? raw.name) || !integer(raw.handle, 1)) fail();
    if (kind === "table") {
      if (!keys(raw, ["family", "name", "handle"], ["flags", "comment"]) || (raw.flags !== undefined && (!Array.isArray(raw.flags) || raw.flags.length)) ||
          tables.has(`${raw.family}:${raw.name}`)) fail();
      tables.add(`${raw.family}:${raw.name}`); result.push(clone(entry)); continue;
    }
    if (!tables.has(`${raw.family}:${raw.table}`)) fail();
    if (kind === "chain") {
      if (!keys(raw, ["family", "table", "name", "handle"], ["type", "hook", "prio", "policy", "dev", "comment"]) || !name(raw.name) || chains.has(`${raw.family}:${raw.table}:${raw.name}`)) fail();
      const base = ["type", "hook", "prio", "policy"].filter((key) => Object.hasOwn(raw, key));
      if (base.length && (base.length !== 4 || !["filter", "nat", "route"].includes(raw.type) ||
          !["input", "forward", "output", "prerouting", "postrouting"].includes(raw.hook) || !integer(raw.prio, -2147483648, 2147483647) || !["accept", "drop"].includes(raw.policy))) fail();
      if (raw.dev !== undefined) fail("production_maintenance_nft_unsupported");
      chains.add(`${raw.family}:${raw.table}:${raw.name}`); result.push(clone(entry)); continue;
    }
    if (!keys(raw, ["family", "table", "chain", "handle", "expr"], ["comment"]) || !name(raw.chain) ||
        !chains.has(`${raw.family}:${raw.table}:${raw.chain}`) || !array(raw.expr, 128)) fail();
    result.push(clone({ rule: { ...raw, expr: raw.expr.map(statement) } }));
  }
  if (!meta || !tables.size || !chains.size) fail();
  return { nftables: result };
}
function saveTokens(line) {
  const tokens = [];
  for (let i = 0; i < line.length;) {
    if (/\s/.test(line[i])) { i++; continue; }
    const start = i; let quote = null;
    while (i < line.length && (quote || !/\s/.test(line[i]))) {
      if (line[i] === "\\") { i += 2; if (i > line.length) fail(); continue; }
      if (quote) { if (line[i] === quote) quote = null; }
      else if (line[i] === '"' || line[i] === "'") quote = line[i];
      i++;
    }
    if (quote) fail();
    tokens.push({ start, end: i, raw: line.slice(start, i) });
  }
  return tokens;
}
function normalizeSave(value, bridge = false) {
  if (!text(value) || /\r(?!\n)/.test(value)) fail();
  const rows = value.trim().split(/\r?\n/);
  if (rows.length > 20_000) fail();
  let table = false, count = 0;
  return rows.map((line) => {
    if (!line) return line;
    if (/^# Generated by (?:ip6?tables-save|ebtables-save) v[0-9][^\r\n]*$/.test(line)) return line.replace(/ on .+$/, "");
    // ebtables-save 1.8.4 terminates each table with Completed, without COMMIT.
    // Keep iptables/ip6tables COMMIT mandatory; do not infer an EOF boundary.
    if (/^# Completed(?: on .+)?$/.test(line)) { if (bridge) table = false; return "# Completed"; }
    if (/^\*[A-Za-z0-9_-]+$/.test(line)) { if (table) fail(); table = true; count++; return line; }
    if (line === "COMMIT") { if (!table) fail(); table = false; return line; }
    if (!table) fail();
    if (/^:[A-Za-z0-9_.:-]+ (?:ACCEPT|DROP|RETURN|-)(?: \[[0-9]+:[0-9]+\])?$/.test(line)) return line.replace(/\[[0-9]+:[0-9]+\]$/, "[0:0]");
    const tokens = saveTokens(line), replacements = [];
    let at = 0;
    if (/^\[[0-9]+:[0-9]+\]$/.test(tokens[0]?.raw)) { replacements.push({ ...tokens[0], value: "[0:0]" }); at++; }
    if (tokens[at]?.raw !== "-A" || !name(tokens[at + 1]?.raw)) fail();
    for (let i = at + 2; i < tokens.length; i++) {
      if (["-j", "--jump", "-g", "--goto", "-m", "--match"].includes(tokens[i].raw) && /^(?:FLOWOFFLOAD|TEE|NFQUEUE|QUEUE|TPROXY|bpf)$/i.test(tokens[i + 1]?.raw || "")) fail("production_maintenance_nft_unsupported");
      if (tokens[i].raw === "-c" || tokens[i].raw === "--set-counters") {
        if (!/^[0-9]+$/.test(tokens[i + 1]?.raw || "") || !/^[0-9]+$/.test(tokens[i + 2]?.raw || "")) fail();
        replacements.push({ ...tokens[++i], value: "0" }, { ...tokens[++i], value: "0" });
      }
    }
    let result = line;
    for (const item of replacements.reverse()) result = result.slice(0, item.start) + item.value + result.slice(item.end);
    return result;
  }).join("\n") + (() => { if (table || !count) fail(); return ""; })();
}
function safeBaseline(firewall) {
  for (const entry of firewall.baseline.nftables) {
    const item = entry.table || entry.chain || entry.rule;
    if (!item) continue;
    if ((entry.table ? item.name : item.table).startsWith(PREFIX)) fail();
    if (entry.chain && ["ip", "ip6", "inet"].includes(item.family) && ["input", "forward"].includes(item.hook) && item.prio >= PRIORITY) fail("production_maintenance_nft_priority_unsupported");
  }
}
function capture(d) {
  try {
    const result = { backend: "nft", version: 1,
      nftVersion: call(d, "nft", ["--version"]).trim(), version4: call(d, "iptables", ["--version"]).trim(), version6: call(d, "ip6tables", ["--version"]).trim(),
      saveVersion4: call(d, "iptables-save", ["--version"]).trim(), saveVersion6: call(d, "ip6tables-save", ["--version"]).trim(), saveVersionBridge: call(d, "ebtables-save", ["--version"]).trim(),
      bridge4: d.readText("/proc/sys/net/bridge/bridge-nf-call-iptables").trim(), bridge6: d.readText("/proc/sys/net/bridge/bridge-nf-call-ip6tables").trim(),
      baseline: normalizeNft(JSON.parse(call(d, "nft", ["-j", "-a", "-n", "list", "ruleset"]))),
      legacy4: normalizeSave(call(d, "iptables-save", ["-c"])), legacy6: normalizeSave(call(d, "ip6tables-save", ["-c"])), legacyBridge: normalizeSave(call(d, "ebtables-save", []), true) };
    return validateSnapshot(result);
  } catch { fail(); }
}
function validateSnapshot(value) {
  if (!exact(value, ["backend", "version", "nftVersion", "version4", "version6", "saveVersion4", "saveVersion6", "saveVersionBridge", "bridge4", "bridge6", "baseline", "legacy4", "legacy6", "legacyBridge"]) ||
      value.backend !== "nft" || value.version !== 1 || !/^nftables v(?:0\.9\.3|1\.0\.[0-9]+)(?: \([^\r\n]*\))?$/.test(value.nftVersion) ||
      !/^iptables v1\.8\.[0-9]+ \(nf_tables\)$/.test(value.version4) || value.version6 !== value.version4.replace(/^iptables/, "ip6tables") ||
      value.saveVersion4 !== value.version4.replace(/^iptables/, "iptables-save") || value.saveVersion6 !== value.version4.replace(/^iptables/, "ip6tables-save") ||
      value.saveVersionBridge !== value.version4.replace(/^iptables/, "ebtables-save") || value.bridge4 !== "1" || value.bridge6 !== "1") fail();
  const result = clone({ ...value, baseline: normalizeNft(value.baseline) });
  if (result.baseline.nftables.find((row) => row.metainfo)?.metainfo.version !== value.nftVersion.match(/^nftables v([^ ]+)/)[1]) fail();
  if (!["legacy4", "legacy6", "legacyBridge"].every((key) => normalizeSave(value[key], key === "legacyBridge") === value[key])) fail();
  if (Buffer.byteLength(JSON.stringify(result)) > MAX * 4) fail();
  return result;
}
export function captureNftFirewall(d) { const result = capture(d); safeBaseline(result); return result; }
export function validateNftFirewall(value) { const result = validateSnapshot(value); safeBaseline(result); return result; }

function buildPlan(input, docker) {
  if (!record(input) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input.operationId) || !integer(input.appPort, 1, 65535) ||
      !record(docker) || !/^[A-Za-z0-9_-]{1,15}$/.test(docker.bridge) || !Array.isArray(docker.containers) || docker.containers.length !== ROLES.length) fail();
  const containers = docker.containers.map((row) => {
    if (!record(row) || !ROLES.includes(row.service) || isIP(row.address) !== 4 || !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(row.address) ||
        !Array.isArray(row.publishedPorts) || !row.publishedPorts.every((n) => integer(n, 1, 65535))) fail();
    return { service: row.service, address: row.address, publishedPorts: [...new Set(row.publishedPorts)].sort((a, b) => a - b) };
  }).sort((a, b) => a.service.localeCompare(b.service));
  if (new Set(containers.map((row) => row.service)).size !== ROLES.length || new Set(containers.map((row) => row.address)).size !== ROLES.length) fail();
  const inputPorts = [...new Set([input.appPort, ...containers.flatMap((row) => row.publishedPorts)])].sort((a, b) => a - b);
  if (inputPorts.some((n) => [22, 80, 443].includes(n))) fail();
  const tableName = PREFIX + hash(input.operationId).slice(0, 16);
  const declarations = [`create table inet ${tableName}`, `add chain inet ${tableName} input { type filter hook input priority ${PRIORITY}; policy accept; }`,
    `add chain inet ${tableName} forward { type filter hook forward priority ${PRIORITY}; policy accept; }`];
  const address = (role) => containers.find((row) => row.service === role).address;
  const rules = inputPorts.map((n) => ({ chain: "input", text: `iifname != "lo" meta l4proto tcp tcp dport ${n} drop` }));
  for (const [from, to] of PAIRS) {
    const match = `iifname "${docker.bridge}" oifname "${docker.bridge}"`;
    rules.push({ chain: "forward", text: `${match} ip saddr ${address(from)} ip daddr ${address(to)} accept` });
    rules.push({ chain: "forward", text: `${match} ip saddr ${address(to)} ip daddr ${address(from)} ct state established ct direction reply accept` });
  }
  for (const row of containers) rules.push({ chain: "forward", text: `ip daddr ${row.address} drop` });
  return { version: 1, operationId: input.operationId, appPort: input.appPort, tableName, priority: PRIORITY, bridge: docker.bridge, containers, inputPorts,
    script: declarations.concat(rules.map((rule) => `add rule inet ${tableName} ${rule.chain} ${rule.text}`)).join("\n") + "\n" };
}
export function planNftFirewall(proof) { const copy = clone(proof); return buildPlan(copy.input, copy.docker); }
function validatePlan(value) {
  const copy = clone(value);
  if (!record(copy)) fail();
  const plan = buildPlan({ operationId: copy.operationId, appPort: copy.appPort }, { bridge: copy.bridge, containers: copy.containers });
  if (!same(copy, plan)) fail();
  return plan;
}
const match = (left, right, op = "==") => ({ match: { op, left, right } });
const meta = (key) => ({ meta: { key } });
const payload = (protocol, field) => ({ payload: { protocol, field } });
function expectedOwned(plan) {
  const rows = [{ table: { family: "inet", name: plan.tableName } },
    ...["input", "forward"].map((name) => ({ chain: { family: "inet", table: plan.tableName, name, type: "filter", hook: name, prio: PRIORITY, policy: "accept" } }))];
  const rule = (chain, expr) => rows.push({ rule: { family: "inet", table: plan.tableName, chain, expr } });
  for (const n of plan.inputPorts) rule("input", [match(meta("iifname"), "lo", "!="), match(meta("l4proto"), "tcp"), match(payload("tcp", "dport"), n), { drop: null }]);
  const address = (role) => plan.containers.find((row) => row.service === role).address;
  for (const [from, to] of PAIRS) {
    const interfaces = [match(meta("iifname"), plan.bridge), match(meta("oifname"), plan.bridge)];
    rule("forward", [...interfaces, match(payload("ip", "saddr"), address(from)), match(payload("ip", "daddr"), address(to)), { accept: null }]);
    rule("forward", [...interfaces, match(payload("ip", "saddr"), address(to)), match(payload("ip", "daddr"), address(from)),
      match({ ct: { key: "state" } }, "established", "in"), match({ ct: { key: "direction" } }, "reply"), { accept: null }]);
  }
  for (const row of plan.containers) rule("forward", [match(payload("ip", "daddr"), row.address), { drop: null }]);
  return rows;
}
function splitOwned(snapshot, plan) {
  const owned = [], baseline = [];
  for (const entry of snapshot.baseline.nftables) {
    const item = entry.table || entry.chain || entry.rule;
    if (item?.family === "inet" && (entry.table ? item.name : item.table) === plan.tableName) {
      const kind = Object.keys(entry)[0], value = { ...item }; delete value.handle;
      owned.push({ [kind]: value });
    } else baseline.push(entry);
  }
  return { owned, rest: { ...snapshot, baseline: { nftables: baseline } } };
}
function normalizeOwnedReadback(rows, plan) {
  // Numeric nft output uses NF_CT_STATE_BIT(IP_CT_ESTABLISHED) == 2 and
  // IP_CT_DIR_REPLY == 1 (Linux UAPI nf_conntrack_common/tuple_common.h).
  // nft also elides the redundant l4proto dependency of a typed tcp dport.
  // Only these exact own-rule spellings are equivalent; raw/th/udp payloads,
  // other numbers/operators, extra predicates and missing verdicts stay unequal.
  // https://netfilter.org/projects/nftables/manpage.html (RAW PAYLOAD EXPRESSION)
  // Never apply this representation normalization to the frozen foreign rules.
  return rows.map((entry) => {
    if (!entry.rule) return entry;
    const rule = entry.rule;
    let expr = rule.expr.map((item) => {
      if (same(item, match({ ct: { key: "state" } }, 2, "in"))) return match({ ct: { key: "state" } }, "established", "in");
      if (same(item, match({ ct: { key: "direction" } }, 1))) return match({ ct: { key: "direction" } }, "reply");
      return item;
    });
    if (rule.chain === "input" && expr.length === 3 &&
        same(expr[0], match(meta("iifname"), "lo", "!=")) && same(expr[2], { drop: null }) &&
        plan.inputPorts.some((port) => same(expr[1], match(payload("tcp", "dport"), port)))) {
      expr = [expr[0], match(meta("l4proto"), "tcp"), expr[1], expr[2]];
    }
    return { rule: { ...rule, expr } };
  });
}
function state(frozen, plan, d) {
  const result = splitOwned(capture(d), plan);
  if (!same(result.rest, frozen)) fail("production_maintenance_nft_baseline_changed");
  // Listing interleaves chains and their rules; only rule order WITHIN a chain
  // is semantic. Never sort rules within their chain.
  const order = (rows) => [...rows].sort((a, b) => {
    const key = (entry) => entry.table ? "0" : entry.chain ? `1:${entry.chain.name}` : `2:${entry.rule.chain}`;
    return key(a).localeCompare(key(b));
  });
  if (result.owned.length && !same(order(normalizeOwnedReadback(result.owned, plan)), order(expectedOwned(plan)))) fail("production_maintenance_nft_owned_table_changed");
  return result.owned.length > 0;
}
export function installNftFirewall(rawFrozen, rawPlan, d) {
  const frozen = validateNftFirewall(rawFrozen), plan = validatePlan(rawPlan);
  if (!state(frozen, plan, d)) {
    // create is fail-if-present. A lost reply never triggers a second mutation.
    call(d, "nft", ["-f", "-"], { input: plan.script });
  }
  if (!state(frozen, plan, d)) fail();
  return { verified: true };
}
export function checkNftFirewall(rawFrozen, rawPlan, d) {
  const frozen = validateNftFirewall(rawFrozen), plan = validatePlan(rawPlan);
  return { installed: state(frozen, plan, d) };
}
export function verifyNftFirewall(rawFrozen, rawPlan, d) {
  const frozen = validateNftFirewall(rawFrozen), plan = validatePlan(rawPlan);
  if (!state(frozen, plan, d)) fail();
  return { verified: true };
}
export function restoreNftFirewall(rawFrozen, rawPlan, d) {
  const frozen = validateNftFirewall(rawFrozen), plan = validatePlan(rawPlan);
  if (!state(frozen, plan, d)) fail();
  call(d, "nft", ["-f", "-"], { input: `delete table inet ${plan.tableName}\n` });
  if (state(frozen, plan, d)) fail();
  return { restored: true };
}
