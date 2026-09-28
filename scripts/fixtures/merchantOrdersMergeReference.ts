import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import ts from "typescript";

// Test/measurement reference only. Both pins are the full LF-normalized files
// from f547d48cd44ae30515026cc24df750f368b9e2b5, not a rewritten merge oracle.
export const LEGACY_MERCHANT_ORDERS_STORE_SHA256 =
  "64dcc9541d8d88f8a5c6b49bc9ba60750ceb5f4024732eaffabd650df54dd341";
export const MERCHANT_ORDERS_NORMALIZER_SHA256 =
  "3ff94f360e90d581a0fd069de8c4da8428d64d8f2acdadf3c32a3e6957feced6";

export function restoreLegacyOrderMergeSource(source: string): string {
  const normalized = source.replaceAll("\r\n", "\n");
  const ast = ts.createSourceFile("merchantOrdersStore.ts", normalized, ts.ScriptTarget.Latest, true);
  const added = ast.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === "finishNormalizedMerchantOrders");
  assert.equal(added.length, 1, "exactly one new private finishing helper must exist");
  const node = added[0]!;
  let restored = normalized.slice(0, node.getFullStart()) + normalized.slice(node.end);
  const changed = "orders: finishNormalizedMerchantOrders(orderMap.values()),";
  assert.equal(restored.split(changed).length, 2, "only the final merge call is reversed");
  restored = restored.replace(changed, "orders: normalizeMerchantOrderRecords(Array.from(orderMap.values())),");
  assert.equal(createHash("sha256").update(restored).digest("hex"), LEGACY_MERCHANT_ORDERS_STORE_SHA256,
    "the complete legacy store remains frozen: imports, queries, merge precedence, loaders and writers");
  return restored;
}
