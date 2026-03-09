import * as XLSX from "xlsx";
import {
  createProductItemId,
  normalizeProductCode,
  normalizeProductItems,
  type ProductItemInput,
} from "./productBlock";

export type ParsedProductImport = {
  items: ProductItemInput[];
  rowCount: number;
};

const PRODUCT_HEADER_ALIASES: Record<"code" | "name" | "description" | "price" | "tag", string[]> = {
  code: ["编号", "产品编号", "商品编号", "货号", "编码", "SKU", "sku", "code", "id"],
  name: ["名称", "产品名称", "商品名称", "标题", "name", "title"],
  description: ["介绍", "描述", "产品介绍", "商品介绍", "说明", "description", "desc", "content"],
  price: ["价格", "售价", "单价", "price", "amount"],
  tag: ["分类", "分类标签", "标签", "tag", "category"],
};

function normalizeHeader(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:]/g, "");
}

function resolveHeaderMap(headers: string[]) {
  return {
    code: headers.findIndex((header) => PRODUCT_HEADER_ALIASES.code.some((alias) => normalizeHeader(alias) === normalizeHeader(header))),
    name: headers.findIndex((header) => PRODUCT_HEADER_ALIASES.name.some((alias) => normalizeHeader(alias) === normalizeHeader(header))),
    description: headers.findIndex((header) =>
      PRODUCT_HEADER_ALIASES.description.some((alias) => normalizeHeader(alias) === normalizeHeader(header))),
    price: headers.findIndex((header) => PRODUCT_HEADER_ALIASES.price.some((alias) => normalizeHeader(alias) === normalizeHeader(header))),
    tag: headers.findIndex((header) => PRODUCT_HEADER_ALIASES.tag.some((alias) => normalizeHeader(alias) === normalizeHeader(header))),
  };
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

export function parseProductWorkbook(buffer: ArrayBuffer): ParsedProductImport {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return { items: [], rowCount: 0 };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (rows.length === 0) {
    return { items: [], rowCount: 0 };
  }

  const headerRow = rows[0].map((value) => cellText(value));
  const headerMap = resolveHeaderMap(headerRow);
  const bodyRows = rows.slice(1);
  const items = bodyRows.flatMap((row) => {
    const code = headerMap.code >= 0 ? cellText(row[headerMap.code]) : "";
    const name = headerMap.name >= 0 ? cellText(row[headerMap.name]) : "";
    const description = headerMap.description >= 0 ? cellText(row[headerMap.description]) : "";
    const price = headerMap.price >= 0 ? cellText(row[headerMap.price]) : "";
    const tag = headerMap.tag >= 0 ? cellText(row[headerMap.tag]) : "";
    if (!code && !name && !description && !price && !tag) return [];
    return [
      {
        id: createProductItemId(),
        code,
        name,
        description,
        price,
        tag,
      } satisfies ProductItemInput,
    ];
  });

  return {
    items,
    rowCount: items.length,
  };
}

export function mergeImportedProductRows(existing: ProductItemInput[], imported: ProductItemInput[]) {
  const existingItems = normalizeProductItems(existing);
  const nextWithCode = new Map<string, ReturnType<typeof normalizeProductItems>[number]>();
  const nextWithoutCode: ReturnType<typeof normalizeProductItems> = [];

  existingItems.forEach((item) => {
    const codeKey = normalizeProductCode(item.code);
    if (codeKey) nextWithCode.set(codeKey, item);
    else nextWithoutCode.push(item);
  });

  imported.forEach((item) => {
    const codeKey = normalizeProductCode(item.code ?? "");
    if (!codeKey) {
      const normalized = normalizeProductItems([item])[0];
      if (normalized) nextWithoutCode.push(normalized);
      return;
    }
    const found = nextWithCode.get(codeKey);
    if (found) {
      found.code = (item.code ?? "").trim() || found.code;
      found.name = (item.name ?? "").trim() || found.name;
      found.description = (item.description ?? "").trim() || found.description;
      found.price = (item.price ?? "").trim() || found.price;
      found.tag = (item.tag ?? "").trim() || found.tag;
      return;
    }
    const normalized = normalizeProductItems([item])[0];
    if (normalized) nextWithCode.set(codeKey, normalized);
  });

  return [...Array.from(nextWithCode.values()), ...nextWithoutCode];
}

export function buildProductImageFileCode(fileName: string) {
  const baseName = String(fileName ?? "").replace(/\.[^.]+$/, "");
  return normalizeProductCode(baseName);
}

export function mergeImportedProductImages(
  existing: ProductItemInput[],
  uploadedImages: Array<{ fileName: string; imageUrl: string }>,
) {
  const items = normalizeProductItems(existing);
  const itemByCode = new Map(items.map((item) => [normalizeProductCode(item.code), item]));
  let matched = 0;
  let unmatched = 0;

  uploadedImages.forEach((entry) => {
    const codeKey = buildProductImageFileCode(entry.fileName);
    const found = itemByCode.get(codeKey);
    if (!found) {
      unmatched += 1;
      return;
    }
    found.imageUrl = entry.imageUrl;
    matched += 1;
  });

  return {
    items,
    matched,
    unmatched,
  };
}
