import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./MerchantCustomerManager.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("MerchantCustomerManager.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("customer manager imports spreadsheet tools only after an explicit action", () => {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const workbookImports = imports.filter((node) => ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@/lib/merchantCustomerImport");
  assert.equal(workbookImports.length, 1);
  assert.equal(workbookImports[0].importClause?.isTypeOnly, true);
  assert.match(source, /const handleImportFile = async[\s\S]*?import\("@\/lib\/merchantCustomerImport"\)/);
  assert.match(source, /const handleDownloadTemplate = async[\s\S]*?import\("@\/lib\/merchantCustomerImport"\)/);
});

test("customer manager constructs exactly one responsive list and keeps edit state outside it", () => {
  let listBranches = 0;
  function visit(node: ts.Node) {
    if (ts.isConditionalExpression(node) && node.condition.getText(sourceFile) === "desktopList") {
      listBranches += 1;
      const desktop = node.whenTrue.getText(sourceFile);
      const mobile = node.whenFalse.getText(sourceFile);
      assert.match(desktop, /data-customer-list-layout="desktop"/);
      assert.doesNotMatch(desktop, /data-customer-list-layout="mobile"/);
      assert.match(mobile, /data-customer-list-layout="mobile"/);
      assert.doesNotMatch(mobile, /data-customer-list-layout="desktop"/);
      assert.equal((desktop.match(/visibleCustomers\.map/g) ?? []).length, 1);
      assert.equal((mobile.match(/visibleCustomers\.map/g) ?? []).length, 1);
      assert.doesNotMatch(desktop + mobile, /filteredCustomers\.map/);
      assert.doesNotMatch(desktop + mobile, /<CustomerDialog/);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(listBranches, 1);
  assert.match(source, /useSyncExternalStore\(\s*subscribeMerchantCustomerViewport,\s*getMerchantCustomerDesktopSnapshot,\s*getMerchantCustomerServerSnapshot/);
  assert.match(source, /editingCustomer \? \(\s*<CustomerDialog/);
});

test("customer import actions share a synchronous lock with busy and error recovery", () => {
  for (const [start, end] of [
    ["const handleImportFile =", "const handleDownloadTemplate ="],
    ["const handleDownloadTemplate =", "const handleImport ="],
    ["const handleImport =", "const warningText ="],
  ]) {
    const handler = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(handler, /if \([^\n]*importActionRef\.current[^\n]*\) return;/);
    assert.ok(handler.indexOf("importActionRef.current = true") < handler.indexOf("await "));
    assert.match(handler, /catch[\s\S]*showGlobalToast/);
    assert.match(handler, /finally \{[\s\S]*importActionRef\.current = false/);
  }
  assert.match(source, /busy=\{importBusy\}/);
  assert.match(source, /disabled=\{importBusy\}/);
  assert.match(source, /role="status"/);
});
