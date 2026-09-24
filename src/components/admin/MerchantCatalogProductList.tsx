"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { MerchantCatalogProduct } from "@/lib/merchantCatalog";

export const CATALOG_PRODUCT_PAGE_SIZE = 50;

export function filterCatalogProductList(products: readonly MerchantCatalogProduct[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return products;
  return products.filter((product) =>
    [product.name, product.code, product.id, product.tag, product.description].some((value) =>
      value.toLocaleLowerCase().includes(normalized),
    ),
  );
}

// This only bounds rendered rows. Callers retain the complete catalog/draft and
// key this view by site + editor/filter identity; no selected IDs are discarded.
export default function MerchantCatalogProductList({
  products, label, searchable = false, darkMode = false, className, children,
}: {
  products: readonly MerchantCatalogProduct[];
  label: string;
  searchable?: boolean;
  darkMode?: boolean;
  className?: string;
  children: (product: MerchantCatalogProduct) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => filterCatalogProductList(products, query), [products, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / CATALOG_PRODUCT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  if (page !== currentPage) setPage(currentPage);
  const start = (currentPage - 1) * CATALOG_PRODUCT_PAGE_SIZE;
  const visible = filtered.slice(start, start + CATALOG_PRODUCT_PAGE_SIZE);
  const controlClassName = `min-h-9 rounded-lg border px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-45 ${darkMode ? "border-slate-600 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-700"}`;

  return (
    <div className="mt-3 space-y-3" data-catalog-product-list={label}>
      {searchable ? (
        <input
          type="search" aria-label={`${label}搜索`} placeholder="搜索全部商品：名称、编码、ID 或分类"
          value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }}
          className={`w-full rounded-xl border px-3 py-2.5 text-sm ${darkMode ? "border-slate-600 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-800"}`}
        />
      ) : null}
      <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={darkMode ? "text-slate-300" : "text-slate-500"} aria-live="polite">
          {filtered.length ? `${start + 1}–${start + visible.length}` : "0"} / {filtered.length} 个商品 · 第 {currentPage} / {pageCount} 页
        </span>
        <div className="flex gap-2">
          <button type="button" className={controlClassName} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <button type="button" className={controlClassName} disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>
      </nav>
      {visible.length ? <div className={className}>{visible.map(children)}</div> : (
        <p className={`py-4 text-center text-xs ${darkMode ? "text-slate-300" : "text-slate-500"}`}>没有匹配的商品</p>
      )}
    </div>
  );
}
