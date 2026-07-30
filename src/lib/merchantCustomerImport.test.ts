import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  buildMerchantCustomerImportTemplate,
  parseMerchantCustomerWorkbook,
} from "@/lib/merchantCustomerImport";

function workbookBuffer(rows: Record<string, unknown>[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Customers");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

test("customer import reads multilingual headers and keeps unknown columns", () => {
  const parsed = parseMerchantCustomerWorkbook(
    workbookBuffer([
      {
        "Código cliente": "C-001",
        Nombre: "Nana",
        Teléfono: "+34 600 000 001",
        Correo: "nana@example.com",
        Dirección: "Calle Test 1",
        NIF: "X0000001X",
        Preferencia: "Sin llamadas",
      },
    ]),
  );

  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.customers[0]?.referenceCode, "C-001");
  assert.equal(parsed.customers[0]?.displayName, "Nana");
  assert.equal(parsed.customers[0]?.phone, "+34 600 000 001");
  assert.equal(parsed.customers[0]?.address?.line1, "Calle Test 1");
  assert.equal(parsed.customers[0]?.tax?.number, "X0000001X");
  assert.equal(parsed.customers[0]?.customFields?.Preferencia, "Sin llamadas");
});

test("customer import skips rows without any usable identity", () => {
  const parsed = parseMerchantCustomerWorkbook(
    workbookBuffer([{ 备注: "Only a note" }]),
  );

  assert.equal(parsed.rowCount, 0);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.errors[0]?.row, 2);
});

test("customer import template can be parsed back", () => {
  const parsed = parseMerchantCustomerWorkbook(buildMerchantCustomerImportTemplate());
  assert.equal(parsed.rowCount, 1);
  assert.equal(parsed.customers[0]?.referenceCode, "C-0001");
  assert.equal(parsed.customers[0]?.displayName, "示例客户");
});
