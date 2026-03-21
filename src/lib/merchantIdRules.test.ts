import assert from "node:assert/strict";
import test from "node:test";
import {
  findBlockingMerchantIdRule,
  findNextAllowedMerchantIdNumber,
  parseMerchantIdRuleInput,
  sortMerchantIdRules,
  type MerchantIdRule,
} from "@/lib/merchantIdRules";

function makeRule(input: string): MerchantIdRule {
  const parsed = parseMerchantIdRuleInput(input);
  if (!parsed.ok) throw new Error(`rule parse failed: ${input}`);
  return {
    id: input,
    type: parsed.rule.type,
    expression: parsed.rule.expression,
    note: "",
    intervalStart: parsed.rule.intervalStart,
    intervalEnd: parsed.rule.intervalEnd,
    createdAt: "2026-03-21T00:00:00.000Z",
  };
}

test("parses exact merchant id rules", () => {
  const parsed = parseMerchantIdRuleInput("10000010");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rule.type, "exact");
  assert.equal(parsed.rule.expression, "10000010");
  assert.equal(parsed.rule.intervalStart, 10000010);
  assert.equal(parsed.rule.intervalEnd, 10000010);
});

test("parses range merchant id rules", () => {
  const parsed = parseMerchantIdRuleInput("10000020 - 10000050");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rule.type, "range");
  assert.equal(parsed.rule.expression, "10000020-10000050");
  assert.equal(parsed.rule.intervalStart, 10000020);
  assert.equal(parsed.rule.intervalEnd, 10000050);
});

test("parses wildcard rules with trailing stars", () => {
  const parsed = parseMerchantIdRuleInput("100000**");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rule.type, "pattern");
  assert.equal(parsed.rule.expression, "100000**");
  assert.equal(parsed.rule.intervalStart, 10000000);
  assert.equal(parsed.rule.intervalEnd, 10000099);
});

test("parses wildcard rules with stars in the middle", () => {
  const parsed = parseMerchantIdRuleInput("10**0010");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rule.type, "pattern");
  assert.equal(parsed.rule.expression, "10**0010");
  assert.equal(parsed.rule.intervalStart, 10000010);
  assert.equal(parsed.rule.intervalEnd, 10990010);
});

test("parses wildcard rules with stars at the start", () => {
  const parsed = parseMerchantIdRuleInput("****1111");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.rule.type, "pattern");
  assert.equal(parsed.rule.expression, "****1111");
  assert.equal(parsed.rule.intervalStart, 10000000);
  assert.equal(parsed.rule.intervalEnd, 99991111);
});

test("finds blocking rule for arbitrary-position wildcard expressions", () => {
  const rules = sortMerchantIdRules([makeRule("10**0010"), makeRule("****1111")]);
  assert.equal(findBlockingMerchantIdRule("10550010", rules)?.expression, "10**0010");
  assert.equal(findBlockingMerchantIdRule("98761111", rules)?.expression, "****1111");
  assert.equal(findBlockingMerchantIdRule("10550011", rules), null);
});

test("skips exact id, range, and wildcard intervals when allocating", () => {
  const rules = sortMerchantIdRules([
    makeRule("10000010"),
    makeRule("10000011-10000013"),
    makeRule("1000002*"),
  ]);
  assert.equal(findNextAllowedMerchantIdNumber(10000010, rules), 10000014);
  assert.equal(findNextAllowedMerchantIdNumber(10000020, rules), 10000030);
});

test("skips wildcard rules with stars in arbitrary positions when allocating", () => {
  const rules = sortMerchantIdRules([makeRule("10**0010"), makeRule("1000**2*")]);
  assert.equal(findNextAllowedMerchantIdNumber(10000010, rules), 10000011);
  assert.equal(findNextAllowedMerchantIdNumber(10000020, rules), 10000030);
});
