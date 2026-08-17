"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import {
  createMerchantCatalogCollectionId,
  parseMerchantCatalogUnitPrice,
  resolveMerchantCatalogCollection,
  type MerchantCatalog,
  type MerchantCatalogAvailability,
  type MerchantCatalogBootstrapResult,
  type MerchantCatalogCategory,
  type MerchantCatalogCollection,
  type MerchantCatalogConflict,
  type MerchantCatalogProduct,
  type MerchantCatalogTarget,
} from "@/lib/merchantCatalog";

export type MerchantCatalogManagerPanelProps = {
  siteId: string;
  darkMode?: boolean;
  catalogTarget?: MerchantCatalogTarget | null;
  onChanged?: () => void | Promise<void>;
};

type CatalogApiPayload = {
  ok?: boolean;
  catalog?: MerchantCatalog | null;
  bootstrap?: MerchantCatalogBootstrapResult;
  bootstrapFingerprint?: string;
  error?: string;
  message?: string;
  currentRevision?: number;
  warning?: string | null;
};

type CatalogMutation =
  | { action: "bootstrap"; sourceFingerprint: string }
  | {
      action: "upsert_product";
      product: MerchantCatalogProduct;
      productId?: string;
      collectionIds: string[];
    }
  | { action: "delete_product"; productId: string }
  | { action: "set_availability"; productId: string; availability: MerchantCatalogAvailability }
  | { action: "upsert_category"; category: MerchantCatalogCategory }
  | { action: "delete_category"; categoryId: string }
  | { action: "upsert_collection"; collection: MerchantCatalogCollection }
  | { action: "delete_collection"; collectionId: string }
  | { action: "set_price_prefix"; pricePrefix: string };

const AVAILABILITY_OPTIONS: Array<{
  value: MerchantCatalogAvailability;
  label: string;
  description: string;
}> = [
  { value: "available", label: "可售", description: "正常展示并允许选购" },
  { value: "sold_out", label: "售罄", description: "展示但暂不可选购" },
  { value: "hidden", label: "隐藏", description: "不在经营目录展示" },
];

function RefreshIcon({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`}
    >
      <path
        d="M16 7a6.5 6.5 0 1 0 .2 5.4M16 3v4h-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m12.8 4.2 3 3L7.5 15.5 4 16l.5-3.5 8.3-8.3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6h12M8 3.5h4M6 6l.6 10h6.8L14 6M8.5 9v4.5M11.5 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m4.5 10 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="M10 3 18 17H2L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7.5v4M10 14.5v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function createStableClientId(prefix: "product" | "category") {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${randomId.toLowerCase()}`;
}

function createProductDraft(): MerchantCatalogProduct {
  return {
    id: createStableClientId("product"),
    code: "",
    name: "",
    description: "",
    price: "",
    imageUrl: "",
    thumbnailUrl: "",
    tag: "",
    availability: "available",
  };
}

function createCategoryDraft(): MerchantCatalogCategory {
  return {
    id: createStableClientId("category"),
    name: "",
    productIds: [],
  };
}

function formatDateTime(value: string) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(stamp));
}

function getViewportLabel(viewport: MerchantCatalogCollection["viewport"]) {
  if (viewport === "desktop") return "电脑端";
  if (viewport === "mobile") return "手机端";
  return "电脑端与手机端共享";
}

function getAvailabilityLabel(value: MerchantCatalogAvailability) {
  return AVAILABILITY_OPTIONS.find((option) => option.value === value)?.label ?? "可售";
}

function getAvailabilityClass(value: MerchantCatalogAvailability, darkMode: boolean) {
  if (value === "available") {
    return darkMode
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (value === "sold_out") {
    return darkMode
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : "border-amber-200 bg-amber-50 text-amber-700";
  }
  return darkMode
    ? "border-slate-500/40 bg-slate-500/10 text-slate-300"
    : "border-slate-200 bg-slate-100 text-slate-600";
}

function getCatalogError(payload: CatalogApiPayload | null, fallback: string) {
  const code = String(payload?.error ?? "").trim();
  const message = String(payload?.message ?? "").trim();
  if (code === "merchant_catalog_not_found" || code === "catalog_not_found") return "商品目录尚未建立，请先从已发布商品初始化。";
  if (code === "merchant_catalog_product_not_found" || code === "catalog_product_not_found") return "商品不存在，可能已在其他页面删除。";
  if (code === "merchant_catalog_category_not_found" || code === "catalog_category_not_found") return "分类不存在，可能已在其他页面删除。";
  if (code === "merchant_catalog_category_name_conflict") return "分类名称已存在，请使用不同名称。";
  if (code === "merchant_catalog_collection_scope_conflict") return "该网站区块和终端已经存在投放配置，请刷新后再编辑。";
  if (code === "merchant_catalog_collection_not_found") return "商品投放配置不存在，可能已在其他页面更新。";
  if (code === "merchant_catalog_product_not_placed") return "可售或售罄商品至少要投放到一个网站商品区块；如需暂存，请先设为隐藏。";
  if (code === "merchant_catalog_product_id_immutable") return "商品稳定编号不能修改；如需更换编号，请新建商品。";
  if (code === "merchant_catalog_limit_exceeded") return "商品目录已达到容量上限，请精简商品、分类、图片地址或说明后重试。";
  if (code === "invalid_merchant_catalog_product_price") return "商品价格必须是非负数字，最多保留两位小数；免费商品请明确填写 0。";
  if (code === "merchant_catalog_bootstrap_conflict" || code === "catalog_bootstrap_conflict") return "已发布商品存在冲突，解决冲突后才能初始化目录。";
  if (code === "merchant_catalog_bootstrap_empty") return "没有找到已发布商品。请先发布至少一个商品区块，再建立经营目录。";
  if (code === "merchant_catalog_bootstrap_unavailable") return "暂时无法读取已发布网站商品，请确认网站已发布后重试。";
  if (code === "merchant_catalog_already_initialized") return "商品目录已在其他页面建立，正在重新加载最新目录。";
  if (code === "merchant_catalog_bootstrap_source_changed") return "已发布网站商品在确认期间发生变化，已刷新预览；请重新核对后再建立目录。";
  if (
    code === "catalog_storage_unavailable" ||
    code === "merchant_catalog_load_failed" ||
    code === "merchant_catalog_update_failed"
  ) return "商品目录存储暂时不可用，请稍后重试。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再操作。";
  if (code === "order_management_disabled") return "当前商户尚未启用订单管理。";
  if (code === "forbidden_origin") return "请求来源验证失败，请刷新页面后重试。";
  if (code === "invalid_catalog_action") return "目录操作无效，请刷新后重试。";
  if (code.startsWith("invalid_")) return "目录数据不符合要求，请检查填写内容后重试。";
  return message || code || fallback;
}

function isRevisionConflict(payload: CatalogApiPayload | null) {
  return payload?.error === "merchant_catalog_revision_conflict";
}

function conflictCodeLabel(conflict: MerchantCatalogConflict) {
  if (conflict.code === "product_field_conflict") return "商品字段冲突";
  if (conflict.code === "collection_conflict") return "商品集合冲突";
  if (conflict.code === "catalog_field_conflict") return "目录设置冲突";
  return "已发布数据无效";
}

function conflictFieldLabel(field: string) {
  const labels: Record<string, string> = {
    price_prefix: "价格前缀",
    category_options: "分类选项",
    product_ids: "商品顺序/集合",
    code: "商品编码",
    name: "商品名称",
    name_required: "商品名称不能为空",
    description: "商品描述",
    price: "价格",
    price_invalid: "价格必须是非负数字（最多两位小数）",
    image_url: "图片",
    thumbnail_url: "缩略图",
    tag: "分类标签",
    availability: "可售状态",
    blocks: "已发布商品块",
    desktopBlocks: "桌面端商品块",
    mobileBlocks: "移动端商品块",
  };
  return labels[field] ?? field;
}

function formatConflictValue(value: string | string[]) {
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : "（空列表）";
  return value || "（空值）";
}

function BootstrapConflicts({
  conflicts,
  darkMode,
}: {
  conflicts: MerchantCatalogConflict[];
  darkMode: boolean;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="space-y-3">
      {conflicts.map((conflict, conflictIndex) => (
        <article
          key={`${conflict.code}:${conflict.field}:${conflict.productId ?? conflict.collectionId ?? conflictIndex}`}
          className={`rounded-2xl border p-4 ${
            darkMode ? "border-rose-400/25 bg-rose-400/5" : "border-rose-200 bg-rose-50/60"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold ${darkMode ? "text-rose-100" : "text-rose-800"}`}>
              {conflictCodeLabel(conflict)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-rose-400/10 text-rose-200" : "bg-white text-rose-700"}`}>
              {conflictFieldLabel(conflict.field)}
            </span>
            {conflict.productId ? <code className="text-[11px] opacity-70">商品 {conflict.productId}</code> : null}
            {conflict.collectionId ? <code className="text-[11px] opacity-70">集合 {conflict.collectionId}</code> : null}
          </div>
          <div className="mt-3 space-y-2">
            {conflict.values.map((entry, valueIndex) => (
              <div
                key={`${formatConflictValue(entry.value)}:${valueIndex}`}
                className={`rounded-xl border px-3 py-2 text-xs ${
                  darkMode ? "border-slate-700 bg-slate-950/60 text-slate-300" : "border-rose-100 bg-white text-slate-600"
                }`}
              >
                <p className="break-words font-semibold">{formatConflictValue(entry.value)}</p>
                <p className="mt-1 opacity-70">
                  {entry.sources.length > 0
                    ? entry.sources.map((source) => `${source.viewport} · 区块 ${source.blockId}`).join("；")
                    : "来源数据无法识别"}
                </p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function LoadingSkeleton({ darkMode }: { darkMode: boolean }) {
  const blockClassName = darkMode ? "bg-slate-800" : "bg-slate-200";
  return (
    <div className="animate-pulse space-y-4" aria-label="正在加载商品目录">
      <div className={`h-24 rounded-2xl ${blockClassName}`} />
      <div className={`h-44 rounded-2xl ${blockClassName}`} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className={`h-36 rounded-2xl ${blockClassName}`} />
        <div className={`h-36 rounded-2xl ${blockClassName}`} />
      </div>
    </div>
  );
}

export default function MerchantCatalogManagerPanel({
  siteId,
  darkMode = false,
  catalogTarget = null,
  onChanged,
}: MerchantCatalogManagerPanelProps) {
  const categoryListId = useId();
  const [catalog, setCatalog] = useState<MerchantCatalog | null>(null);
  const [bootstrap, setBootstrap] = useState<MerchantCatalogBootstrapResult | null>(null);
  const [bootstrapFingerprint, setBootstrapFingerprint] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [revisionConflict, setRevisionConflict] = useState("");
  const [notice, setNotice] = useState("");
  const [actingKey, setActingKey] = useState("");
  const [pricePrefixDraft, setPricePrefixDraft] = useState("");
  const [productDraft, setProductDraft] = useState<MerchantCatalogProduct | null>(null);
  const [productDraftIsNew, setProductDraftIsNew] = useState(false);
  const [productDraftRevision, setProductDraftRevision] = useState<number | null>(null);
  const [productDraftCollectionIds, setProductDraftCollectionIds] = useState<string[]>([]);
  const [categoryDraft, setCategoryDraft] = useState<MerchantCatalogCategory | null>(null);
  const [categoryDraftIsNew, setCategoryDraftIsNew] = useState(false);
  const [categoryDraftRevision, setCategoryDraftRevision] = useState<number | null>(null);
  const [collectionDraft, setCollectionDraft] = useState<MerchantCatalogCollection | null>(null);
  const [collectionDraftIsNew, setCollectionDraftIsNew] = useState(false);
  const [collectionDraftRevision, setCollectionDraftRevision] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const mountedRef = useRef(true);
  const catalogRef = useRef<MerchantCatalog | null>(null);
  const bootstrapRef = useRef<MerchantCatalogBootstrapResult | null>(null);
  const requestSequenceRef = useRef(0);
  const initializedTargetDraftKeyRef = useRef("");
  const normalizedCatalogTarget = useMemo<MerchantCatalogTarget | null>(() => {
    const blockId = catalogTarget?.blockId.trim() ?? "";
    if (!blockId || (catalogTarget?.viewport !== "desktop" && catalogTarget?.viewport !== "mobile")) {
      return null;
    }
    return {
      blockId,
      viewport: catalogTarget.viewport,
      productIds: Array.isArray(catalogTarget.productIds)
        ? [...new Set(catalogTarget.productIds.map((productId) => productId.trim()).filter(Boolean))]
        : undefined,
    };
  }, [catalogTarget]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    const normalizedSiteId = siteId.trim();
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const hasCatalogState = catalogRef.current !== null || bootstrapRef.current !== null;
    if (!normalizedSiteId) {
      catalogRef.current = null;
      bootstrapRef.current = null;
      setCatalog(null);
      setBootstrap(null);
      setBootstrapFingerprint("");
      setError("缺少商户编号，暂时无法加载商品目录。");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError("");
    setLoading(!hasCatalogState);
    setRefreshing(hasCatalogState);
    try {
      const query = new URLSearchParams({ siteId: normalizedSiteId });
      const response = await fetch(`/api/orders/catalog?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as CatalogApiPayload | null;
      if (!response.ok || !payload?.ok) {
        throw new Error(getCatalogError(payload, "商品目录加载失败，请稍后重试。"));
      }
      if (!mountedRef.current || requestSequenceRef.current !== sequence) return;
      catalogRef.current = payload.catalog ?? null;
      bootstrapRef.current = payload.bootstrap ?? null;
      setCatalog(payload.catalog ?? null);
      setBootstrap(payload.bootstrap ?? null);
      setBootstrapFingerprint(String(payload.bootstrapFingerprint ?? ""));
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return;
      if (!mountedRef.current || requestSequenceRef.current !== sequence) return;
      setError(requestError instanceof Error ? requestError.message : "商品目录加载失败，请稍后重试。");
    } finally {
      if (mountedRef.current && requestSequenceRef.current === sequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [siteId]);

  useEffect(() => {
    catalogRef.current = null;
    bootstrapRef.current = null;
    setCatalog(null);
    setBootstrap(null);
    setBootstrapFingerprint("");
    setProductDraft(null);
    setProductDraftRevision(null);
    setProductDraftCollectionIds([]);
    setCategoryDraft(null);
    setCategoryDraftRevision(null);
    setCollectionDraft(null);
    setCollectionDraftRevision(null);
    setActionError("");
    setRevisionConflict("");
    setNotice("");
    initializedTargetDraftKeyRef.current = "";
    const controller = new AbortController();
    void loadCatalog(controller.signal);
    return () => {
      controller.abort();
      requestSequenceRef.current += 1;
    };
  }, [loadCatalog]);

  useEffect(() => {
    setPricePrefixDraft(catalog?.pricePrefix ?? "");
  }, [catalog?.pricePrefix, catalog?.revision]);

  const resolvedTargetCollection = useMemo(
    () =>
      catalog && normalizedCatalogTarget
        ? resolveMerchantCatalogCollection(
            catalog,
            normalizedCatalogTarget.blockId,
            normalizedCatalogTarget.viewport,
          )
        : null,
    [catalog, normalizedCatalogTarget],
  );

  const missingTargetProductIds = useMemo(() => {
    if (!catalog || !normalizedCatalogTarget?.productIds) return [];
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    return normalizedCatalogTarget.productIds.filter((productId) => !knownProductIds.has(productId));
  }, [catalog, normalizedCatalogTarget]);

  useEffect(() => {
    if (!catalog || !normalizedCatalogTarget || resolvedTargetCollection) return;
    const targetDraftKey = `${siteId.trim()}\u0001${normalizedCatalogTarget.blockId}\u0001${normalizedCatalogTarget.viewport}`;
    if (initializedTargetDraftKeyRef.current === targetDraftKey) return;
    initializedTargetDraftKeyRef.current = targetDraftKey;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const targetProductIds = normalizedCatalogTarget.productIds;
    const initialProductIds = targetProductIds
      ? targetProductIds.filter((productId) => knownProductIds.has(productId))
      : catalog.products.map((product) => product.id);
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(
        normalizedCatalogTarget.blockId,
        "shared",
      ),
      blockId: normalizedCatalogTarget.blockId,
      viewport: "shared",
      productIds: initialProductIds,
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  }, [catalog, normalizedCatalogTarget, resolvedTargetCollection, siteId]);

  const runMutation = useCallback(
    async (key: string, mutation: CatalogMutation, successMessage: string, baseRevision?: number) => {
      if (actingKey) return false;
      const expectedRevision = baseRevision ?? catalogRef.current?.revision ?? 0;
      setActingKey(key);
      setActionError("");
      setRevisionConflict("");
      setNotice("");
      try {
        const response = await fetch("/api/orders/catalog", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId: siteId.trim(),
            expectedRevision,
            ...mutation,
          }),
        });
        const payload = (await response.json().catch(() => null)) as CatalogApiPayload | null;
        if (payload?.error === "merchant_catalog_already_initialized") {
          setRevisionConflict("商品目录已在其他页面建立。已重新加载最新目录，请核对后继续操作。");
          await loadCatalog();
          return false;
        }
        if (payload?.error === "merchant_catalog_bootstrap_source_changed") {
          setRevisionConflict("已发布网站商品在确认期间发生变化。已重新加载最新预览，请核对商品、价格和区块后再次确认。");
          await loadCatalog();
          return false;
        }
        if (isRevisionConflict(payload)) {
          const currentRevision = payload?.currentRevision;
          setRevisionConflict(
            `目录已被其他页面更新${typeof currentRevision === "number" ? `（当前修订版 ${currentRevision}）` : ""}。已重新加载最新数据，请核对后再保存。`,
          );
          setProductDraft(null);
          setProductDraftRevision(null);
          setProductDraftCollectionIds([]);
          setCategoryDraft(null);
          setCategoryDraftRevision(null);
          setCollectionDraft(null);
          setCollectionDraftRevision(null);
          await loadCatalog();
          return false;
        }
        if (!response.ok || !payload?.ok) {
          throw new Error(getCatalogError(payload, "商品目录保存失败，请稍后重试。"));
        }
        setNotice(
          payload.warning
            ? `${successMessage} 目录已保存，但本次历史备份写入失败；请稍后再次修改或联系支持。`
            : successMessage,
        );
        await Promise.allSettled([
          loadCatalog(),
          Promise.resolve().then(() => onChanged?.()),
        ]);
        return true;
      } catch (requestError) {
        setActionError(requestError instanceof Error ? requestError.message : "商品目录保存失败，请稍后重试。");
        return false;
      } finally {
        if (mountedRef.current) setActingKey("");
      }
    },
    [actingKey, loadCatalog, onChanged, siteId],
  );

  const filteredProducts = useMemo(() => {
    if (!catalog) return [];
    const query = productSearch.trim().toLocaleLowerCase();
    if (!query) return catalog.products;
    return catalog.products.filter((product) =>
      [product.name, product.code, product.id, product.tag, product.description].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }, [catalog, productSearch]);

  const beginNewProduct = () => {
    setProductDraft(createProductDraft());
    setProductDraftIsNew(true);
    setProductDraftRevision(catalog?.revision ?? null);
    setProductDraftCollectionIds(resolvedTargetCollection ? [resolvedTargetCollection.id] : []);
  };

  const beginTargetSharedCollection = () => {
    if (!catalog || !normalizedCatalogTarget) return;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const productIds = normalizedCatalogTarget.productIds
      ? normalizedCatalogTarget.productIds.filter((productId) => knownProductIds.has(productId))
      : catalog.products.map((product) => product.id);
    initializedTargetDraftKeyRef.current = `${siteId.trim()}\u0001${normalizedCatalogTarget.blockId}\u0001${normalizedCatalogTarget.viewport}`;
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(normalizedCatalogTarget.blockId, "shared"),
      blockId: normalizedCatalogTarget.blockId,
      viewport: "shared",
      productIds,
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  };

  const beginTargetSpecificCollection = () => {
    if (!catalog || !normalizedCatalogTarget) return;
    const knownProductIds = new Set(catalog.products.map((product) => product.id));
    const productIds = normalizedCatalogTarget.productIds
      ? normalizedCatalogTarget.productIds.filter((productId) => knownProductIds.has(productId))
      : resolvedTargetCollection?.productIds ?? [];
    setCollectionDraft({
      id: createMerchantCatalogCollectionId(
        normalizedCatalogTarget.blockId,
        normalizedCatalogTarget.viewport,
      ),
      blockId: normalizedCatalogTarget.blockId,
      viewport: normalizedCatalogTarget.viewport,
      productIds,
    });
    setCollectionDraftIsNew(true);
    setCollectionDraftRevision(catalog.revision);
  };

  const beginEditProduct = (product: MerchantCatalogProduct) => {
    setProductDraft({ ...product });
    setProductDraftIsNew(false);
    setProductDraftRevision(catalog?.revision ?? null);
    setProductDraftCollectionIds(
      catalog?.collections
        .filter((collection) => collection.productIds.includes(product.id))
        .map((collection) => collection.id) ?? [],
    );
  };

  const submitProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!productDraft) return;
    const normalizedProduct: MerchantCatalogProduct = {
      ...productDraft,
      id: productDraft.id.trim(),
      code: productDraft.code.trim(),
      name: productDraft.name.trim(),
      description: productDraft.description.trim(),
      price: productDraft.price.trim(),
      imageUrl: productDraft.imageUrl.trim(),
      thumbnailUrl: productDraft.thumbnailUrl.trim(),
      tag: productDraft.tag.trim(),
    };
    if (!normalizedProduct.id || !normalizedProduct.name) {
      setActionError("商品名称不能为空。");
      return;
    }
    if (parseMerchantCatalogUnitPrice(normalizedProduct.price) === null) {
      setActionError("商品价格必须是非负数字，最多保留两位小数；免费商品请明确填写 0。");
      return;
    }
    if (
      normalizedProduct.availability !== "hidden" &&
      (catalog?.collections.length ?? 0) > 0 &&
      productDraftCollectionIds.length === 0
    ) {
      setActionError("可售或售罄商品至少要投放到一个已绑定商品区块；如需暂存，请先设为隐藏。");
      return;
    }
    const saved = await runMutation(
      `product:${normalizedProduct.id}`,
      {
        action: "upsert_product",
        product: normalizedProduct,
        productId: productDraftIsNew ? undefined : normalizedProduct.id,
        collectionIds: productDraftCollectionIds,
      },
      productDraftIsNew ? "商品已添加到经营目录。" : "商品信息已更新。",
      productDraftRevision ?? undefined,
    );
    if (saved) {
      setProductDraft(null);
      setProductDraftRevision(null);
      setProductDraftCollectionIds([]);
    }
  };

  const submitCategory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryDraft) return;
    const normalizedCategory: MerchantCatalogCategory = {
      ...categoryDraft,
      id: categoryDraft.id.trim(),
      name: categoryDraft.name.trim(),
      productIds: [...new Set(categoryDraft.productIds.map((productId) => productId.trim()).filter(Boolean))],
    };
    if (!normalizedCategory.id || !normalizedCategory.name) {
      setActionError("分类名称不能为空。");
      return;
    }
    const saved = await runMutation(
      `category:${normalizedCategory.id}`,
      { action: "upsert_category", category: normalizedCategory },
      categoryDraftIsNew ? "分类已创建。" : "分类已更新。",
      categoryDraftRevision ?? undefined,
    );
    if (saved) {
      setCategoryDraft(null);
      setCategoryDraftRevision(null);
    }
  };

  const submitCollection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!collectionDraft) return;
    const normalizedCollection: MerchantCatalogCollection = {
      ...collectionDraft,
      id: collectionDraft.id.trim(),
      blockId: collectionDraft.blockId.trim(),
      productIds: [...new Set(collectionDraft.productIds.map((productId) => productId.trim()).filter(Boolean))],
    };
    if (!normalizedCollection.id || !normalizedCollection.blockId) {
      setActionError("网站区块信息不完整，请返回网站编辑器重新打开商品目录。");
      return;
    }
    const isCurrentTarget =
      normalizedCatalogTarget?.blockId === normalizedCollection.blockId &&
      (normalizedCatalogTarget.viewport === normalizedCollection.viewport || normalizedCollection.viewport === "shared");
    if (collectionDraftIsNew && isCurrentTarget && missingTargetProductIds.length > 0) {
      const confirmed = window.confirm(
        `当前网站区块还有 ${missingTargetProductIds.length} 个商品尚未进入工作台目录。继续绑定后，这些商品不会在线上显示；可先取消并在工作台补齐商品。仍要继续吗？`,
      );
      if (!confirmed) return;
    }
    const saved = await runMutation(
      `collection:${normalizedCollection.id}`,
      { action: "upsert_collection", collection: normalizedCollection },
      collectionDraftIsNew
        ? "网站商品区块已绑定到工作台目录。"
        : "网站商品区块的投放商品已更新。",
      collectionDraftRevision ?? undefined,
    );
    if (saved) {
      setCollectionDraft(null);
      setCollectionDraftRevision(null);
    }
  };

  const confirmBootstrap = async () => {
    if (!bootstrap?.ok || !bootstrap.catalog) return;
    const confirmed = window.confirm(
      `将把当前已发布网站中的 ${bootstrap.catalog.products.length} 个商品复制到独立经营目录。建立后，已绑定的商品区块会立即使用工作台目录进行公开展示和服务端报价；请先核验商品、价格和可售状态。确定继续吗？`,
    );
    if (!confirmed) return;
    await runMutation(
      "bootstrap",
      { action: "bootstrap", sourceFingerprint: bootstrapFingerprint },
      "商品目录已建立。已绑定商品区块已切换到工作台目录，请核验商品、价格和可售状态。",
    );
  };

  const confirmDeleteProduct = async (product: MerchantCatalogProduct) => {
    const confirmed = window.confirm(
      `确定从经营目录删除“${product.name || product.id}”吗？目录分类和集合中的关联将一并清理，已绑定商品区块的公开展示和服务端报价会立即受到影响。`,
    );
    if (!confirmed) return;
    await runMutation(`delete-product:${product.id}`, { action: "delete_product", productId: product.id }, "商品已从经营目录删除。");
  };

  const confirmDeleteCategory = async (category: MerchantCatalogCategory) => {
    const confirmed = window.confirm(`确定删除分类“${category.name}”吗？分类内的商品不会被删除。`);
    if (!confirmed) return;
    await runMutation(
      `delete-category:${category.id}`,
      { action: "delete_category", categoryId: category.id },
      "分类已删除，商品本身未删除；相关商品已变为未分类。",
    );
  };

  const confirmDeleteCollection = async (collection: MerchantCatalogCollection) => {
    if (!catalog) return;
    const remainingCatalog = {
      ...catalog,
      collections: catalog.collections.filter((candidate) => candidate.id !== collection.id),
    };
    const remainingForBlock = remainingCatalog.collections.filter(
      (candidate) => candidate.blockId === collection.blockId,
    );
    const affectedViewports: Array<"desktop" | "mobile"> =
      collection.viewport === "shared" || remainingForBlock.length === 0
        ? ["desktop", "mobile"]
        : [collection.viewport];
    const impact = affectedViewports.map((viewport) => {
      const fallback = resolveMerchantCatalogCollection(remainingCatalog, collection.blockId, viewport);
      if (fallback) return `${getViewportLabel(viewport)}将改用${getViewportLabel(fallback.viewport)}投放配置`;
      if (remainingForBlock.length > 0) return `${getViewportLabel(viewport)}将停止展示和接单，直到重新绑定`;
      return `${getViewportLabel(viewport)}刷新后将退出工作台目录并使用已发布网站旧数据`;
    });
    const confirmed = window.confirm(
      `确定删除“${collection.blockId} · ${getViewportLabel(collection.viewport)}”的投放配置吗？\n\n${impact.join("；")}。已打开页面中的旧目录报价会被拒绝，客户需刷新页面。若删除会让可售商品失去全部投放，系统将阻止本次操作。`,
    );
    if (!confirmed) return;
    const saved = await runMutation(
      `delete-collection:${collection.id}`,
      { action: "delete_collection", collectionId: collection.id },
      `投放配置已删除。${impact.join("；")}。`,
    );
    if (saved && collectionDraft?.id === collection.id) setCollectionDraft(null);
  };

  const shellClassName = darkMode ? "text-slate-100" : "text-slate-900";
  const surfaceClassName = darkMode
    ? "border-slate-700/80 bg-slate-900/80"
    : "border-slate-200 bg-white";
  const mutedTextClassName = darkMode ? "text-slate-400" : "text-slate-500";
  const secondaryButtonClassName = darkMode
    ? "border-slate-600 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";
  const inputClassName = darkMode
    ? "border-slate-600 bg-slate-950 text-slate-100 placeholder:text-slate-600 focus:border-sky-400 focus:ring-sky-400/20"
    : "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:ring-sky-500/15";

  return (
    <div className={`space-y-5 ${shellClassName}`} aria-busy={loading || refreshing}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold sm:text-lg">商品目录</h3>
          <p className={`mt-1 text-xs leading-5 sm:text-sm ${mutedTextClassName}`}>
            在订单工作台维护商品经营数据；网站编辑继续负责布局、颜色和页面展示。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadCatalog()}
          disabled={loading || refreshing || Boolean(actingKey)}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondaryButtonClassName}`}
        >
          <RefreshIcon spinning={refreshing} />
          {refreshing ? "同步中" : "刷新目录"}
        </button>
      </div>

      <div
        className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${
          darkMode
            ? "border-amber-400/25 bg-amber-400/10 text-amber-100"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0"><WarningIcon /></span>
          <div>
            <p className="font-bold">商品目录已接入安全双读</p>
            <p className="mt-1 text-xs leading-5 opacity-85">
              建立目录后，已绑定商品区块的公开展示和服务端报价会立即使用工作台目录；尚未迁移的区块继续沿用已发布网站数据。网站编辑器只保留布局草稿，请在保存前核验商品、价格和可售状态。
            </p>
          </div>
        </div>
      </div>

      {loading && !catalog && !bootstrap ? <LoadingSkeleton darkMode={darkMode} /> : null}

      {error ? (
        <div
          role="alert"
          className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
            darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          <span>{error}</span>
          <button type="button" onClick={() => void loadCatalog()} className="shrink-0 rounded-xl border border-current/30 px-3 py-2 font-semibold hover:bg-current/10">
            重试
          </button>
        </div>
      ) : null}

      {revisionConflict ? (
        <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-violet-400/30 bg-violet-400/10 text-violet-100" : "border-violet-200 bg-violet-50 text-violet-800"}`}>
          <strong>检测到并发修改：</strong>{revisionConflict}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className={`rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {actionError}
        </div>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${darkMode ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
            <CheckIcon /> {notice}
          </div>
        ) : null}
      </div>

      {!loading && !catalog ? (
        <section className={`rounded-2xl border p-4 sm:p-6 ${surfaceClassName}`} aria-labelledby="catalog-bootstrap-title">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h4 id="catalog-bootstrap-title" className="text-base font-bold">从已发布商品建立经营目录</h4>
              <p className={`mt-1 max-w-3xl text-sm leading-6 ${mutedTextClassName}`}>
                初始化会复制已发布商品、价格前缀、分类和商品块集合。建立后，已绑定商品区块会立即改用工作台目录；网站编辑器继续负责布局草稿。
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
              {bootstrap?.sourceBlockCount ?? 0} 个已发布商品块
            </span>
          </div>

          {bootstrap?.conflicts && bootstrap.conflicts.length > 0 ? (
            <div className="mt-5">
              <div className={`mb-3 rounded-xl border px-3 py-2 text-sm ${darkMode ? "border-rose-400/25 bg-rose-400/10 text-rose-100" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                桌面端、移动端或多个商品块之间存在结构化冲突。系统不会替你选择任意一侧；请先统一对应的已发布数据，再刷新预览。
              </div>
              <BootstrapConflicts conflicts={bootstrap.conflicts} darkMode={darkMode} />
            </div>
          ) : null}

          {bootstrap?.ok && bootstrap.catalog ? (
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["商品", bootstrap.catalog.products.length],
                  ["分类", bootstrap.catalog.categories.length],
                  ["页面集合", bootstrap.catalog.collections.length],
                  ["价格前缀", bootstrap.catalog.pricePrefix || "未设置"],
                ].map(([label, value]) => (
                  <div key={String(label)} className={`rounded-xl border px-3 py-3 ${darkMode ? "border-slate-700 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}>
                    <p className={`text-xs ${mutedTextClassName}`}>{label}</p>
                    <p className="mt-1 truncate text-lg font-black" title={String(value)}>{value}</p>
                  </div>
                ))}
              </div>

              {bootstrap.catalog.products.length > 0 ? (
                <div>
                  <p className={`mb-2 text-xs font-semibold ${mutedTextClassName}`}>即将导入的已发布商品</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {bootstrap.catalog.products.slice(0, 12).map((product) => (
                      <div key={product.id} className={`rounded-xl border px-3 py-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-white"}`}>
                        <p className="truncate text-sm font-semibold">{product.name || "未命名商品"}</p>
                        <p className={`mt-0.5 truncate text-xs ${mutedTextClassName}`}>{product.code || product.id} · {bootstrap.catalog?.pricePrefix}{product.price || "—"}</p>
                      </div>
                    ))}
                  </div>
                  {bootstrap.catalog.products.length > 12 ? <p className={`mt-2 text-xs ${mutedTextClassName}`}>另有 {bootstrap.catalog.products.length - 12} 个商品将在初始化时一并导入</p> : null}
                </div>
              ) : (
                <p className={`rounded-xl border border-dashed px-4 py-6 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                  {bootstrap.sourceBlockCount > 0
                    ? "已找到商品区块但尚无商品，将建立空的经营目录，之后可直接在工作台新增。"
                    : "未找到已发布商品区块。请先在网站中添加并发布商品区块，再回来建立经营目录。"}
                </p>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void confirmBootstrap()}
                  disabled={Boolean(actingKey) || bootstrap.sourceBlockCount === 0}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actingKey === "bootstrap" ? <RefreshIcon spinning /> : <PlusIcon />}
                  {actingKey === "bootstrap"
                    ? "正在建立目录"
                    : bootstrap.sourceBlockCount === 0
                      ? "请先发布商品区块"
                      : "确认并建立商品目录"}
                </button>
              </div>
            </div>
          ) : null}

          {!bootstrap ? (
            <p className={`mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
              暂无可用的已发布商品预览，请刷新后重试。
            </p>
          ) : null}
        </section>
      ) : null}

      {catalog ? (
        <div className="space-y-5">
          <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-xs ${surfaceClassName}`}>
            <span>目录修订版 <strong className="text-sm">{catalog.revision}</strong></span>
            <span className={mutedTextClassName}>最近更新 {formatDateTime(catalog.updatedAt)}</span>
          </div>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-prefix-title">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <h4 id="catalog-prefix-title" className="text-sm font-bold sm:text-base">统一价格前缀</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                  例如 ¥、€ 或 $。保存后，已绑定商品区块的公开展示和服务端报价会立即使用新的价格前缀。
                </p>
              </div>
              <div className="flex w-full gap-2 lg:w-auto">
                <input
                  value={pricePrefixDraft}
                  onChange={(event) => setPricePrefixDraft(event.target.value)}
                  maxLength={16}
                  placeholder="例如 €"
                  className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent transition lg:w-44 ${inputClassName}`}
                  aria-label="商品目录价格前缀"
                />
                <button
                  type="button"
                  onClick={() => void runMutation("price-prefix", { action: "set_price_prefix", pricePrefix: pricePrefixDraft.trim() }, "价格前缀已更新。")}
                  disabled={Boolean(actingKey) || pricePrefixDraft === catalog.pricePrefix}
                  className="shrink-0 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actingKey === "price-prefix" ? "保存中" : "保存"}
                </button>
              </div>
            </div>
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-placement-title">
            <div>
              <h4 id="catalog-placement-title" className="text-sm font-bold sm:text-base">页面投放与区块绑定</h4>
              <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                决定每个网站商品区块实际展示哪些工作台商品。商品、价格和可售状态在这里更新后立即生效；网站编辑器继续负责布局与样式。
              </p>
            </div>

            {normalizedCatalogTarget ? (
              <div
                className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                  resolvedTargetCollection
                    ? darkMode
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : darkMode
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <p className="font-bold">
                  从网站编辑器打开的区块：{getViewportLabel(normalizedCatalogTarget.viewport)} · {normalizedCatalogTarget.blockId}
                </p>
                <p className="mt-1 text-xs leading-5 opacity-85">
                  {resolvedTargetCollection
                    ? `已绑定工作台目录，共投放 ${resolvedTargetCollection.productIds.length} 个商品。`
                    : "尚未绑定工作台目录。请在下方确认商品范围并保存；网站发布后会直接使用这份运营配置。"}
                </p>
                {!resolvedTargetCollection && missingTargetProductIds.length > 0 ? (
                  <p className="mt-2 text-xs font-semibold leading-5">
                    该区块有 {missingTargetProductIds.length} 个商品尚未进入工作台目录；请先新增这些商品，或确认它们不再展示。
                  </p>
                ) : null}
                {resolvedTargetCollection?.viewport === "shared" ? (
                  <button
                    type="button"
                    onClick={beginTargetSpecificCollection}
                    disabled={Boolean(actingKey)}
                    className="mt-3 rounded-lg border border-current/30 px-3 py-2 text-xs font-bold transition hover:bg-current/10 disabled:opacity-50"
                  >
                    为当前{getViewportLabel(normalizedCatalogTarget.viewport)}单独配置
                  </button>
                ) : null}
                {!resolvedTargetCollection && !collectionDraft ? (
                  <button
                    type="button"
                    onClick={beginTargetSharedCollection}
                    disabled={Boolean(actingKey)}
                    className="mt-3 rounded-lg border border-current/30 px-3 py-2 text-xs font-bold transition hover:bg-current/10 disabled:opacity-50"
                  >
                    创建电脑端与手机端共享绑定
                  </button>
                ) : null}
              </div>
            ) : null}

            {collectionDraft ? (
              <form
                onSubmit={(event) => void submitCollection(event)}
                className={`mt-4 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">
                      {collectionDraftIsNew ? "绑定当前网站商品区块" : "编辑区块投放商品"}
                    </h5>
                    <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                      保存后公开页面和服务端订单报价会使用相同商品范围。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCollectionDraft(null)}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}
                  >
                    取消
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    网站区块 ID
                    <input
                      value={collectionDraft.blockId}
                      readOnly
                      disabled
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`}
                    />
                  </label>
                  <label className="text-xs font-semibold">
                    展示终端
                    <input
                      value={getViewportLabel(collectionDraft.viewport)}
                      readOnly
                      disabled
                      className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`}
                    />
                  </label>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-xs font-semibold">该区块展示的商品</legend>
                  {catalog.products.length > 0 ? (
                    <div className={`mt-2 grid max-h-56 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                      {catalog.products.map((product) => {
                        const checked = collectionDraft.productIds.includes(product.id);
                        return (
                          <label key={product.id} className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                setCollectionDraft({
                                  ...collectionDraft,
                                  productIds: event.target.checked
                                    ? [...new Set([...collectionDraft.productIds, product.id])]
                                    : collectionDraft.productIds.filter((productId) => productId !== product.id),
                                })
                              }
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="min-w-0 truncate">
                              {product.name || product.id}
                              {product.availability === "hidden" ? "（隐藏）" : ""}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className={`mt-2 rounded-xl border border-dashed px-3 py-3 text-xs ${mutedTextClassName}`}>
                      目录中还没有商品。可以先保存空绑定，再到“商品”区域新增并选择投放范围。
                    </p>
                  )}
                </fieldset>
                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={Boolean(actingKey)}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
                  >
                    {actingKey.startsWith("collection:") ? <RefreshIcon spinning /> : <CheckIcon />}
                    {actingKey.startsWith("collection:") ? "保存中" : "保存区块投放"}
                  </button>
                </div>
              </form>
            ) : null}

            {catalog.collections.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {catalog.collections.map((collection) => (
                  <article
                    key={collection.id}
                    className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold" title={collection.blockId}>{collection.blockId}</p>
                        <p className={`mt-1 text-[11px] ${mutedTextClassName}`}>{getViewportLabel(collection.viewport)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600"}`}>
                        {collection.productIds.length} 个商品
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCollectionDraft({ ...collection, productIds: [...collection.productIds] });
                          setCollectionDraftIsNew(false);
                          setCollectionDraftRevision(catalog.revision);
                        }}
                        disabled={Boolean(actingKey)}
                        className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${secondaryButtonClassName}`}
                      >
                        <EditIcon /> 编辑投放
                      </button>
                      <button
                        type="button"
                        onClick={() => void confirmDeleteCollection(collection)}
                        disabled={Boolean(actingKey)}
                        className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}
                      >
                        <TrashIcon /> 解除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                尚未绑定任何网站商品区块。请在网站编辑器中打开目标商品区块，再点击“打开订单工作台商品目录”。
              </p>
            )}
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-products-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 id="catalog-products-title" className="text-sm font-bold sm:text-base">商品</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>
                  管理名称、编码、价格和可售状态。库存数量尚未启用，“售罄”目前是人工经营状态。
                </p>
              </div>
              <button
                type="button"
                onClick={beginNewProduct}
                disabled={Boolean(actingKey)}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50"
              >
                <PlusIcon /> 新增商品
              </button>
            </div>

            {productDraft ? (
              <form onSubmit={(event) => void submitProduct(event)} className={`mt-5 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">{productDraftIsNew ? "新增商品" : `编辑：${productDraft.name || productDraft.id}`}</h5>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>商品 ID 由系统稳定生成，创建后不可修改。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProductDraft(null);
                      setProductDraftCollectionIds([]);
                    }}
                    className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}
                  >
                    取消
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">
                    商品 ID
                    <input value={productDraft.id} readOnly disabled className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    商品编码
                    <input value={productDraft.code} onChange={(event) => setProductDraft({ ...productDraft, code: event.target.value })} maxLength={80} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} placeholder="例如 SKU-001" />
                  </label>
                  <label className="text-xs font-semibold">
                    商品名称 <span className="text-rose-500">*</span>
                    <input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} maxLength={160} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    价格文本
                    <input required value={productDraft.price} onChange={(event) => setProductDraft({ ...productDraft, price: event.target.value })} maxLength={18} pattern="(?:0|[1-9][0-9]*)(?:[.,][0-9]{1,2})?" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} placeholder="例如 19.90；免费请填 0" inputMode="decimal" />
                  </label>
                  <label className="text-xs font-semibold">
                    分类标签
                    <input list={categoryListId} value={productDraft.tag} onChange={(event) => setProductDraft({ ...productDraft, tag: event.target.value })} maxLength={100} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                    <datalist id={categoryListId}>{catalog.categories.map((category) => <option key={category.id} value={category.name} />)}</datalist>
                  </label>
                  <label className="text-xs font-semibold">
                    可售状态
                    <select value={productDraft.availability} onChange={(event) => setProductDraft({ ...productDraft, availability: event.target.value as MerchantCatalogAvailability })} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`}>
                      {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}
                    </select>
                  </label>
                  <fieldset className="text-xs font-semibold sm:col-span-2">
                    <legend>投放到商品区块</legend>
                    <p className={`mt-1 font-normal leading-5 ${mutedTextClassName}`}>
                      保存后会立即影响所选区块的公开展示与服务端报价。新商品默认选中全部区块，请按实际投放范围调整。
                    </p>
                    {catalog.collections.length > 0 ? (
                      <div className={`mt-2 grid gap-2 rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                        {catalog.collections.map((collection) => {
                          const checked = productDraftCollectionIds.includes(collection.id);
                          return (
                            <label key={collection.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => setProductDraftCollectionIds((current) =>
                                  event.target.checked
                                    ? [...new Set([...current, collection.id])]
                                    : current.filter((collectionId) => collectionId !== collection.id),
                                )}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{collection.blockId}</span>
                                <span className={`block font-normal ${mutedTextClassName}`}>
                                  {collection.viewport === "desktop" ? "电脑端" : collection.viewport === "mobile" ? "手机端" : "桌面与手机共享"}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={`mt-2 rounded-xl border border-dashed px-3 py-3 font-normal ${mutedTextClassName}`}>
                        当前目录没有已绑定商品区块，商品会先保存在目录中但不会公开展示。
                      </p>
                    )}
                  </fieldset>
                  <label className="text-xs font-semibold sm:col-span-2">
                    商品描述
                    <textarea value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} maxLength={2000} rows={3} className={`mt-1.5 w-full resize-y rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    商品图片 URL
                    <input value={productDraft.imageUrl} onChange={(event) => setProductDraft({ ...productDraft, imageUrl: event.target.value })} maxLength={2000} type="url" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                  <label className="text-xs font-semibold">
                    缩略图 URL
                    <input value={productDraft.thumbnailUrl} onChange={(event) => setProductDraft({ ...productDraft, thumbnailUrl: event.target.value })} maxLength={2000} type="url" className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} />
                  </label>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="submit" disabled={Boolean(actingKey)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50">
                    {actingKey.startsWith("product:") ? <RefreshIcon spinning /> : <CheckIcon />}
                    {actingKey.startsWith("product:") ? "保存中" : "保存商品"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="搜索名称、编码、ID 或分类" className={`w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent sm:max-w-sm ${inputClassName}`} />
              <span className={`text-xs ${mutedTextClassName}`}>显示 {filteredProducts.length} / {catalog.products.length} 个商品</span>
            </div>

            {filteredProducts.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {filteredProducts.map((product) => {
                  const isProductActing = actingKey.includes(product.id);
                  const placementCount = catalog.collections.filter((collection) =>
                    collection.productIds.includes(product.id),
                  ).length;
                  return (
                    <article key={product.id} className={`rounded-2xl border p-4 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h5 className="truncate text-sm font-bold">{product.name || "未命名商品"}</h5>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getAvailabilityClass(product.availability, darkMode)}`}>{getAvailabilityLabel(product.availability)}</span>
                          </div>
                          <p className={`mt-1 truncate text-xs ${mutedTextClassName}`} title={product.id}>
                            {product.code || "无商品编码"} · {placementCount} 个投放区块 · {product.id}
                          </p>
                        </div>
                        <p className="shrink-0 text-base font-black">{catalog.pricePrefix}{product.price || "—"}</p>
                      </div>
                      {product.description ? <p className={`mt-3 line-clamp-2 text-xs leading-5 ${mutedTextClassName}`}>{product.description}</p> : null}
                      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <select
                          value={product.availability}
                          onChange={(event) => void runMutation(`availability:${product.id}`, { action: "set_availability", productId: product.id, availability: event.target.value as MerchantCatalogAvailability }, `“${product.name || product.id}”已设为${getAvailabilityLabel(event.target.value as MerchantCatalogAvailability)}。`)}
                          disabled={Boolean(actingKey)}
                          className={`rounded-xl border px-3 py-2 text-xs font-semibold outline-none ${inputClassName}`}
                          aria-label={`${product.name || product.id}的可售状态`}
                        >
                          {AVAILABILITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => beginEditProduct(product)} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${secondaryButtonClassName}`}><EditIcon /> 编辑</button>
                          <button type="button" onClick={() => void confirmDeleteProduct(product)} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}>
                            {isProductActing ? <RefreshIcon spinning /> : <TrashIcon />} 删除
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={`mt-4 rounded-xl border border-dashed px-4 py-10 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>
                {catalog.products.length > 0 ? "没有匹配的商品" : "目录中还没有商品，可以直接在工作台新增"}
              </p>
            )}
          </section>

          <section className={`rounded-2xl border p-4 sm:p-5 ${surfaceClassName}`} aria-labelledby="catalog-categories-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 id="catalog-categories-title" className="text-sm font-bold sm:text-base">分类</h4>
                <p className={`mt-1 text-xs leading-5 ${mutedTextClassName}`}>分类属于经营数据；删除分类不会删除商品。可在编辑分类时选择包含的商品。</p>
              </div>
              <button type="button" onClick={() => { setCategoryDraft(createCategoryDraft()); setCategoryDraftIsNew(true); setCategoryDraftRevision(catalog.revision); }} disabled={Boolean(actingKey)} className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${secondaryButtonClassName}`}><PlusIcon /> 新增分类</button>
            </div>

            {categoryDraft ? (
              <form onSubmit={(event) => void submitCategory(event)} className={`mt-5 rounded-2xl border p-4 ${darkMode ? "border-sky-400/25 bg-sky-400/5" : "border-sky-200 bg-sky-50/50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h5 className="text-sm font-bold">{categoryDraftIsNew ? "新增分类" : `编辑：${categoryDraft.name}`}</h5>
                    <p className={`mt-1 text-xs ${mutedTextClassName}`}>分类 ID 创建后不可修改。</p>
                  </div>
                  <button type="button" onClick={() => setCategoryDraft(null)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${secondaryButtonClassName}`}>取消</button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-semibold">分类 ID<input value={categoryDraft.id} readOnly disabled className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm opacity-70 ${inputClassName}`} /></label>
                  <label className="text-xs font-semibold">分类名称 <span className="text-rose-500">*</span><input required value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} maxLength={100} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-2 ring-transparent ${inputClassName}`} /></label>
                </div>
                <fieldset className="mt-4">
                  <legend className="text-xs font-semibold">包含的商品</legend>
                  {catalog.products.length > 0 ? (
                    <div className={`mt-2 grid max-h-48 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-200 bg-white"}`}>
                      {catalog.products.map((product) => {
                        const checked = categoryDraft.productIds.includes(product.id);
                        return (
                          <label key={product.id} className="flex cursor-pointer items-center gap-2 text-xs">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => setCategoryDraft({
                                ...categoryDraft,
                                productIds: event.target.checked
                                  ? [...categoryDraft.productIds, product.id]
                                  : categoryDraft.productIds.filter((productId) => productId !== product.id),
                              })}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="truncate">{product.name || product.id}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : <p className={`mt-2 text-xs ${mutedTextClassName}`}>暂无商品，可先创建空分类。</p>}
                </fieldset>
                <div className="mt-4 flex justify-end"><button type="submit" disabled={Boolean(actingKey)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-sky-700 disabled:opacity-50">{actingKey.startsWith("category:") ? <RefreshIcon spinning /> : <CheckIcon />}{actingKey.startsWith("category:") ? "保存中" : "保存分类"}</button></div>
              </form>
            ) : null}

            {catalog.categories.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {catalog.categories.map((category) => (
                  <article key={category.id} className={`rounded-xl border p-3 ${darkMode ? "border-slate-700 bg-slate-950/50" : "border-slate-100 bg-slate-50/70"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="truncate text-sm font-bold">{category.name}</p><p className={`mt-1 truncate text-[11px] ${mutedTextClassName}`} title={category.id}>{category.id}</p></div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600"}`}>{category.productIds.length} 个商品</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => { setCategoryDraft({ ...category, productIds: [...category.productIds] }); setCategoryDraftIsNew(false); setCategoryDraftRevision(catalog.revision); }} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${secondaryButtonClassName}`}><EditIcon /> 编辑</button>
                      <button type="button" onClick={() => void confirmDeleteCategory(category)} disabled={Boolean(actingKey)} className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${darkMode ? "border-rose-400/30 text-rose-200 hover:bg-rose-400/10" : "border-rose-200 bg-white text-rose-700 hover:bg-rose-50"}`}><TrashIcon /> 删除</button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className={`mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm ${darkMode ? "border-slate-700" : "border-slate-200"} ${mutedTextClassName}`}>还没有分类</p>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
