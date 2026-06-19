"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { showGlobalToast } from "@/lib/globalToast";
import {
  createEmptyMerchantMembershipSettings,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
  type MerchantReceiptContentField,
  type MerchantReceiptFieldSection,
  type MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";
import {
  checkLocalPrintBridge,
  getReceiptFieldValue,
  getReceiptFieldsBySection,
  getReceiptLineFieldValue,
  getVisibleReceiptFields,
  isReceiptFieldVisible,
  listLocalPrintBridgePrinters,
  printRedemptionReceipt,
  printRedemptionReceiptWithLocalBridge,
  normalizeReceiptPrintSettingsForClient,
  type LocalPrintBridgePrinter,
  type MerchantRedemptionReceiptData,
} from "@/lib/merchantReceiptPrint";
import { runWithMerchantOperationContext } from "@/lib/merchantOperationContext";
import {
  invalidateMerchantAdminDataCachePrefix,
  makeMerchantAdminDataCacheKey,
} from "@/lib/merchantAdminDataCache";

type MerchantPrintSettingsPanelProps = {
  siteId: string;
  siteName?: string;
  className?: string;
};

type MembershipSettingsPayload = {
  ok?: unknown;
  settings?: MerchantMembershipSettings;
  message?: unknown;
};

const RECEIPT_FIELD_SECTIONS: Array<{ id: MerchantReceiptFieldSection; label: string; hint: string }> = [
  { id: "header", label: "页头", hint: "商户、站点等居中显示内容" },
  { id: "meta", label: "单据信息", hint: "小票号、时间、会员信息" },
  { id: "items", label: "项目明细", hint: "商品/项目行里的内容" },
  { id: "summary", label: "汇总", hint: "积分、抵扣和结算后余额" },
  { id: "footer", label: "页脚", hint: "备注和底部文字" },
];

const RECEIPT_FIELD_WIDTH_OPTIONS = [
  { value: "full", label: "整行" },
  { value: "half", label: "半行" },
  { value: "third", label: "三分之一" },
] as const;

function trimText(value: unknown, maxLength = 4096) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readPayloadMessage(value: unknown, fallback: string) {
  return trimText(value, 1000) || fallback;
}

function inputClassName(extra = "") {
  return `h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-slate-900 ${extra}`;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm font-medium text-slate-700 ${className}`}>
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function parseInteger(value: string, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function receiptPreviewWidthClass(field: MerchantReceiptContentField) {
  if (field.width === "half") return "col-span-3";
  if (field.width === "third") return "col-span-2";
  return "col-span-6";
}

function buildPreviewReceipt(siteId: string, siteName: string): MerchantRedemptionReceiptData {
  return {
    receiptNo: "PREVIEW",
    siteId,
    siteName: siteName || "商户名称",
    memberName: "Felix",
    memberNo: "M000001",
    beforePointBalance: 1280,
    afterPointBalance: 1080,
    totalQuantity: 2,
    grossPoints: 260,
    couponPointDiscountTotal: 60,
    totalPoints: 200,
    note: "前台积分兑换",
    createdAt: new Date(),
    lines: [
      {
        code: "A001",
        name: "会员兑换项目",
        categoryName: "推荐",
        quantity: 1,
        unitPoints: 160,
        subtotalPoints: 160,
        couponDiscountLabel: "",
        couponPointDiscount: 0,
      },
      {
        code: "COUPON",
        name: "积分券抵扣",
        categoryName: "优惠券",
        quantity: 1,
        unitPoints: 100,
        subtotalPoints: 100,
        couponDiscountLabel: "积分券",
        couponPointDiscount: 60,
      },
    ],
  };
}

export default function MerchantPrintSettingsPanel({
  siteId,
  siteName = "",
  className = "",
}: MerchantPrintSettingsPanelProps) {
  const normalizedSiteId = siteId.trim();
  const [settings, setSettings] = useState<MerchantMembershipSettings>(() =>
    createEmptyMerchantMembershipSettings(normalizedSiteId),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bridgeChecking, setBridgeChecking] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const [bridgePrinters, setBridgePrinters] = useState<LocalPrintBridgePrinter[]>([]);
  const [activeReceiptSection, setActiveReceiptSection] = useState<MerchantReceiptFieldSection>("meta");

  const activeSettings = useMemo(
    () => normalizeMerchantMembershipSettings(normalizedSiteId, settings),
    [normalizedSiteId, settings],
  );
  const printSettings = useMemo(
    () => normalizeReceiptPrintSettingsForClient(activeSettings.printSettings),
    [activeSettings.printSettings],
  );
  const previewReceipt = useMemo(
    () => buildPreviewReceipt(normalizedSiteId, siteName),
    [normalizedSiteId, siteName],
  );
  const activeReceiptSectionInfo =
    RECEIPT_FIELD_SECTIONS.find((section) => section.id === activeReceiptSection) ?? RECEIPT_FIELD_SECTIONS[0];
  const activeReceiptFields = useMemo(
    () => getReceiptFieldsBySection(printSettings, activeReceiptSectionInfo.id),
    [activeReceiptSectionInfo.id, printSettings],
  );

  const patchPrintSettings = useCallback((patch: Partial<MerchantReceiptPrintSettings>) => {
    setSettings((current) => ({
      ...current,
      printSettings: normalizeReceiptPrintSettingsForClient({
        ...current.printSettings,
        ...patch,
      }),
    }));
    setNotice("");
    setError("");
  }, []);

  const patchReceiptField = useCallback(
    (key: string, patch: Partial<MerchantReceiptContentField>) => {
      patchPrintSettings({
        receiptFields: printSettings.receiptFields.map((field) =>
          field.key === key
            ? {
                ...field,
                ...patch,
              }
            : field,
        ),
      });
    },
    [patchPrintSettings, printSettings.receiptFields],
  );

  const patchReceiptSectionVisible = useCallback(
    (section: MerchantReceiptFieldSection, visible: boolean) => {
      patchPrintSettings({
        receiptFields: printSettings.receiptFields.map((field) =>
          field.section === section
            ? {
                ...field,
                visible,
              }
            : field,
        ),
      });
    },
    [patchPrintSettings, printSettings.receiptFields],
  );

  const loadSettings = useCallback(async () => {
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setSettings(createEmptyMerchantMembershipSettings(normalizedSiteId));
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ siteId: normalizedSiteId });
      const response = await fetch(`/api/membership-settings?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "打印配置加载失败，请稍后重试"));
      }
      setSettings(normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "打印配置加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [normalizedSiteId]);

  async function saveSettings() {
    if (saving) return;
    if (!/^\d{8}$/.test(normalizedSiteId)) {
      setError("当前商户资料还没准备好，请稍后重试。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const normalized = normalizeMerchantMembershipSettings(normalizedSiteId, activeSettings);
      const response = await runWithMerchantOperationContext(
        {
          operationModule: "经营中心 > 打印机",
          operationAction: "保存打印样式",
          operationSummary: "在经营中心 > 打印机保存小票打印样式",
        },
        () =>
          fetch("/api/membership-settings", {
            method: "PUT",
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({ siteId: normalizedSiteId, settings: normalized }),
          }),
      );
      const payload = (await response.json().catch(() => null)) as MembershipSettingsPayload | null;
      if (!response.ok || payload?.ok !== true || !payload.settings) {
        throw new Error(readPayloadMessage(payload?.message, "打印配置保存失败，请稍后重试"));
      }
      setSettings(normalizeMerchantMembershipSettings(normalizedSiteId, payload.settings));
      invalidateMerchantAdminDataCachePrefix(makeMerchantAdminDataCacheKey("merchant-membership-settings", normalizedSiteId));
      setNotice("打印配置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "打印配置保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function checkBridge() {
    setBridgeChecking(true);
    setError("");
    setNotice("");
    try {
      const online = await checkLocalPrintBridge(printSettings);
      setBridgeStatus(online ? "online" : "offline");
      setNotice(online ? "本机打印助手已连接。" : "没有连接到本机打印助手，请先在收银电脑运行 print-helper。");
    } finally {
      setBridgeChecking(false);
    }
  }

  async function refreshBridgePrinters() {
    setBridgeChecking(true);
    setError("");
    setNotice("");
    try {
      const printers = await listLocalPrintBridgePrinters(printSettings);
      setBridgePrinters(printers);
      setBridgeStatus(printers.length ? "online" : "offline");
      setNotice(printers.length ? `已读取 ${printers.length} 台本机打印机。` : "未读取到打印机，请确认打印助手正在运行。");
    } finally {
      setBridgeChecking(false);
    }
  }

  async function testPrint() {
    setError("");
    setNotice("");
    if (printSettings.silentPrintEnabled) {
      setBridgeChecking(true);
      try {
        const printed = await printRedemptionReceiptWithLocalBridge(printSettings, previewReceipt);
        setBridgeStatus(printed ? "online" : "offline");
        if (printed) {
          setNotice("测试小票已发送到本机打印助手。");
          return;
        }
        if (!printSettings.fallbackToBrowserPrint) {
          setError("本机打印助手不可用，且未开启浏览器打印回退。");
          return;
        }
      } finally {
        setBridgeChecking(false);
      }
    }
    printRedemptionReceipt({ ...printSettings, silentPrintEnabled: false }, previewReceipt);
    setNotice("已打开浏览器测试打印。");
  }

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!error && !notice) return;
    showGlobalToast(error || notice);
    const timer = window.setTimeout(() => {
      setError("");
      setNotice("");
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [error, notice]);

  return (
    <section className={`space-y-4 py-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-950">打印机</h2>
          <p className="mt-1 text-sm text-slate-500">编辑积分兑换小票样式；结算成功后会按这里的配置自动打印。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            onClick={() => void loadSettings()}
            disabled={loading || saving}
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-900 bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-50 disabled:opacity-60"
            onClick={testPrint}
            disabled={saving}
          >
            测试打印
          </button>
          <button
            type="button"
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
            onClick={() => void saveSettings()}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <h3 className="text-base font-semibold text-slate-950">打印行为</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SwitchField
                label="启用小票打印"
                checked={printSettings.enabled}
                onChange={(checked) => patchPrintSettings({ enabled: checked })}
              />
              <SwitchField
                label="积分兑换结算后自动打印"
                checked={printSettings.autoPrintRedemptionReceipt}
                onChange={(checked) => patchPrintSettings({ autoPrintRedemptionReceipt: checked })}
              />
              <Field label="纸宽(mm)">
                <input
                  type="number"
                  min={40}
                  max={120}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.paperWidthMm}
                  onChange={(event) =>
                    patchPrintSettings({ paperWidthMm: parseInteger(event.target.value, 40, 120, printSettings.paperWidthMm) })
                  }
                />
              </Field>
              <Field label="字体(px)">
                <input
                  type="number"
                  min={9}
                  max={18}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.fontSizePx}
                  onChange={(event) =>
                    patchPrintSettings({ fontSizePx: parseInteger(event.target.value, 9, 18, printSettings.fontSizePx) })
                  }
                />
              </Field>
              <Field label="打印份数">
                <input
                  type="number"
                  min={1}
                  max={3}
                  step={1}
                  className={inputClassName()}
                  value={printSettings.copies}
                  onChange={(event) =>
                    patchPrintSettings({ copies: parseInteger(event.target.value, 1, 3, printSettings.copies) })
                  }
                />
              </Field>
            </div>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">本机静默打印助手</h3>
                <p className="mt-1 text-sm text-slate-500">
                  收银电脑运行本地助手后，小票会直接发给指定打印机；助手不可用时可回退到浏览器打印。
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  bridgeStatus === "online"
                    ? "bg-emerald-50 text-emerald-700"
                    : bridgeStatus === "offline"
                      ? "bg-rose-50 text-rose-700"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {bridgeStatus === "online" ? "已连接" : bridgeStatus === "offline" ? "未连接" : "未检测"}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SwitchField
                label="启用本机助手静默打印"
                checked={printSettings.silentPrintEnabled}
                onChange={(checked) => patchPrintSettings({ silentPrintEnabled: checked })}
              />
              <SwitchField
                label="助手不可用时回退到浏览器打印"
                checked={printSettings.fallbackToBrowserPrint}
                onChange={(checked) => patchPrintSettings({ fallbackToBrowserPrint: checked })}
              />
              <Field label="助手地址">
                <input
                  className={inputClassName()}
                  value={printSettings.localPrintBridgeUrl}
                  onChange={(event) => {
                    setBridgeStatus("unknown");
                    patchPrintSettings({ localPrintBridgeUrl: event.target.value });
                  }}
                  placeholder="http://127.0.0.1:17658"
                />
              </Field>
              <Field label="打印机名称">
                <input
                  list="faolla-local-printers"
                  className={inputClassName()}
                  value={printSettings.localPrinterName}
                  onChange={(event) => patchPrintSettings({ localPrinterName: event.target.value })}
                  placeholder="留空使用系统默认打印机"
                />
                <datalist id="faolla-local-printers">
                  {bridgePrinters.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.isDefault ? `${printer.name}（默认）` : printer.name}
                    </option>
                  ))}
                </datalist>
              </Field>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void checkBridge()}
                  disabled={bridgeChecking}
                >
                  {bridgeChecking ? "检测中..." : "检测助手"}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  onClick={() => void refreshBridgePrinters()}
                  disabled={bridgeChecking}
                >
                  读取本机打印机
                </button>
              </div>
            </div>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <h3 className="text-base font-semibold text-slate-950">票面文字</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="标题">
                <input
                  className={inputClassName()}
                  value={printSettings.title}
                  onChange={(event) => patchPrintSettings({ title: event.target.value })}
                />
              </Field>
              <Field label="副标题">
                <input
                  className={inputClassName()}
                  value={printSettings.subtitle}
                  onChange={(event) => patchPrintSettings({ subtitle: event.target.value })}
                />
              </Field>
              <Field label="底部文字" className="md:col-span-2">
                <input
                  className={inputClassName()}
                  value={printSettings.footer}
                  onChange={(event) => patchPrintSettings({ footer: event.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">小票内容</h3>
                <p className="mt-1 text-sm text-slate-500">按旧版分段方式编辑，切换分区后在表格里批量设置打印项。</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {RECEIPT_FIELD_SECTIONS.map((section) => {
                const fields = getReceiptFieldsBySection(printSettings, section.id);
                const visibleCount = fields.filter((field) => field.visible).length;
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`h-11 shrink-0 rounded-xl border px-3 text-left text-sm transition ${
                      activeReceiptSectionInfo.id === section.id
                        ? "border-slate-950 bg-slate-950 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                    }`}
                    onClick={() => setActiveReceiptSection(section.id)}
                    aria-pressed={activeReceiptSectionInfo.id === section.id}
                  >
                    <span className="block font-semibold leading-4">{section.label}</span>
                    <span className={activeReceiptSectionInfo.id === section.id ? "text-xs text-slate-200" : "text-xs text-slate-500"}>
                      {visibleCount}/{fields.length}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{activeReceiptSectionInfo.label}</h4>
                  <p className="mt-0.5 text-xs text-slate-500">{activeReceiptSectionInfo.hint}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onClick={() => patchReceiptSectionVisible(activeReceiptSectionInfo.id, true)}
                  >
                    全部打印
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    onClick={() => patchReceiptSectionVisible(activeReceiptSectionInfo.id, false)}
                  >
                    全部隐藏
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead className="bg-white text-xs text-slate-500">
                    <tr>
                      <th className="w-20 border-b border-slate-200 px-3 py-2 text-left font-semibold">打印</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left font-semibold">显示名称</th>
                      <th className="w-40 border-b border-slate-200 px-3 py-2 text-left font-semibold">宽度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeReceiptFields.map((field) => (
                      <tr key={field.key} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="checkbox"
                            checked={field.visible}
                            onChange={(event) => patchReceiptField(field.key, { visible: event.target.checked })}
                            aria-label={`${field.label} 是否打印`}
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <input
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.label}
                            onChange={(event) => patchReceiptField(field.key, { label: event.target.value })}
                            placeholder="显示名称"
                          />
                          <div className="mt-0.5 text-[11px] text-slate-400">{field.key}</div>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <select
                            className={inputClassName("h-8 rounded-lg text-xs")}
                            value={field.width}
                            onChange={(event) =>
                              patchReceiptField(field.key, {
                                width: event.target.value as MerchantReceiptContentField["width"],
                              })
                            }
                          >
                            {RECEIPT_FIELD_WIDTH_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>

        <aside className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-hidden">
          <h3 className="text-base font-semibold text-slate-950">小票预览</h3>
          <div className="mt-4 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 xl:max-h-[calc(100vh-6rem)]">
            <div
              className="mx-auto bg-white p-4 text-black shadow-sm"
              style={{
                width: `${Math.min(320, Math.max(220, printSettings.paperWidthMm * 3.2))}px`,
                fontSize: `${printSettings.fontSizePx}px`,
                lineHeight: 1.35,
              }}
            >
              <div className="border-b border-dashed border-black pb-2 text-center">
                <div className="text-lg font-bold">{printSettings.title}</div>
                {printSettings.subtitle ? <div className="text-xs text-slate-700">{printSettings.subtitle}</div> : null}
                {getVisibleReceiptFields(printSettings, "header").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div key={field.key} className={field.key === "siteId" ? "text-xs text-slate-700" : ""}>
                      {value}
                    </div>
                  ) : null;
                })}
              </div>
              <div className="grid grid-cols-6 gap-x-2 gap-y-1 border-b border-dashed border-black py-2">
                {getVisibleReceiptFields(printSettings, "meta").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div key={field.key} className={`flex justify-between gap-3 ${receiptPreviewWidthClass(field)}`}>
                      <span>{field.label}</span>
                      <strong className="text-right">{value}</strong>
                    </div>
                  ) : null;
                })}
              </div>
              <div className="py-2">
                {previewReceipt.lines.map((line) => (
                  <div key={line.code} className="border-b border-dashed border-slate-300 py-1">
                    <div className="flex justify-between gap-2">
                      <strong>{getReceiptLineFieldValue("itemName", line)}</strong>
                      {isReceiptFieldVisible(printSettings, "itemSubtotal") ? (
                        <span>{getReceiptLineFieldValue("itemSubtotal", line)}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-700">
                      {getVisibleReceiptFields(printSettings, "items")
                        .filter((field) => field.key !== "itemName" && field.key !== "itemSubtotal")
                        .map((field) => {
                          const value = getReceiptLineFieldValue(field.key, line);
                          return value ? `${field.label} ${value}` : "";
                        })
                        .filter(Boolean)
                        .join(" / ")}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-6 gap-x-2 gap-y-1 border-t border-dashed border-black pt-2">
                {getVisibleReceiptFields(printSettings, "summary").map((field) => {
                  const value = getReceiptFieldValue(field.key, previewReceipt);
                  return value ? (
                    <div
                      key={field.key}
                      className={`flex justify-between gap-3 ${receiptPreviewWidthClass(field)} ${
                        field.key === "totalPoints" ? "border-t border-black pt-1 text-base font-bold" : ""
                      }`}
                    >
                      <span>{field.label}</span>
                      <strong>{value}</strong>
                    </div>
                  ) : null;
                })}
              </div>
              {getVisibleReceiptFields(printSettings, "footer").map((field) => {
                if (field.key === "note" && previewReceipt.note) {
                  return (
                    <div key={field.key} className="mt-2 border-t border-dashed border-black pt-2">
                      {field.label}：{previewReceipt.note}
                    </div>
                  );
                }
                if (field.key === "footerText" && printSettings.footer) {
                  return (
                    <div key={field.key} className="mt-3 text-center font-bold">
                      {printSettings.footer}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
