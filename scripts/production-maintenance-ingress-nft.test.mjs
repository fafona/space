import assert from "node:assert/strict";
import test from "node:test";
import { planIngressInstallation, validateIngressProof, installIngress, verifyIngress, restoreIngress } from "./production-maintenance-ingress.mjs";
import { createNftIngressHost, TOKEN } from "./test-fixtures/production-maintenance-ingress-nft.mjs";

// Real exported ingress/store integration with a synthetic dependency bridge;
// not real network/kernel/HTTP or production drain evidence.
for (const profile of ["standard", "bt"]) test(`ingress ${profile} executes nft lifecycle and restores only its own changes`, async () => {
  const h = createNftIngressHost(profile), original = new Map(h.state.files), baseline = structuredClone(h.state.nft), saves = { ...h.state.saves };
  const captured = h.capture(); assert.equal(captured.firewall.backend, "nft"); assert.equal(captured.nginx.profile, profile);
  assert.equal(h.state.mutations.length, 0);
  const proof = planIngressInstallation(captured, TOKEN);
  validateIngressProof(proof);
  await installIngress(proof, TOKEN, h.d);
  assert.equal((await verifyIngress(proof, h.d)).activeHttpVerified, true);
  assert.equal(h.state.mutations.filter(row => row.kind === "nft").length, 1);
  assert.equal(h.state.mutations.find(row => row.kind === "nft").data, h.plan.script);
  const privatePath = `${h.prefix}/faolla-maintenance-${captured.input.operationId}.inc`;
  assert(h.state.private.has(privatePath));
  assert(h.state.mutations.filter(row => ["syntax", "reload"].includes(row.kind)).every(row => row.data.startsWith(h.BINARY + " ")));
  assert(!h.state.calls.some(row => ["iptables", "ip6tables"].includes(row.command) && row.args[0] !== "--version"));
  assert(!h.state.calls.some(row => row.command === "nginx"));
  await restoreIngress(proof, h.d);
  assert.deepEqual(h.state.files, original); assert.deepEqual(h.state.nft, baseline); assert.deepEqual(h.state.saves, saves);
  assert.equal(h.state.mutations.filter(row => row.kind === "nft").at(-1).data, `delete table inet ${h.plan.tableName}\n`);
  assert(h.state.private.has(privatePath), "private include is retained for controlled failed-held reinstallation");
});

for (const change of ["rule", "xt-save", "partial-own"]) test(`ingress rejects ${change} before any Nginx or firewall write`, async () => {
  const h = createNftIngressHost("bt"), proof = planIngressInstallation(h.capture(), TOKEN);
  if (change === "rule") h.state.nft.nftables[3].rule.expr.splice(-1, 1, { drop: null });
  if (change === "xt-save") h.state.saves["ebtables-save"] = h.state.saves["ebtables-save"].replace(":INPUT ACCEPT", ":INPUT DROP");
  if (change === "partial-own") h.state.nft.nftables.push(h.ownedRows()[0]);
  await assert.rejects(installIngress(proof, TOKEN, h.d), /production_maintenance_/);
  assert.equal(h.state.mutations.length, 0); assert.equal(h.state.private.size, 0);
});

test("post-install third-party drift blocks restore without opening or overwriting anything", async () => {
  const h = createNftIngressHost(), proof = planIngressInstallation(h.capture(), TOKEN);
  await installIngress(proof, TOKEN, h.d);
  const before = h.state.mutations.length, installedFiles = new Map(h.state.files);
  h.state.nft.nftables[3].rule.expr.splice(-1, 1, { drop: null });
  await assert.rejects(restoreIngress(proof, h.d), /production_maintenance_/);
  assert.equal(h.state.mutations.length, before); assert.deepEqual(h.state.files, installedFiles);
  assert(h.state.nft.nftables.some(row => row.table?.name === h.plan.tableName));
});
