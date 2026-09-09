"use client";

import { useState, useSyncExternalStore } from "react";
import PlatformAdminBackupRestoreDialog from "@/components/admin/PlatformAdminBackupRestoreDialog";
import PlatformAdminBackupRestoreReceiptPanel from "@/components/admin/PlatformAdminBackupRestoreReceiptPanel";
import PlatformAdminBackupRestoreInspectionPanel from "@/components/admin/PlatformAdminBackupRestoreInspectionPanel";
import type { PlatformAdminBackupRestoreInspectionResult } from "@/lib/platformAdminBackupRestoreInspectionClient";
import type { PlatformAdminBackupRestorePreview } from "@/lib/platformAdminBackupRestorePreview";
import { PLATFORM_ADMIN_DATA_BACKUP_SCOPE } from "@/lib/platformAdminDataBackupScope";
import { readRestoreJournal, writeRestoreJournalAhead, clearRestoreJournalExact,
  withRestoreJournalExclusive, withRestoreJournalWriter } from "@/lib/platformAdminBackupRestoreJournal";

// Synthetic fixture key only. Never read or mutate the application's journal key.
const testJournalKey = "faolla:test-harness:restore-journal:v1";
const testAttempt = Object.freeze({ deviceId: "synthetic-fixture-device", binding: Object.freeze({
  operationId: "11111111-2222-4333-8444-555555555555", scope: "support_messages" as const,
  backupId: "synthetic-backup", confirmationToken: `v1.${"a".repeat(64)}`,
}) });
const testStorage = {
  getItem: () => window.localStorage.getItem(testJournalKey),
  setItem: (_key: string, value: string) => window.localStorage.setItem(testJournalKey, value),
  removeItem: () => window.localStorage.removeItem(testJournalKey),
};
const testJournalChanged = "faolla-test-restore-journal-changed";
function subscribeSyntheticJournal(changed: () => void) {
  window.addEventListener("storage", changed);
  window.addEventListener(testJournalChanged, changed);
  return () => { window.removeEventListener("storage", changed); window.removeEventListener(testJournalChanged, changed); };
}
function syntheticJournalSnapshot() {
  const result = readRestoreJournal(testStorage);
  return result.status === "pending" ? `待核对 ${result.attempt.binding.operationId}；页面应用未确认；不会自动重发`
    : result.status === "empty" ? "无合成待核对记录" : "合成记录读取异常；保护保持";
}
function readSyntheticJournal() { window.dispatchEvent(new Event(testJournalChanged)); }

const emptyPreview: PlatformAdminBackupRestorePreview = {
  version: 1, backupId: "synthetic-backup", backupAt: "2026-09-08T12:00:00.000Z", scope: "support_messages",
  confirmationToken: `v1.${"a".repeat(64)}`,
  counts: [
    { key: "support_threads", label: "平台客服会话", current: 3, target: 0, source: "server" },
    { key: "support_messages", label: "平台客服消息", current: 12, target: 0, source: "server" },
  ],
  requiresEmptyConfirmation: true, emptyKeys: ["support_threads", "support_messages"],
  excluded: [...PLATFORM_ADMIN_DATA_BACKUP_SCOPE.excluded],
  warning: "纯合成预览：当前内容与快照内容对比，不是数据库锁。此测试组件不调用业务 API，不写入真实数据。",
};
const browserPreview: PlatformAdminBackupRestorePreview = {
  ...emptyPreview, scope: "user_manage", requiresEmptyConfirmation: false, emptyKeys: [],
  counts: [
    { key: "merchant_directory", label: "商户目录条目", current: 4, target: 3, source: "server" },
    { key: "browser_sites", label: "本浏览器后台站点配置", current: null, target: 3, source: "browser" },
  ],
};

/** Synthetic UI fixture; persistence uses only its own isolated test key.
 * No auth mocks, network interception or business/database requests.
 */
export default function BackupRestoreHarness() {
  const [preview, setPreview] = useState<PlatformAdminBackupRestorePreview | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState("尚未执行；真实写入次数 0");
  const [receiptStatus, setReceiptStatus] = useState<"pending" | "unknown" | "committed" | "rejected">("unknown");
  const [application, setApplication] = useState<"unconfirmed" | "applied">("unconfirmed");
  const [queries, setQueries] = useState(0);
  const [inspectionMode, setInspectionMode] = useState<"matches_commit" | "differs_from_commit" | "unknown" | "error">("matches_commit");
  const [inspectionResult, setInspectionResult] = useState<PlatformAdminBackupRestoreInspectionResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState(false);
  const [inspections, setInspections] = useState(0);
  const journalStatus = useSyncExternalStore(subscribeSyntheticJournal, syntheticJournalSnapshot, () => "正在读取合成接续记录");
  const [journalResult, setJournalResult] = useState("");
  const [releaseWriter, setReleaseWriter] = useState<(() => void) | null>(null);
  async function saveSyntheticJournal() {
    try {
      await withRestoreJournalExclusive(navigator.locks, () => writeRestoreJournalAhead(testStorage, testAttempt));
      setJournalResult("已保留合成操作；业务 PATCH 次数 0");
    } catch { setJournalResult("新操作已拦截；未覆盖旧记录；业务 PATCH 次数 0"); }
    readSyntheticJournal();
  }
  async function holdSyntheticWriter() {
    try {
      await withRestoreJournalWriter(testStorage, navigator.locks, () => new Promise<void>((resolve) => {
        setReleaseWriter(() => resolve); setJournalResult("合成共享写锁占用中；业务写入次数 0");
      }));
      setReleaseWriter(null); setJournalResult("合成共享写锁已释放");
    } catch { setJournalResult("合成写入已拦截；保护保持"); }
  }
  function open(value: PlatformAdminBackupRestorePreview) {
    setConfirmEmpty(false); setSubmitting(false); setPreview(value);
  }
  function finishSyntheticInspection() {
    setInspecting(false);
    if (inspectionMode === "error") { setInspectionError(true); return; }
    if (inspectionMode === "unknown") {
      setInspectionResult({ ok: true, outcome: "unknown", receipt: null, inspection: null }); return;
    }
    setInspectionResult({ ok: true, outcome: "committed", receipt: {
      ...testAttempt.binding, version: 1, planHash: "c".repeat(64), resultHash: "d".repeat(64), committedAt: "2026-09-09T12:00:00Z",
    }, inspection: { version: 1, observedAt: "2026-09-09T12:05:00Z", targetState: inspectionMode,
      targetHash: (inspectionMode === "matches_commit" ? "d" : "e").repeat(64) } });
  }
  return <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
    <h1 className="text-xl font-semibold">应用快照恢复确认 · 本地合成验收</h1>
    <p className="my-3">复用真实组件及接续工具；不登录、不请求业务接口。只写独立的合成测试记录。</p>
    <section className="my-4 space-y-3 rounded border bg-white p-4" aria-label="合成刷新接续验收">
      <h2 className="font-semibold">合成刷新接续（身份核验另由自动化测试，不代表真实登录）</h2>
      <p>{journalStatus}</p><p role="status">{journalResult}</p>
      <div className="flex flex-wrap gap-2">
        <button className="rounded border p-2" onClick={() => void saveSyntheticJournal()}>保留合成待核对操作</button>
        <button className="rounded border p-2" onClick={() => window.location.reload()}>刷新合成页面</button>
        <button className="rounded border p-2" onClick={() => { readSyntheticJournal(); setJournalResult("模拟只读查询确认历史提交；接续记录仍保留；页面应用未确认；业务 PATCH 次数 0"); }}>模拟接续只读查询</button>
        <button className="rounded border p-2" disabled={!!releaseWriter} onClick={() => void holdSyntheticWriter()}>占用合成共享写锁</button>
        <button className="rounded border p-2" disabled={!releaseWriter} onClick={() => releaseWriter?.()}>释放合成共享写锁</button>
        <button className="rounded border p-2" onClick={async () => {
          try { await withRestoreJournalExclusive(navigator.locks, () => clearRestoreJournalExact(testStorage, testAttempt));
            setJournalResult("仅清理本测试的固定合成记录"); }
          catch { setJournalResult("没有可安全清理的匹配合成记录"); }
          readSyntheticJournal();
        }}>清理本测试合成记录</button>
      </div>
    </section>
    <div className="flex flex-wrap gap-3">
      <button className="rounded border bg-white px-4 py-2" onClick={() => open(emptyPreview)}>打开空内容预览</button>
      <button className="rounded border bg-white px-4 py-2" onClick={() => open(browserPreview)}>打开配置预览</button>
      <button className="rounded border bg-white px-4 py-2" onClick={() => { setSubmitting(false); setPreview(null); setOutcome("模拟中途失败：可能部分写入，禁止自动重试；真实写入次数 0"); }}>模拟失败响应</button>
      <button className="rounded border bg-white px-4 py-2" onClick={() => open({ ...emptyPreview, receiptProtocol: 1 })}>打开凭据协议预览</button>
    </div>
    <p role="status" className="mt-5">{outcome}</p>
    <section className="mt-5 max-w-4xl">
      <h2 className="font-semibold">凭据展示合成状态（不发请求）</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded border bg-white p-2" onClick={() => { setReceiptStatus("unknown"); setApplication("unconfirmed"); }}>模拟未知</button>
        <button className="rounded border bg-white p-2" onClick={() => { setReceiptStatus("pending"); setApplication("unconfirmed"); }}>模拟提交中</button>
        <button className="rounded border bg-white p-2" onClick={() => { setReceiptStatus("rejected"); setApplication("unconfirmed"); }}>模拟提交前拒绝</button>
        <button className="rounded border bg-white p-2" onClick={() => { setReceiptStatus("committed"); setApplication("applied"); }}>模拟页面应用完成</button>
      </div>
      <PlatformAdminBackupRestoreReceiptPanel operationId="11111111-2222-4333-8444-555555555555" backupId="synthetic-backup"
        scope="support_messages" status={receiptStatus} application={application} querying={false}
        committedAt={receiptStatus === "committed" ? "2026-09-09T12:00:00Z" : undefined}
        onQuery={() => { setQueries((value) => value + 1); setReceiptStatus("committed"); }} />
      <p className="mt-2 text-sm">模拟只读查询次数 {queries}；业务请求/写入次数 0。查询不会改变页面应用状态。</p>
    </section>
    <section className="mt-5 max-w-4xl" aria-label="只读核对合成验收">
      <h2 className="font-semibold">当前数据核对合成状态（无真实请求）</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="rounded border bg-white p-2" disabled={inspecting} onClick={() => setInspectionMode("matches_commit")}>选择合成一致</button>
        <button className="rounded border bg-white p-2" disabled={inspecting} onClick={() => setInspectionMode("differs_from_commit")}>选择合成不同</button>
        <button className="rounded border bg-white p-2" disabled={inspecting} onClick={() => setInspectionMode("unknown")}>选择合成无凭据</button>
        <button className="rounded border bg-white p-2" disabled={inspecting} onClick={() => setInspectionMode("error")}>选择合成异常</button>
        <button className="rounded border bg-white p-2" disabled={!inspecting} onClick={finishSyntheticInspection}>完成合成核对</button>
      </div>
      <PlatformAdminBackupRestoreInspectionPanel result={inspectionResult} inspecting={inspecting} error={inspectionError}
        onInspect={() => { setInspectionResult(null); setInspectionError(false); setInspecting(true); setInspections((value) => value + 1); }} />
      <p className="mt-2 text-sm">合成核对次数 {inspections}；业务请求/写入次数 0。接续记录与现有保护保持不变。</p>
    </section>
    {preview ? <PlatformAdminBackupRestoreDialog preview={preview} confirmEmpty={confirmEmpty} submitting={submitting}
      onConfirmEmptyChange={setConfirmEmpty}
      onCancel={() => { setPreview(null); setOutcome("已取消；真实写入次数 0"); }}
      onConfirm={() => { setSubmitting(true); setOutcome("仅模拟执行中；真实写入次数 0"); }} /> : null}
  </main>;
}
