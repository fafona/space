"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  createEmptyMerchantCustomerProfile,
  filterMerchantCustomerDirectory,
  type MerchantCustomerDirectoryItem,
  type MerchantCustomerProfile,
  type MerchantCustomerSource,
} from "@/lib/merchantCustomers";
import {
  buildMerchantCustomerImportTemplate,
  parseMerchantCustomerWorkbook,
  type ParsedMerchantCustomerImport,
} from "@/lib/merchantCustomerImport";
import { showGlobalToast } from "@/lib/globalToast";
import { runWithMerchantOperationContext } from "@/lib/merchantOperationContext";

type MerchantCustomerManagerProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type CustomerListPayload = {
  ok?: unknown;
  customers?: MerchantCustomerDirectoryItem[];
  version?: unknown;
  warnings?: unknown;
  error?: unknown;
  message?: unknown;
};

type CustomerMutationPayload = {
  ok?: unknown;
  created?: unknown;
  updated?: unknown;
  skipped?: unknown;
  version?: unknown;
  error?: unknown;
  message?: unknown;
};

const SOURCE_OPTIONS: Array<{
  value: MerchantCustomerSource | "all";
  label: string;
}> = [
  { value: "all", label: "全部来源" },
  { value: "order", label: "订单" },
  { value: "booking", label: "预约" },
  { value: "membership", label: "会员" },
  { value: "import", label: "导入" },
  { value: "manual", label: "人工" },
];

const SOURCE_LABELS: Record<MerchantCustomerSource, string> = {
  order: "订单",
  booking: "预约",
  membership: "会员",
  import: "导入",
  manual: "人工",
};

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function formatDateTime(value: string | null | undefined) {
  const timestamp = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestamp)) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function getErrorMessage(payload: CustomerListPayload | CustomerMutationPayload | null) {
  const message = trimText(payload?.message, 300);
  if (message) return message;
  const error = trimText(payload?.error, 160);
  if (error === "merchant_customer_directory_conflict") return "客户资料已被其他操作更新，正在刷新";
  if (error === "no_valid_customers") return "没有可保存的有效客户资料";
  if (error === "customer_import_limit_exceeded") return "单次最多导入 2000 位客户";
  if (error === "merchant_customer_directory_limit_exceeded") return "客户资料已达到当前存储上限";
  return error || "操作失败，请稍后重试";
}

function formatAddress(customer: MerchantCustomerProfile) {
  return [
    customer.address.country,
    customer.address.province,
    customer.address.city,
    customer.address.postalCode,
    customer.address.line1,
    customer.address.line2,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatOrderTotals(customer: MerchantCustomerDirectoryItem) {
  if (customer.activity.orderTotals.length === 0) return "-";
  return customer.activity.orderTotals
    .map((item) => `${item.label} ${Number(item.amount || 0).toFixed(2)}`)
    .join(" / ");
}

function cloneCustomer(customer: MerchantCustomerProfile): MerchantCustomerProfile {
  return {
    ...customer,
    address: { ...customer.address },
    tax: { ...customer.tax },
    allergens: [...customer.allergens],
    tags: [...customer.tags],
    customFields: { ...customer.customFields },
    identityAliases: [...customer.identityAliases],
    sources: [...customer.sources],
  };
}

function parseTextList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 40);
}

function CustomerDialog({
  customer,
  saving,
  onClose,
  onSave,
}: {
  customer: MerchantCustomerProfile;
  saving: boolean;
  onClose: () => void;
  onSave: (customer: MerchantCustomerProfile) => void;
}) {
  const [draft, setDraft] = useState(() => cloneCustomer(customer));
  const update = (patch: Partial<MerchantCustomerProfile>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const inputClassName =
    "h-10 w-full rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  const labelClassName = "grid gap-1.5 text-xs font-medium text-slate-600";

  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-customer-dialog-title"
        className="flex max-h-[min(880px,calc(100dvh-24px))] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="merchant-customer-dialog-title" className="text-lg font-bold text-slate-950">
              {customer.displayName ? "编辑客户" : "新增客户"}
            </h2>
            <p className="mt-1 text-xs text-slate-500">人工补充的信息会优先展示，订单和预约原记录不会被修改。</p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid gap-6">
            <fieldset className="grid gap-4">
              <legend className="mb-3 text-sm font-bold text-slate-900">基本信息</legend>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label className={labelClassName}>
                  客户编号
                  <input
                    className={inputClassName}
                    value={draft.referenceCode}
                    onChange={(event) => update({ referenceCode: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  客户名称
                  <input
                    className={inputClassName}
                    value={draft.displayName}
                    onChange={(event) => update({ displayName: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  电话
                  <input
                    className={inputClassName}
                    value={draft.phone}
                    onChange={(event) => update({ phone: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  邮箱
                  <input
                    className={inputClassName}
                    type="email"
                    value={draft.email}
                    onChange={(event) => update({ email: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  生日
                  <input
                    className={inputClassName}
                    value={draft.birthday}
                    placeholder="YYYY-MM-DD"
                    onChange={(event) => update({ birthday: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  性别
                  <input
                    className={inputClassName}
                    value={draft.gender}
                    onChange={(event) => update({ gender: event.target.value })}
                  />
                </label>
                <label className={labelClassName}>
                  状态
                  <select
                    className={inputClassName}
                    value={draft.status}
                    onChange={(event) =>
                      update({ status: event.target.value === "archived" ? "archived" : "active" })
                    }
                  >
                    <option value="active">正常</option>
                    <option value="archived">已归档</option>
                  </select>
                </label>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 border-t border-slate-200 pt-5">
              <legend className="mb-3 text-sm font-bold text-slate-900">联系地址</legend>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                  ["country", "国家"],
                  ["province", "省/州"],
                  ["city", "城市"],
                  ["postalCode", "邮编"],
                ].map(([field, label]) => (
                  <label className={labelClassName} key={field}>
                    {label}
                    <input
                      className={inputClassName}
                      value={draft.address[field as keyof typeof draft.address]}
                      onChange={(event) =>
                        update({ address: { ...draft.address, [field]: event.target.value } })
                      }
                    />
                  </label>
                ))}
                <label className={`${labelClassName} md:col-span-2`}>
                  地址
                  <input
                    className={inputClassName}
                    value={draft.address.line1}
                    onChange={(event) =>
                      update({ address: { ...draft.address, line1: event.target.value } })
                    }
                  />
                </label>
                <label className={`${labelClassName} md:col-span-2`}>
                  补充地址
                  <input
                    className={inputClassName}
                    value={draft.address.line2}
                    onChange={(event) =>
                      update({ address: { ...draft.address, line2: event.target.value } })
                    }
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 border-t border-slate-200 pt-5">
              <legend className="mb-3 text-sm font-bold text-slate-900">税务信息</legend>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <label className={`${labelClassName} lg:col-span-2`}>
                  税务名称 / 发票抬头
                  <input
                    className={inputClassName}
                    value={draft.tax.name}
                    onChange={(event) =>
                      update({ tax: { ...draft.tax, name: event.target.value } })
                    }
                  />
                </label>
                <label className={`${labelClassName} lg:col-span-2`}>
                  税号
                  <input
                    className={inputClassName}
                    value={draft.tax.number}
                    onChange={(event) =>
                      update({ tax: { ...draft.tax, number: event.target.value } })
                    }
                  />
                </label>
                {[
                  ["country", "税务国家"],
                  ["province", "税务省/州"],
                  ["city", "税务城市"],
                ].map(([field, label]) => (
                  <label className={labelClassName} key={field}>
                    {label}
                    <input
                      className={inputClassName}
                      value={draft.tax[field as keyof typeof draft.tax]}
                      onChange={(event) =>
                        update({ tax: { ...draft.tax, [field]: event.target.value } })
                      }
                    />
                  </label>
                ))}
                <label className={`${labelClassName} md:col-span-2 lg:col-span-4`}>
                  税务地址
                  <input
                    className={inputClassName}
                    value={draft.tax.address}
                    onChange={(event) =>
                      update({ tax: { ...draft.tax, address: event.target.value } })
                    }
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="grid gap-4 border-t border-slate-200 pt-5">
              <legend className="mb-3 text-sm font-bold text-slate-900">其他信息</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <label className={labelClassName}>
                  标签
                  <input
                    className={inputClassName}
                    value={draft.tags.join(", ")}
                    onChange={(event) => update({ tags: parseTextList(event.target.value) })}
                    placeholder="多个标签用逗号分隔"
                  />
                </label>
                <label className={labelClassName}>
                  过敏信息
                  <input
                    className={inputClassName}
                    value={draft.allergens.join(", ")}
                    onChange={(event) => update({ allergens: parseTextList(event.target.value) })}
                    placeholder="多个项目用逗号分隔"
                  />
                </label>
                <label className={`${labelClassName} md:col-span-2`}>
                  备注
                  <textarea
                    className="min-h-24 w-full resize-y rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    value={draft.notes}
                    onChange={(event) => update({ notes: event.target.value })}
                  />
                </label>
                {Object.keys(draft.customFields).length > 0 ? (
                  <div className="md:col-span-2">
                    <div className="text-xs font-medium text-slate-600">自动收集的其他信息</div>
                    <dl className="mt-2 grid gap-x-4 gap-y-2 rounded border border-slate-200 bg-slate-50 px-3 py-3 text-xs sm:grid-cols-2">
                      {Object.entries(draft.customFields).map(([key, value]) => (
                        <div key={key} className="min-w-0">
                          <dt className="truncate text-slate-400">{key}</dt>
                          <dd className="mt-0.5 break-words text-slate-700">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
              </div>
            </fieldset>
          </div>
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            className="h-10 rounded bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onSave(draft)}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function CustomerImportDialog({
  parsed,
  fileName,
  busy,
  onChooseFile,
  onDownloadTemplate,
  onClose,
  onImport,
}: {
  parsed: ParsedMerchantCustomerImport | null;
  fileName: string;
  busy: boolean;
  onChooseFile: () => void;
  onDownloadTemplate: () => void;
  onClose: () => void;
  onImport: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/45 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="merchant-customer-import-title"
        className="flex max-h-[min(760px,calc(100dvh-24px))] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="merchant-customer-import-title" className="text-lg font-bold text-slate-950">
              批量导入客户
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              支持 Excel 和 CSV；可识别中文、英文及西班牙语表头，未知列会作为自定义信息保留。
            </p>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-xl text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="h-10 rounded bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              onClick={onChooseFile}
              disabled={busy}
            >
              选择文件
            </button>
            <button
              type="button"
              className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={onDownloadTemplate}
              disabled={busy}
            >
              下载模板
            </button>
            <span className="text-sm text-slate-500">{fileName || "尚未选择文件"}</span>
          </div>

          {parsed ? (
            <div className="mt-5">
              <div className="flex flex-wrap gap-4 border-y border-slate-200 py-3 text-sm text-slate-600">
                <span>
                  可导入 <strong className="text-slate-950">{parsed.rowCount}</strong> 条
                </span>
                <span>
                  跳过 <strong className="text-slate-950">{parsed.skipped}</strong> 条
                </span>
              </div>
              {parsed.errors.length > 0 ? (
                <div className="mt-4 max-h-28 overflow-y-auto rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {parsed.errors.map((error) => (
                    <div key={`${error.row}-${error.message}`}>第 {error.row} 行：{error.message}</div>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 overflow-x-auto rounded border border-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-semibold">编号</th>
                      <th className="px-3 py-2 font-semibold">名称</th>
                      <th className="px-3 py-2 font-semibold">电话</th>
                      <th className="px-3 py-2 font-semibold">邮箱</th>
                      <th className="px-3 py-2 font-semibold">地址</th>
                      <th className="px-3 py-2 font-semibold">税号</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.customers.slice(0, 10).map((customer, index) => (
                      <tr key={`${customer.referenceCode || customer.email || customer.phone}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-2">{customer.referenceCode || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">
                          {customer.displayName || "-"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{customer.phone || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2">{customer.email || "-"}</td>
                        <td className="max-w-64 truncate px-3 py-2">{customer.address?.line1 || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-2">{customer.tax?.number || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.rowCount > 10 ? (
                <p className="mt-2 text-xs text-slate-500">仅预览前 10 条，确认后会导入全部有效数据。</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 border-y border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
              请选择 `.xlsx`、`.xls` 或 `.csv` 文件
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="h-10 rounded bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onImport}
            disabled={busy || !parsed?.customers.length}
          >
            {busy ? "导入中..." : `确认导入${parsed?.customers.length ? ` ${parsed.customers.length} 条` : ""}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function MerchantCustomerManager({
  siteId,
  siteName,
  className = "",
}: MerchantCustomerManagerProps) {
  const [customers, setCustomers] = useState<MerchantCustomerDirectoryItem[]>([]);
  const [version, setVersion] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [source, setSource] = useState<MerchantCustomerSource | "all">("all");
  const [status, setStatus] = useState<"all" | "active" | "archived">("active");
  const [editingCustomer, setEditingCustomer] = useState<MerchantCustomerProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importParsed, setImportParsed] = useState<ParsedMerchantCustomerImport | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestSequenceRef = useRef(0);

  const loadCustomers = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      const normalizedSiteId = trimText(siteId, 80);
      if (!normalizedSiteId) {
        setCustomers([]);
        setVersion("");
        setError("当前商户尚未准备好客户资料");
        return;
      }
      const requestSequence = ++requestSequenceRef.current;
      if (!options.quiet) setLoading(true);
      setError("");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 25_000);
      try {
        const response = await fetch(
          `/api/merchant-customers?siteId=${encodeURIComponent(normalizedSiteId)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as CustomerListPayload | null;
        if (!response.ok || !Array.isArray(payload?.customers)) {
          throw new Error(getErrorMessage(payload));
        }
        if (requestSequence !== requestSequenceRef.current) return;
        setCustomers(payload.customers);
        setVersion(trimText(payload.version, 64));
        setWarnings(
          Array.isArray(payload.warnings)
            ? payload.warnings.map((item) => trimText(item, 80)).filter(Boolean)
            : [],
        );
      } catch (loadError) {
        if (requestSequence !== requestSequenceRef.current) return;
        const message =
          loadError instanceof DOMException && loadError.name === "AbortError"
            ? "客户资料加载超时，请稍后重试"
            : loadError instanceof Error
              ? loadError.message
              : "客户资料加载失败";
        setError(message);
      } finally {
        window.clearTimeout(timeout);
        if (requestSequence === requestSequenceRef.current) setLoading(false);
      }
    },
    [siteId],
  );

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filteredCustomers = useMemo(
    () =>
      filterMerchantCustomerDirectory(customers, {
        query: deferredQuery,
        source,
        status,
      }),
    [customers, deferredQuery, source, status],
  );
  const stats = useMemo(
    () => ({
      total: customers.length,
      order: customers.filter((customer) => customer.activity.orderCount > 0).length,
      booking: customers.filter((customer) => customer.activity.bookingCount > 0).length,
      incomplete: customers.filter((customer) => customer.incomplete).length,
    }),
    [customers],
  );

  const handleSave = async (customer: MerchantCustomerProfile) => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await runWithMerchantOperationContext(
        {
          operationModule: "客户管理",
          operationAction: customer.displayName ? "编辑客户" : "新增客户",
          operationSummary: customer.displayName || customer.phone || customer.email || "客户资料",
        },
        () =>
          fetch("/api/merchant-customers", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ siteId, version, customer }),
          }),
      );
      const payload = (await response.json().catch(() => null)) as CustomerMutationPayload | null;
      if (!response.ok) {
        if (response.status === 409) void loadCustomers({ quiet: true });
        throw new Error(getErrorMessage(payload));
      }
      setEditingCustomer(null);
      showGlobalToast("客户资料已保存", { tone: "success" });
      await loadCustomers({ quiet: true });
    } catch (saveError) {
      showGlobalToast(
        saveError instanceof Error ? saveError.message : "客户资料保存失败",
        { tone: "error" },
      );
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportFileName(file.name);
    try {
      const parsed = parseMerchantCustomerWorkbook(await file.arrayBuffer());
      setImportParsed(parsed);
      if (!parsed.customers.length) {
        showGlobalToast("文件中没有可导入的客户资料", { tone: "error" });
      }
    } catch {
      setImportParsed(null);
      showGlobalToast("无法读取该文件，请检查格式后重试", { tone: "error" });
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([buildMerchantCustomerImportTemplate()], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "FAOLLA-客户导入模板.xlsx";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  };

  const handleImport = async () => {
    if (importing || !importParsed?.customers.length) return;
    setImporting(true);
    try {
      const response = await runWithMerchantOperationContext(
        {
          operationModule: "客户管理",
          operationAction: "批量导入客户",
          operationSummary: `导入 ${importParsed.customers.length} 条客户资料`,
        },
        () =>
          fetch("/api/merchant-customers", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              siteId,
              version,
              mode: "import",
              customers: importParsed.customers,
            }),
          }),
      );
      const payload = (await response.json().catch(() => null)) as CustomerMutationPayload | null;
      if (!response.ok) {
        if (response.status === 409) void loadCustomers({ quiet: true });
        throw new Error(getErrorMessage(payload));
      }
      const created = Number(payload?.created ?? 0);
      const updated = Number(payload?.updated ?? 0);
      const skipped = Number(payload?.skipped ?? 0);
      showGlobalToast(
        `导入完成：新增 ${created}，更新 ${updated}${skipped ? `，跳过 ${skipped}` : ""}`,
        { tone: "success" },
      );
      setImportOpen(false);
      setImportParsed(null);
      setImportFileName("");
      await loadCustomers({ quiet: true });
    } catch (importError) {
      showGlobalToast(
        importError instanceof Error ? importError.message : "客户导入失败",
        { tone: "error" },
      );
    } finally {
      setImporting(false);
    }
  };

  const warningText = warnings
    .map((warning) =>
      warning === "orders_unavailable"
        ? "订单"
        : warning === "bookings_unavailable"
          ? "预约"
          : warning === "memberships_unavailable"
            ? "会员"
            : warning,
    )
    .join("、");

  return (
    <section className={`py-6 ${className}`.trim()}>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div>
          <h1 className="text-[26px] font-extrabold leading-8 text-slate-950">客户管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            自动收录订单、预约和会员客户，并集中维护联系方式、地址及税务资料。
            {siteName ? ` 当前商户：${siteName}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="h-10 rounded border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void loadCustomers()}
            disabled={loading}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
          <button
            type="button"
            className="h-10 rounded border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 hover:bg-blue-100"
            onClick={() => setImportOpen(true)}
          >
            批量导入
          </button>
          <button
            type="button"
            className="h-10 rounded bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={() => setEditingCustomer(createEmptyMerchantCustomerProfile(siteId))}
          >
            新增客户
          </button>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["客户总数", stats.total],
          ["订单客户", stats.order],
          ["预约客户", stats.booking],
          ["资料待补充", stats.incomplete],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 p-4 lg:grid-cols-[minmax(260px,1fr)_180px_160px]">
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            搜索
            <input
              className="h-10 rounded border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="名称 / 电话 / 邮箱 / 地址 / 税号 / 编号"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            来源
            <select
              className="h-10 rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
              value={source}
              onChange={(event) => setSource(event.target.value as MerchantCustomerSource | "all")}
            >
              {SOURCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-slate-500">
            状态
            <select
              className="h-10 rounded border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
            >
              <option value="active">正常</option>
              <option value="archived">已归档</option>
              <option value="all">全部状态</option>
            </select>
          </label>
        </div>

        {warningText ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            {warningText}数据暂时未能载入，当前显示其余可用客户资料。
          </div>
        ) : null}
        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-full table-fixed text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="w-[19%] px-4 py-3 font-semibold">客户</th>
                <th className="w-[19%] px-4 py-3 font-semibold">联系方式</th>
                <th className="w-[23%] px-4 py-3 font-semibold">地址 / 税务</th>
                <th className="w-[13%] px-4 py-3 font-semibold">来源</th>
                <th className="w-[18%] px-4 py-3 font-semibold">活动</th>
                <th className="w-[8%] px-4 py-3 text-right font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.map((customer) => (
                <tr key={customer.id} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-950">
                      {customer.displayName || "未命名客户"}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {customer.referenceCode || customer.memberNo || "-"}
                    </div>
                    {customer.tags.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {customer.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="truncate">{customer.phone || "-"}</div>
                    <div className="mt-1 truncate text-xs">{customer.email || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="line-clamp-2">{formatAddress(customer) || "-"}</div>
                    <div className="mt-1 truncate text-xs">
                      税号：{customer.tax.number || "-"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {customer.sources.map((item) => (
                        <span
                          key={item}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600"
                        >
                          {SOURCE_LABELS[item]}
                        </span>
                      ))}
                    </div>
                    {customer.incomplete ? (
                      <div className="mt-2 text-[11px] text-amber-700">资料待补充</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div className="text-xs">
                      订单 {customer.activity.orderCount} / 预约 {customer.activity.bookingCount}
                    </div>
                    <div className="mt-1 truncate text-xs">{formatOrderTotals(customer)}</div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {formatDateTime(customer.activity.lastActivityAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="h-8 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setEditingCustomer(cloneCustomer(customer))}
                    >
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 lg:hidden">
          {filteredCustomers.map((customer) => (
            <article key={customer.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-950">
                    {customer.displayName || "未命名客户"}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    {customer.phone || customer.email || customer.referenceCode || "-"}
                  </div>
                </div>
                <button
                  type="button"
                  className="h-8 shrink-0 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                  onClick={() => setEditingCustomer(cloneCustomer(customer))}
                >
                  编辑
                </button>
              </div>
              <div className="mt-3 text-xs leading-5 text-slate-600">
                <div>{formatAddress(customer) || "尚未填写地址"}</div>
                <div>税号：{customer.tax.number || "-"}</div>
                <div>
                  订单 {customer.activity.orderCount} / 预约 {customer.activity.bookingCount} / 最近{" "}
                  {formatDateTime(customer.activity.lastActivityAt)}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {customer.sources.map((item) => (
                  <span key={item} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {SOURCE_LABELS[item]}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>

        {!loading && filteredCustomers.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center px-4 py-12 text-center text-sm text-slate-500">
            {customers.length === 0
              ? "还没有客户资料。客户下单或预约后会自动出现在这里，也可以批量导入。"
              : "没有符合当前筛选条件的客户。"}
          </div>
        ) : null}
        {loading && customers.length === 0 ? (
          <div className="flex min-h-56 items-center justify-center px-4 py-12 text-sm text-slate-500">
            正在汇总客户资料...
          </div>
        ) : null}

        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
          <span>共 {filteredCustomers.length} 位客户</span>
          <span>订单与预约客户自动更新</span>
        </footer>
      </div>

      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={(event) => void handleImportFile(event)}
      />

      {editingCustomer ? (
        <CustomerDialog
          customer={editingCustomer}
          saving={saving}
          onClose={() => setEditingCustomer(null)}
          onSave={(customer) => void handleSave(customer)}
        />
      ) : null}
      {importOpen ? (
        <CustomerImportDialog
          parsed={importParsed}
          fileName={importFileName}
          busy={importing}
          onChooseFile={() => fileInputRef.current?.click()}
          onDownloadTemplate={handleDownloadTemplate}
          onClose={() => {
            if (importing) return;
            setImportOpen(false);
          }}
          onImport={() => void handleImport()}
        />
      ) : null}
    </section>
  );
}
