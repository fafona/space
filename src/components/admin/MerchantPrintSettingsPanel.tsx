"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { showGlobalToast } from "@/lib/globalToast";
import {
  createEmptyMerchantMembershipSettings,
  normalizeMerchantMembershipSettings,
  type MerchantMembershipSettings,
  type MerchantReceiptPrintSettings,
} from "@/lib/merchantMembershipSettings";
import {
  buildRedemptionReceiptHtml,
  formatReceiptDateTime,
  formatReceiptPoints,
  normalizeReceiptPrintSettingsForClient,
  printHtmlDocument,
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

  function testPrint() {
    printHtmlDocument(buildRedemptionReceiptHtml(printSettings, previewReceipt));
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
            <h3 className="text-base font-semibold text-slate-950">显示内容</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {([
                ["商户名称", "showMerchantName"],
                ["站点ID", "showSiteId"],
                ["会员姓名", "showMemberName"],
                ["会员卡号", "showMemberNo"],
                ["项目编号", "showItemCode"],
                ["项目分类", "showItemCategory"],
                ["单项积分", "showUnitPoints"],
                ["卡券抵扣", "showCouponDiscount"],
                ["备注", "showNote"],
                ["时间", "showTimestamp"],
              ] as Array<[string, keyof MerchantReceiptPrintSettings]>).map(([label, key]) => (
                <SwitchField
                  key={key}
                  label={label}
                  checked={Boolean(printSettings[key])}
                  onChange={(checked) => patchPrintSettings({ [key]: checked })}
                />
              ))}
            </div>
          </section>
        </div>

        <aside className="rounded-[20px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)]">
          <h3 className="text-base font-semibold text-slate-950">小票预览</h3>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                {printSettings.showMerchantName ? <div>{previewReceipt.siteName}</div> : null}
                {printSettings.showSiteId ? <div className="text-xs text-slate-700">site:{previewReceipt.siteId}</div> : null}
              </div>
              <div className="space-y-1 border-b border-dashed border-black py-2">
                <div className="flex justify-between gap-3">
                  <span>小票号</span>
                  <strong>{previewReceipt.receiptNo}</strong>
                </div>
                {printSettings.showTimestamp ? (
                  <div className="flex justify-between gap-3">
                    <span>时间</span>
                    <strong>{formatReceiptDateTime(previewReceipt.createdAt)}</strong>
                  </div>
                ) : null}
                {printSettings.showMemberName || printSettings.showMemberNo ? (
                  <div className="flex justify-between gap-3">
                    <span>会员</span>
                    <strong>
                      {[
                        printSettings.showMemberName ? previewReceipt.memberName : "",
                        printSettings.showMemberNo ? previewReceipt.memberNo : "",
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </strong>
                  </div>
                ) : null}
              </div>
              <div className="py-2">
                {previewReceipt.lines.map((line) => (
                  <div key={line.code} className="border-b border-dashed border-slate-300 py-1">
                    <div className="flex justify-between gap-2">
                      <strong>{line.name}</strong>
                      <span>{line.couponPointDiscount > 0 ? `-${line.couponPointDiscount}` : line.subtotalPoints}</span>
                    </div>
                    <div className="text-xs text-slate-700">
                      {[
                        printSettings.showItemCode ? `编号 ${line.code}` : "",
                        printSettings.showItemCategory ? line.categoryName : "",
                        printSettings.showUnitPoints ? `${line.unitPoints} x ${line.quantity}` : `数量 ${line.quantity}`,
                        line.couponDiscountLabel,
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-1 border-t border-dashed border-black pt-2">
                <div className="flex justify-between gap-3">
                  <span>原始积分</span>
                  <strong>{formatReceiptPoints(previewReceipt.grossPoints)}</strong>
                </div>
                {printSettings.showCouponDiscount ? (
                  <div className="flex justify-between gap-3">
                    <span>卡券抵扣</span>
                    <strong>-{formatReceiptPoints(previewReceipt.couponPointDiscountTotal)}</strong>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 border-t border-black pt-1 text-base font-bold">
                  <span>扣减积分</span>
                  <strong>{formatReceiptPoints(previewReceipt.totalPoints)}</strong>
                </div>
              </div>
              {printSettings.showNote ? <div className="mt-2 border-t border-dashed border-black pt-2">备注：{previewReceipt.note}</div> : null}
              {printSettings.footer ? <div className="mt-3 text-center font-bold">{printSettings.footer}</div> : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
