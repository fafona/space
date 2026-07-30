import * as XLSX from "xlsx";
import type { MerchantCustomerProfile } from "@/lib/merchantCustomers";

export type MerchantCustomerImportRow = Partial<MerchantCustomerProfile>;

export type ParsedMerchantCustomerImport = {
  customers: MerchantCustomerImportRow[];
  rowCount: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

type ImportField =
  | "referenceCode"
  | "displayName"
  | "phone"
  | "email"
  | "birthday"
  | "gender"
  | "country"
  | "province"
  | "city"
  | "postalCode"
  | "addressLine1"
  | "addressLine2"
  | "taxName"
  | "taxNumber"
  | "taxCountry"
  | "taxProvince"
  | "taxCity"
  | "taxAddress"
  | "allergens"
  | "tags"
  | "notes";

const HEADER_ALIASES: Record<ImportField, string[]> = {
  referenceCode: [
    "客户编号",
    "编号",
    "客户代码",
    "customer code",
    "customer id",
    "reference",
    "codigo cliente",
    "codigo",
  ],
  displayName: [
    "客户名称",
    "名称",
    "姓名",
    "联系人",
    "name",
    "customer name",
    "nombre",
    "cliente",
  ],
  phone: ["电话", "手机号", "手机", "联系电话", "phone", "mobile", "telefono", "movil"],
  email: ["邮箱", "电子邮箱", "邮件", "email", "e-mail", "correo", "correo electronico"],
  birthday: ["生日", "出生日期", "birthday", "birth date", "fecha nacimiento"],
  gender: ["性别", "gender", "sexo"],
  country: ["国家", "country", "pais"],
  province: ["省/州", "省", "州", "province", "state", "provincia"],
  city: ["城市", "市", "city", "ciudad"],
  postalCode: ["邮编", "邮政编码", "postal code", "postcode", "zip", "codigo postal"],
  addressLine1: ["地址", "详细地址", "地址1", "address", "address 1", "direccion", "direccion 1"],
  addressLine2: ["地址2", "补充地址", "address 2", "direccion 2"],
  taxName: ["税务名称", "发票抬头", "公司名称", "tax name", "razon social", "nombre fiscal"],
  taxNumber: [
    "税号",
    "税务编号",
    "纳税人识别号",
    "tax number",
    "vat",
    "vat number",
    "nif",
    "cif",
  ],
  taxCountry: ["税务国家", "tax country", "pais fiscal"],
  taxProvince: ["税务省/州", "税务省", "tax province", "provincia fiscal"],
  taxCity: ["税务城市", "tax city", "ciudad fiscal"],
  taxAddress: ["税务地址", "发票地址", "tax address", "direccion fiscal"],
  allergens: ["过敏原", "过敏信息", "allergens", "alergenos"],
  tags: ["标签", "客户标签", "tags", "etiquetas"],
  notes: ["备注", "说明", "notes", "note", "observaciones"],
};

export const MERCHANT_CUSTOMER_IMPORT_TEMPLATE_HEADERS = [
  "客户编号",
  "客户名称",
  "电话",
  "邮箱",
  "生日",
  "性别",
  "国家",
  "省/州",
  "城市",
  "邮编",
  "地址",
  "地址2",
  "税务名称",
  "税号",
  "税务国家",
  "税务省/州",
  "税务城市",
  "税务地址",
  "过敏原",
  "标签",
  "备注",
] as const;

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_:/：\-]+/g, "");
}

function cellText(value: unknown, maxLength = 4000) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLength);
}

function splitList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 40);
}

function buildResolvedHeaders(headers: string[]) {
  const aliasToField = new Map<string, ImportField>();
  (Object.keys(HEADER_ALIASES) as ImportField[]).forEach((field) => {
    HEADER_ALIASES[field].forEach((alias) => aliasToField.set(normalizeHeader(alias), field));
  });
  return headers.map((header) => aliasToField.get(normalizeHeader(header)) ?? null);
}

function hasUsableIdentity(customer: MerchantCustomerImportRow) {
  return Boolean(
    customer.referenceCode ||
      customer.displayName ||
      customer.phone ||
      customer.email ||
      customer.tax?.number,
  );
}

export function parseMerchantCustomerWorkbook(
  buffer: ArrayBuffer,
): ParsedMerchantCustomerImport {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { customers: [], rowCount: 0, skipped: 0, errors: [] };
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (rows.length === 0) {
    return { customers: [], rowCount: 0, skipped: 0, errors: [] };
  }

  const headers = rows[0].map((value) => cellText(value, 120));
  const fields = buildResolvedHeaders(headers);
  const customers: MerchantCustomerImportRow[] = [];
  const errors: Array<{ row: number; message: string }> = [];
  let skipped = 0;

  rows.slice(1).forEach((row, index) => {
    const values = row.map((value) => cellText(value));
    if (!values.some(Boolean)) return;
    const known: Partial<Record<ImportField, string>> = {};
    const customFields: Record<string, string> = {};
    values.forEach((value, columnIndex) => {
      if (!value) return;
      const field = fields[columnIndex];
      if (field) {
        known[field] = value;
        return;
      }
      const header = headers[columnIndex];
      if (header) customFields[header] = value.slice(0, 500);
    });
    const customer: MerchantCustomerImportRow = {
      referenceCode: known.referenceCode ?? "",
      displayName: known.displayName ?? "",
      phone: known.phone ?? "",
      email: known.email ?? "",
      birthday: known.birthday ?? "",
      gender: known.gender ?? "",
      address: {
        country: known.country ?? "",
        province: known.province ?? "",
        city: known.city ?? "",
        postalCode: known.postalCode ?? "",
        line1: known.addressLine1 ?? "",
        line2: known.addressLine2 ?? "",
      },
      tax: {
        name: known.taxName ?? "",
        number: known.taxNumber ?? "",
        country: known.taxCountry ?? "",
        province: known.taxProvince ?? "",
        city: known.taxCity ?? "",
        address: known.taxAddress ?? "",
      },
      allergens: splitList(known.allergens ?? ""),
      tags: splitList(known.tags ?? ""),
      notes: known.notes ?? "",
      customFields,
    };
    if (!hasUsableIdentity(customer)) {
      skipped += 1;
      errors.push({
        row: index + 2,
        message: "至少需要客户编号、名称、电话、邮箱或税号中的一项",
      });
      return;
    }
    customers.push(customer);
  });

  return {
    customers,
    rowCount: customers.length,
    skipped,
    errors: errors.slice(0, 100),
  };
}

export function buildMerchantCustomerImportTemplate() {
  const sample = [
    "C-0001",
    "示例客户",
    "+34 600 000 000",
    "customer@example.com",
    "1990-01-01",
    "",
    "Spain",
    "Sevilla",
    "Sevilla",
    "41001",
    "Calle Ejemplo 1",
    "",
    "示例客户",
    "X0000000X",
    "Spain",
    "Sevilla",
    "Sevilla",
    "Calle Ejemplo 1, 41001 Sevilla",
    "",
    "重点客户",
    "",
  ];
  const sheet = XLSX.utils.aoa_to_sheet([
    [...MERCHANT_CUSTOMER_IMPORT_TEMPLATE_HEADERS],
    sample,
  ]);
  sheet["!cols"] = MERCHANT_CUSTOMER_IMPORT_TEMPLATE_HEADERS.map((header) => ({
    wch: Math.max(12, header.length * 2 + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "客户");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
