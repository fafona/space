import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildProductImageFileCode,
  mergeImportedProductImages,
  mergeImportedProductRows,
  parseProductWorkbook,
} from "./productImport";
import { planMerchantCatalogProductImport } from "./merchantCatalog";

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
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.items[0]?.code, "SKU-001");
  assert.equal(parsed.items[0]?.tag, "推荐");
  assert.equal(parsed.items[1]?.price, "128");
});

test("parseProductWorkbook caps oversized worksheets at one planner sentinel row", () => {
  const workbook = XLSX.utils.book_new();
  const rows = [
    ["code", "name", "price"],
    ...Array.from({ length: 1_005 }, (_, index) => [
      `SKU-${index}`,
      `Product ${index}`,
      "1.00",
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Products");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const parsed = parseProductWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.equal(parsed.items.length, 1_001);
  assert.equal(parsed.rowCount, 1_001);
  assert.equal(parsed.truncated, true);
  assert.deepEqual(
    planMerchantCatalogProductImport(
      { revision: 1, updatedAt: "", pricePrefix: "", products: [], categories: [], collections: [] },
      parsed.items,
    ),
    { ok: false, error: "merchant_catalog_limit_exceeded" },
  );
});

test("parseProductWorkbook reports truncation when blank rows hide the planner sentinel", () => {
  const workbook = XLSX.utils.book_new();
  const rows: Array<Array<string>> = [["code", "name", "price"]];
  for (let index = 0; index < 1_005; index += 1) {
    rows.push(index % 100 === 0 ? [] : [`SKU-${index}`, `Product ${index}`, "1.00"]);
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Products");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const parsed = parseProductWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));

  assert.ok(parsed.items.length <= 1_000);
  assert.equal(parsed.truncated, true);
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

test("mergeImportedProductImages stores thumbnail url with matched image", () => {
  const result = mergeImportedProductImages(
    [{ code: "SKU-001", name: "Product A" }],
    [{ fileName: "sku001.webp", imageUrl: "https://example.com/full.jpg", thumbnailUrl: "https://example.com/thumb.webp" }],
  );

  assert.equal(result.matched, 1);
  assert.equal(result.items[0]?.imageUrl, "https://example.com/full.jpg");
  assert.equal(result.items[0]?.thumbnailUrl, "https://example.com/thumb.webp");
});

test("mergeImportedProductRows preserves existing thumbnail url", () => {
  const merged = mergeImportedProductRows(
    [{ code: "A-01", name: "Old product", imageUrl: "https://example.com/full.jpg", thumbnailUrl: "https://example.com/thumb.webp" }],
    [{ code: "A01", name: "New product", price: "20.00" }],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.name, "New product");
  assert.equal(merged[0]?.imageUrl, "https://example.com/full.jpg");
  assert.equal(merged[0]?.thumbnailUrl, "https://example.com/thumb.webp");
});
