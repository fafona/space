import { spawnSync } from "node:child_process";
import { types } from "node:util";
import { captureTrustedPython, verifyTrustedPython } from "./production-maintenance-trusted-python.mjs";

// Metadata-only sampling in the current network namespace, not a network lock or
// proof against later privileged changes. No TC/XDP mutation, package install,
// arbitrary interpreter, shell, or automatic retry is permitted here.
const ERROR = "production_maintenance_network_bypass_unverified";
const MAX = 2_097_152;
const LIMIT = 1024;
const ROOT = 0xffffffff;
// Linux sch_generic.c, sch_mq.c and sch_fifo.c have no classifier attachment for
// these kinds. fq_codel is deliberately NOT allowed: sch_fq_codel.c has tcf_block
// and invokes tcf_classify (including actions), even without clsact/ingress.
// https://raw.githubusercontent.com/torvalds/linux/v4.18/net/sched/sch_fq_codel.c
const KINDS = Object.freeze(["noqueue", "mq", "pfifo_fast", "pfifo", "bfifo"]);
const fail = () => { throw new Error(ERROR); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uint = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
const name = (s) => typeof s === "string" && /^[A-Za-z0-9_.:-]{1,15}$/.test(s);

// Python 3.6 compatible. This source is also exercised with an in-memory socket
// in tests. The only emitted netlink request is RTM_GETQDISC + DUMP_INVISIBLE;
// the latter includes hidden mq children rather than assuming they are harmless.
export const NETWORK_BYPASS_PYTHON = String.raw`
import json, socket, struct, sys, time
MAX_BYTES = 2097152
MAX_ROWS = 1024
HEADER = struct.Struct("=IHHII")
TCMSG = struct.Struct("=BBHiIII")
ATTRIBUTE = struct.Struct("=HH")
KINDS = frozenset(("noqueue", "mq", "pfifo_fast", "pfifo", "bfifo"))

def reject():
    raise ValueError("network_bypass_unverified")

def attributes(raw):
    result = {}
    offset = 0
    while offset < len(raw):
        if len(raw) - offset < 4:
            reject()
        length, tag = ATTRIBUTE.unpack_from(raw, offset)
        aligned = (length + 3) & ~3
        if length < 4 or offset + aligned > len(raw):
            reject()
        if tag & 0x4000 or tag & 0x3fff not in (1, 2, 3, 4, 5, 6, 7, 8, 9, 12):
            reject()
        kind = tag & 0x3fff
        if kind in result and kind != 9:
            reject()
        if tag & 0x8000 and kind not in (2, 7, 8):
            reject()
        payload = raw[offset + 4:offset + length]
        if any(raw[offset + length:offset + aligned]):
            reject()
        if kind == 9 and payload:
            reject()
        if kind == 12 and payload != b"\x00":
            reject()
        result[kind] = payload
        offset += aligned
    raw_kind = result.get(1, b"")
    if len(raw_kind) < 2 or len(raw_kind) > 16 or raw_kind[-1:] != b"\x00" or b"\x00" in raw_kind[:-1]:
        reject()
    kind = raw_kind[:-1].decode("ascii", "strict")
    if kind not in KINDS:
        reject()
    return kind

def decode(data, sender, recv_flags, port, sequence):
    if sender != (0, 0) or recv_flags or not data or len(data) > MAX_BYTES:
        reject()
    offset = 0
    rows = []
    done = False
    while offset < len(data):
        if done or len(data) - offset < HEADER.size:
            reject()
        length, kind, flags, seq, pid = HEADER.unpack_from(data, offset)
        aligned = (length + 3) & ~3
        # sockaddr pid=0 authenticates the kernel. The header's destination pid
        # is our bound port ID (not zero), as used by tc_fill_qdisc/netlink_dump.
        if length < HEADER.size or offset + aligned > len(data) or seq != sequence or pid != port or flags != 2:
            reject()
        if any(data[offset + length:offset + aligned]):
            reject()
        payload = data[offset + HEADER.size:offset + length]
        if kind == 3:
            if payload not in (b"", b"\x00\x00\x00\x00"):
                reject()
            done = True
        elif kind == 36:
            if len(payload) < TCMSG.size:
                reject()
            family, pad1, pad2, index, handle, parent, info = TCMSG.unpack_from(payload)
            if family != 0 or pad1 or pad2 or index <= 0:
                reject()
            rows.append({"index": index, "kind": attributes(payload[TCMSG.size:]), "handle": handle, "parent": parent})
        else:
            # Includes NLMSG_ERROR (even ACK), OVERRUN and all non-dump types.
            reject()
        offset += aligned
    return rows, done

def collect(factory=socket.socket, clock=time.monotonic):
    sock = factory(socket.AF_NETLINK, socket.SOCK_RAW, socket.NETLINK_ROUTE)
    try:
        sock.bind((0, 0))
        port, groups = sock.getsockname()
        if type(port) is not int or port <= 0 or port > 0xffffffff or groups != 0:
            reject()
        seq = 1
        body = TCMSG.pack(0, 0, 0, 0, 0, 0, 0) + ATTRIBUTE.pack(4, 10)
        request = HEADER.pack(HEADER.size + len(body), 38, 0x301, seq, port) + body
        deadline = clock() + 4.0
        sock.settimeout(4.0)
        if sock.sendto(request, (0, 0)) != len(request):
            reject()
        rows = []
        seen = set()
        total = 0
        while True:
            remaining = deadline - clock()
            if remaining <= 0:
                reject()
            sock.settimeout(remaining)
            data, ancillary, flags, sender = sock.recvmsg(65536, 0)
            total += len(data)
            if ancillary or total > MAX_BYTES:
                reject()
            part, done = decode(data, sender, flags, port, seq)
            for row in part:
                key = (row["index"], row["handle"], row["parent"])
                if key in seen or len(rows) >= MAX_ROWS:
                    reject()
                seen.add(key)
                rows.append(row)
            if done:
                return {"version": 1, "qdiscs": rows}
    finally:
        sock.close()

if __name__ == "__main__":
    try:
        print(json.dumps(collect(), separators=(",", ":")))
    except BaseException:
        sys.stderr.write("network_bypass_unverified\n")
        sys.exit(1)
`;

function record(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some((key) =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function array(value) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length?.value;
  if (!Number.isInteger(length) || length > LIMIT || Reflect.ownKeys(descriptors).length !== length + 1) fail();
  return Array.from({ length }, (_, index) => {
    if (!descriptors[index]?.enumerable || !Object.hasOwn(descriptors[index], "value")) fail();
    return descriptors[index].value;
  });
}

function validate(value) {
  const proof = record(value, ["version", "links", "qdiscs"]);
  if (proof.version !== 1) fail();
  const links = array(proof.links).map((item) => {
    const row = record(item, ["index", "name", "qdisc", "master", "kind"]);
    if (!uint(row.index) || row.index < 1 || row.index > 0x7fffffff || !name(row.name) || !KINDS.includes(row.qdisc) ||
        (row.master !== null && !name(row.master)) || (row.kind !== null &&
        (typeof row.kind !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(row.kind)))) fail();
    return row;
  });
  const qdiscs = array(proof.qdiscs).map((item) => {
    const row = record(item, ["index", "kind", "handle", "parent"]);
    if (!uint(row.index) || !KINDS.includes(row.kind) || !uint(row.handle) || !uint(row.parent) ||
        row.parent === 0 || !links.some((link) => link.index === row.index)) fail();
    return row;
  });
  if (!links.length || new Set(links.map((row) => row.index)).size !== links.length ||
      new Set(links.map((row) => row.name)).size !== links.length ||
      new Set(qdiscs.map((row) => `${row.index}:${row.handle}:${row.parent}`)).size !== qdiscs.length) fail();
  for (const link of links) {
    if (link.master !== null && (link.master === link.name || !links.some((row) => row.name === link.master))) fail();
    const roots = qdiscs.filter((row) => row.index === link.index && row.parent === ROOT);
    // Do not infer an absent classifier from an ip link qdisc label alone.
    if (roots.length !== 1 || roots[0].kind !== link.qdisc || (link.qdisc !== "mq" &&
        qdiscs.some((row) => row.index === link.index && row.parent !== ROOT))) fail();
  }
  links.sort((a, b) => a.index - b.index);
  qdiscs.sort((a, b) => a.index - b.index || a.parent - b.parent || a.handle - b.handle);
  const result = { version: 1, links, qdiscs };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX) fail();
  return result;
}

export function validateNetworkBypass(value) {
  try { return validate(value); } catch { fail(); }
}

function defaultRun(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", shell: false, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"], ...options,
    env: { PATH: "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C", LC_ALL: "C" } });
  if (result.error || result.signal || result.status !== 0) fail();
  return { stdout: result.stdout, stderr: result.stderr };
}

function dependencies(overrides) {
  if (!overrides || typeof overrides !== "object" || types.isProxy(overrides) || Array.isArray(overrides) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(overrides))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(overrides);
  if (Reflect.ownKeys(descriptors).some((key) => !["run", "capturePython", "verifyPython"].includes(key) ||
      !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value") ||
      typeof descriptors[key].value !== "function" || types.isProxy(descriptors[key].value))) fail();
  return { run: descriptors.run?.value ?? defaultRun, capturePython: descriptors.capturePython?.value ?? captureTrustedPython,
    verifyPython: descriptors.verifyPython?.value ?? verifyTrustedPython };
}

function jsonOutput(d, command, args, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) fail();
  const result = record(d.run(command, args, { timeout: Math.min(6000, remaining), maxBuffer: MAX }), ["stdout", "stderr"]);
  if ([result.stdout, result.stderr].some((s) => typeof s !== "string" || Buffer.byteLength(s) > MAX || s.includes("\0")) ||
      result.stderr.trim() || Date.now() > deadline) fail();
  return JSON.parse(result.stdout);
}

function linksFromJson(value) {
  const scan = (node, depth = 0) => {
    if (depth > 16) fail();
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      if (/xdp/i.test(key) && item !== null) fail();
      scan(item, depth + 1);
    }
  };
  return array(value).map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail();
    scan(row);
    const linkinfo = row.linkinfo;
    if (linkinfo !== undefined && (!linkinfo || typeof linkinfo !== "object" || Array.isArray(linkinfo))) fail();
    return { index: row.ifindex, name: row.ifname, qdisc: row.qdisc, master: row.master ?? null,
      kind: linkinfo?.info_kind ?? null };
  }).sort((a, b) => a.index - b.index);
}

export function captureNetworkBypass(overrides = {}) {
  try {
    const d = dependencies(overrides), deadline = Date.now() + 15_000;
    const first = linksFromJson(jsonOutput(d, "ip", ["-j", "-d", "link", "show"], deadline));
    const python = d.capturePython();
    if (d.verifyPython(python) !== true) fail();
    const dump = record(jsonOutput(d, python.target.path, ["-I", "-S", "-B", "-c", NETWORK_BYPASS_PYTHON], deadline), ["version", "qdiscs"]);
    if (d.verifyPython(python) !== true || dump.version !== 1) fail();
    const second = linksFromJson(jsonOutput(d, "ip", ["-j", "-d", "link", "show"], deadline));
    if (!same(first, second)) fail();
    return validate({ version: 1, links: second, qdiscs: dump.qdiscs });
  } catch { fail(); }
}

export function verifyNetworkBypass(proof, overrides = {}) {
  try {
    const expected = validate(proof);
    if (!same(expected, captureNetworkBypass(overrides))) fail();
    return true;
  } catch { fail(); }
}
