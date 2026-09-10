import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { captureNetworkBypass, NETWORK_BYPASS_PYTHON, validateNetworkBypass, verifyNetworkBypass } from "./production-maintenance-network-bypass.mjs";

const ERROR = /^Error: production_maintenance_network_bypass_unverified$/;
const ROOT = 0xffffffff;
const clone = (value) => structuredClone(value);
const link = (index = 1, qdisc = "noqueue") => ({ ifindex: index, ifname: index === 1 ? "lo" : "eth0", qdisc, xdp: null });
const row = (index = 1, kind = "noqueue", parent = ROOT, handle = 0) => ({ index, kind, handle, parent });
function fixture({ links = [link()], qdiscs = [row()], after = links } = {}) {
  const calls = [];
  let reads = 0, verifies = 0;
  const python = { target: { path: "/usr/bin/python3.6" } };
  const overrides = {
    capturePython() { calls.push("capture-python"); return python; },
    verifyPython(proof) { assert.equal(proof, python); calls.push("verify-python"); verifies++; return true; },
    run(command, args, options) {
      calls.push(command);
      assert.ok(options.timeout > 0 && options.timeout <= 6000);
      assert.equal(options.maxBuffer, 2097152);
      if (command === "ip") {
        assert.deepEqual(args, ["-j", "-d", "link", "show"]);
        return { stdout: JSON.stringify(reads++ === 0 ? links : after), stderr: "" };
      }
      assert.equal(command, python.target.path);
      assert.deepEqual(args, ["-I", "-S", "-B", "-c", NETWORK_BYPASS_PYTHON]);
      return { stdout: JSON.stringify({ version: 1, qdiscs }), stderr: "" };
    },
  };
  return { overrides, calls, get verifies() { return verifies; } };
}

test("one read-only dump between two full link samples with trusted Python pre/post checks", () => {
  const f = fixture();
  assert.deepEqual(captureNetworkBypass(f.overrides), { version: 1,
    links: [{ index: 1, name: "lo", qdisc: "noqueue", master: null, kind: null }], qdiscs: [row()] });
  assert.deepEqual(f.calls, ["ip", "capture-python", "verify-python", "/usr/bin/python3.6", "verify-python", "ip"]);
  assert.equal(f.verifies, 2);
});

test("all interfaces, master names and mq child queues are preserved and sorted", () => {
  const links = [link(2, "mq"), { ...link(), master: "eth0", linkinfo: { info_kind: "veth" } }];
  const qdiscs = [row(2, "pfifo_fast", 2), row(2, "mq"), row(), row(2, "bfifo", 1)];
  const proof = captureNetworkBypass(fixture({ links, qdiscs }).overrides);
  assert.equal(proof.links[0].master, "eth0");
  assert.equal(proof.links[0].kind, "veth");
  assert.deepEqual(proof.qdiscs.map((r) => r.parent), [ROOT, 1, 2, ROOT]);
  assert.deepEqual(validateNetworkBypass(proof), proof);
});

for (const kind of ["ingress", "clsact", "fq_codel", "cake", "unknown"]) {
  test(`rejects classifier-capable or unknown ${kind} even when ip says noqueue`, () => {
    assert.throws(() => captureNetworkBypass(fixture({ qdiscs: [row(), row(1, kind, 1)] }).overrides), ERROR);
  });
}

for (const attachment of [{ xdp: {} }, { xdpgeneric: true }, { xdpdrv: 42 }, { xdpoffload: { id: 1 } },
  { linkinfo: { info_kind: "veth", info_data: { xdp: { attached: 1 } } } }]) {
  test(`rejects XDP attachment ${Object.keys(attachment)[0]}`, () => {
    const f = fixture({ links: [{ ...link(), ...attachment }] });
    assert.throws(() => captureNetworkBypass(f.overrides), ERROR);
    assert.deepEqual(f.calls, ["ip"]);
  });
}

test("rejects duplicate indices/names, orphan queues, missing roots and root-kind mismatch", () => {
  for (const input of [{ links: [link(), link()] }, { links: [link(), { ...link(2), ifname: "lo" }] },
    { qdiscs: [row(), row(3)] }, { qdiscs: [] }, { qdiscs: [row(1, "pfifo")] },
    { qdiscs: [row(), row()] }, { links: [{ ...link(), master: "missing" }] }, { links: [] }]) {
    assert.throws(() => captureNetworkBypass(fixture(input).overrides), ERROR);
  }
});

test("identity or XDP drift rejects the entire capture", () => {
  for (const after of [[{ ...link(), ifname: "replacement" }], [link(), link(2)], [{ ...link(), xdp: { id: 1 } }]]) {
    assert.throws(() => captureNetworkBypass(fixture({ after }).overrides), ERROR);
  }
});

test("interpreter pre-check failure causes zero execution; post-check failure cannot return proof", () => {
  for (const failAt of [1, 2]) {
    const f = fixture();
    let checks = 0;
    f.overrides.verifyPython = () => { if (++checks === failAt) throw new Error("SECRET-PATH"); return true; };
    assert.throws(() => captureNetworkBypass(f.overrides), ERROR);
    assert.equal(f.calls.filter((c) => c === "/usr/bin/python3.6").length, failAt - 1);
  }
});

test("fixed errors redact command stderr, invalid JSON, over-limit bytes and thrown errors", () => {
  for (const run of [() => { throw new Error("SECRET"); }, () => ({ stdout: "SECRET", stderr: "" }),
    () => ({ stdout: "[]", stderr: "SECRET" }), () => ({ stdout: " ".repeat(2097153), stderr: "" }),
    () => ({ stdout: "[]", stderr: "", secret: "SECRET" })]) {
    assert.throws(() => captureNetworkBypass({ ...fixture().overrides, run }), ERROR);
  }
});

test("strict detached proof rejects unknown keys, accessors, proxies, holes and large lists", () => {
  const proof = captureNetworkBypass(fixture().overrides);
  let read = false;
  const getter = { ...proof };
  Object.defineProperty(getter, "links", { enumerable: true, get() { read = true; return []; } });
  for (const bad of [{ ...proof, raw: "SECRET" }, getter, new Proxy(proof, {}),
    { ...proof, links: new Proxy(proof.links, {}) }, { ...proof, links: new Array(1) },
    { ...proof, links: Array(1025).fill(proof.links[0]) }, { ...proof, qdiscs: [{ ...row(), handle: -1 }] }]) {
    assert.throws(() => validateNetworkBypass(bad), ERROR);
  }
  assert.equal(read, false);
  const detached = validateNetworkBypass(proof);
  proof.links[0].name = "mutated";
  assert.equal(detached.links[0].name, "lo");
});

test("verify captures expected proof before callback and rejects changed network", () => {
  const proof = captureNetworkBypass(fixture().overrides), f = fixture();
  const original = f.overrides.run;
  f.overrides.run = (...args) => { proof.links[0].name = "mutated"; return original(...args); };
  assert.equal(verifyNetworkBypass(proof, f.overrides), true);
  const expected = captureNetworkBypass(fixture().overrides);
  assert.throws(() => verifyNetworkBypass(expected,
    fixture({ links: [{ ...link(), linkinfo: { info_kind: "bridge" } }] }).overrides), ERROR);
});

test("dependency injection is bounded; no accessor execution or arbitrary option fallback", () => {
  for (const overrides of [{ path: "/tmp/python" }, new Proxy({}, {}), { run: "not function" },
    Object.defineProperty({}, "run", { enumerable: true, get() { throw new Error("must not read"); } })]) {
    assert.throws(() => captureNetworkBypass(overrides), ERROR);
  }
});

test("actual Python decoder rejects malformed netlink frames; fake socket sends exactly one GET", () => {
  // Executes the production decoder, but all sockets below are in-memory fakes.
  // No connection, system network inspection or TC mutation occurs in this test.
  const script = `import socket, struct, sys\nns = {"__name__": "fixture"}\nexec(${JSON.stringify(NETWORK_BYPASS_PYTHON)}, ns)\n` + String.raw`
socket.AF_NETLINK = getattr(socket, "AF_NETLINK", 16)
socket.NETLINK_ROUTE = getattr(socket, "NETLINK_ROUTE", 0)
H = struct.Struct("=IHHII")
T = struct.Struct("=BBHiIII")
def attr(tag, payload):
    raw = struct.pack("=HH", len(payload) + 4, tag) + payload
    return raw + b"\x00" * ((-len(raw)) % 4)
def msg(kind=36, payload=None, flags=2, seq=1, pid=77):
    if payload is None:
        payload = T.pack(0,0,0,1,0,0xffffffff,2) + attr(1, b"noqueue\x00") + attr(12, b"\x00")
    raw = H.pack(16 + len(payload), kind, flags, seq, pid) + payload
    return raw + b"\x00" * ((-len(raw)) % 4)
good = msg()
done = msg(3, b"\x00" * 4)
assert ns["decode"](good + done, (0,0), 0, 77, 1) == ([{"index":1,"kind":"noqueue","handle":0,"parent":0xffffffff}], True)
def bad(frame, sender=(0,0), flags=0):
    try:
        ns["decode"](frame, sender, flags, 77, 1)
    except (ValueError, UnicodeError):
        return
    raise AssertionError("accepted malformed frame")
for frame in [b"", good[:15], good[:-1], good + b"x", done + good, msg(flags=2|16), msg(flags=2|32),
              msg(seq=2), msg(pid=0), msg(2, b"\x00"*4), msg(4, b""), msg(3, struct.pack("=i", -1)),
              msg(3,b"\x00"), msg(payload=T.pack(0,0,0,0,0,0xffffffff,0)+attr(1,b"noqueue\x00")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"fq_codel\x00")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"noqueue\x00")+attr(13,b"\x00"*4)),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"noqueue\x00")+attr(14,b"\x01"*4)),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"noqueue\x00")+attr(12,b"\x01")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"noqueue\x00")+attr(1,b"noqueue\x00")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(1,b"noqueue")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+attr(0x8001,b"noqueue\x00")),
              msg(payload=T.pack(0,0,0,1,0,0xffffffff,0)+struct.pack("=HH",3,1)),
              b"x" * (2097152 + 1)]:
    bad(frame)
bad(good, (1,0))
bad(good, (0,1))
bad(good, (0,0), 32)
bad(good, (0,0), 8)
class Fake:
    def __init__(self, packets): self.packets=list(packets); self.sent=[]; self.closed=False
    def bind(self, address): assert address == (0,0)
    def getsockname(self): return (77,0)
    def settimeout(self, timeout): assert 0 < timeout <= 4
    def sendto(self, request, address):
        assert address == (0,0)
        assert H.unpack_from(request) == (40,38,0x301,1,77)
        assert request[16:36] == T.pack(0,0,0,0,0,0,0)
        assert request[36:] == struct.pack("=HH",4,10)
        self.sent.append(request)
        return len(request)
    def recvmsg(self, size, ancillary):
        assert (size, ancillary) == (65536,0)
        if not self.packets: raise socket.timeout("SECRET")
        return self.packets.pop(0)
    def close(self): self.closed=True
f = Fake([(good, [], 0, (0,0)), (done, [], 0, (0,0))])
assert len(ns["collect"](lambda *args: f)["qdiscs"]) == 1
assert len(f.sent) == 1 and f.closed
for packets in [[(good,[],0,(0,0))], [(good,[],0,(0,0)), (good+done,[],0,(0,0))],
                [(good,[b"unexpected"],0,(0,0))], [(good,[],32,(0,0))],
                [(good,[],0,(0,0))]*1025]:
    f = Fake(packets)
    try:
        ns["collect"](lambda *args: f)
        raise AssertionError("accepted incomplete or duplicate dump")
    except (ValueError, OSError):
        assert len(f.sent) == 1 and f.closed
# Independent row and aggregate-byte budgets (not merely duplicate detection).
unique = [msg(payload=T.pack(0,0,0,n,0,0xffffffff,0)+attr(1,b"noqueue\x00")) for n in range(1,1026)]
for packets in [[(r,[],0,(0,0)) for r in unique],
                [(msg(payload=T.pack(0,0,0,n,0,0xffffffff,0)+attr(1,b"noqueue\x00")+attr(2,b"x"*60000)),[],0,(0,0)) for n in range(1,37)]]:
    f = Fake(packets)
    try:
        ns["collect"](lambda *args: f)
        raise AssertionError("accepted over-budget dump")
    except ValueError:
        assert f.closed and len(f.sent) == 1
f = Fake([(good+done,[],0,(0,0))])
ticks = iter((0,5))
try:
    ns["collect"](lambda *args: f, lambda: next(ticks))
    raise AssertionError("accepted expired deadline")
except ValueError:
    assert f.closed and len(f.sent) == 1
print("decoder-fixtures-passed")
`;
  const result = spawnSync(process.platform === "win32" ? "python" : "/usr/bin/python3", ["-I", "-S", "-B", "-c", script],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536, windowsHide: true, shell: false });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "decoder-fixtures-passed");
});

test("fixed source never requests a network change or invokes an external tool", () => {
  assert.match(NETWORK_BYPASS_PYTHON, /38, 0x301, seq, port/);
  assert.equal((NETWORK_BYPASS_PYTHON.match(/sock\.sendto\(/g) ?? []).length, 1);
  assert.doesNotMatch(NETWORK_BYPASS_PYTHON, /subprocess|os\.system|RTM_NEWQDISC\s*=|eval\(|exec\(/);
  assert.ok(!NETWORK_BYPASS_PYTHON.includes("f\"")); // Python 3.6 minimum, no later syntax features.
  const proof = captureNetworkBypass(fixture().overrides);
  assert.equal(JSON.stringify(clone(proof)).includes("python"), false);
});
