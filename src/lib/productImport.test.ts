import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildProductImageFileCode,
  mergeImportedProductImages,
  mergeImportedProductRows,
  parseProductWorkbook,
} from "./productImport";

test("parseProductWorkbook reads chinese headers", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet([
    { 编号: "SKU-001", 名称: "雪莉酒", 介绍: "干果香气", 价格: "39.90", 分类: "推荐" },
    { 编号: "SKU-002", 名称: "威士忌", 介绍: "泥煤风味", 价格: 128, 分类标签: "烈酒" },
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Products");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const parsed = parseProductWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.equal(parsed.rowCount, 2);
  assert.equal(parsed.items[0]?.code, "SKU-001");
  assert.equal(parsed.items[0]?.tag, "推荐");
  assert.equal(parsed.items[1]?.price, "128");
});

test("mergeImportedProductRows updates by code and preserves image", () => {
  const merged = mergeImportedProductRows(
    [{ code: "A-01", name: "旧产品", imageUrl: "https://example.com/a.jpg" }],
    [{ code: "A01", name: "新产品", description: "新描述", price: "20.00", tag: "热卖" }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "新产品");
  assert.equal(merged[0]?.description, "新描述");
  assert.equal(merged[0]?.price, "20.00");
  assert.equal(merged[0]?.tag, "热卖");
  assert.equal(merged[0]?.imageUrl, "https://example.com/a.jpg");
});

test("mergeImportedProductImages matches file name to product code", () => {
  const result = mergeImportedProductImages(
    [{ code: "sku-001", name: "产品A" }, { code: "sku-002", name: "产品B" }],
    [
      { fileName: "SKU001.jpg", imageUrl: "https://example.com/1.jpg" },
      { fileName: "unmatched.png", imageUrl: "https://example.com/2.jpg" },
    ],
  );

  assert.equal(buildProductImageFileCode("SKU001.jpg"), "SKU001");
  assert.equal(result.matched, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(result.items[0]?.imageUrl, "https://example.com/1.jpg");
});
