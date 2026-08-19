"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { buildSuperAdminLoginHref } from "@/lib/superAdminAuth";

type RecoveryStatus = {
  ok?: boolean;
  error?: string;
  state?:
    | "awaiting_user_verification"
    | "ready_for_approval"
    | "approval_attempt_pending"
    | "completed";
  readyForApproval?: boolean;
  created?: boolean;
};

function statusText(status: RecoveryStatus | null) {
  if (status?.state === "completed") {
    return "固定恢复对象已建立规范个人账号授权。现在应关闭恢复环境开关并重新部署；关闭后接口会返回 410。";
  }
  if (status?.state === "ready_for_approval") {
    return "用户已完成新鲜邮箱 OTP 验证。批准时服务器会重新执行全部权威检查。";
  }
  if (status?.state === "approval_attempt_pending") {
    return "检测到服务端签名的审批尝试。重新批准只会完成已建立的固定授权；若授权尚未写入，服务器仍会要求新的 OTP。";
  }
  return "尚未检测到有效的用户邮箱验证标记。";
}

function errorText(code: string) {
  if (code === "legacy_personal_recovery_disabled") {
    return "恢复通道已关闭（410）。";
  }
  if (code === "legacy_personal_recovery_expired") {
    return "固定恢复 case 已过期（410）。";
  }
  if (code === "legacy_personal_recovery_verification_required") {
    return "用户验证标记不存在或已过期，请用户重新验证。";
  }
  if (
    code === "legacy_personal_recovery_metadata_drift" ||
    code === "legacy_personal_recovery_candidate_conflict" ||
    code === "legacy_personal_recovery_directory_conflict" ||
    code === "legacy_personal_recovery_readiness_blocked"
  ) {
    return "权威预检发现冲突，审批已安全停止。请先核查数据库状态，不要绕过检查。";
  }
  if (code === "legacy_personal_recovery_rate_limited") {
    return "审批操作过于频繁，请稍后重试。";
  }
  return "恢复审批服务暂时不可用。";
}

export default function LegacyPersonalRecoveryApprovalClient() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/super-admin/legacy-personal-recovery", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as RecoveryStatus | null;
      if (response.status === 401) {
        window.location.href = buildSuperAdminLoginHref(
          "/super-admin/personal-recovery",
        );
        return;
      }
      if (!response.ok || payload?.ok !== true) {
        throw new Error(errorText(payload?.error ?? ""));
      }
      setStatus(payload);
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : "状态读取失败。" );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    if (approving || status?.readyForApproval !== true) return;
    setApproving(true);
    setMessage("");
    try {
      const response = await fetch("/api/super-admin/legacy-personal-recovery", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const payload = (await response.json().catch(() => null)) as RecoveryStatus | null;
      if (response.status === 401) {
        window.location.href = buildSuperAdminLoginHref(
          "/super-admin/personal-recovery",
        );
        return;
      }
      if (!response.ok || payload?.ok !== true || payload.state !== "completed") {
        throw new Error(errorText(payload?.error ?? ""));
      }
      setStatus({ ...payload, readyForApproval: false });
      setMessage(
        payload.created
          ? "恢复已完成，规范授权已创建并写入哈希审计标记。"
          : "恢复已确认完成；本次为安全幂等重试，没有创建第二条授权。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审批失败。" );
      await load();
    } finally {
      setApproving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <section className="mx-auto w-full max-w-2xl space-y-5 rounded-2xl border bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-slate-950">一次性个人账号恢复审批</h1>
          <p className="text-sm leading-6 text-slate-600">
            此审批不接受账号 UUID 或 ID 参数。服务器只读取部署时固定的唯一 case，并在写入前重新检查 OTP 标记、权威 resolver、目录冲突和 036 readiness/ACL。
          </p>
        </div>

        <div className="rounded-xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          {loading ? "正在读取受保护状态..." : statusText(status)}
        </div>

        {message ? (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900" role="status">
            {message}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void load()}
            disabled={loading || approving}
          >
            重新检查状态
          </button>
          <button
            type="button"
            className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={() => void approve()}
            disabled={loading || approving || status?.readyForApproval !== true}
          >
            {approving ? "正在执行权威检查与恢复..." : "批准固定恢复对象"}
          </button>
          <Link
            href="/super-admin/latest"
            className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50"
          >
            返回超级后台
          </Link>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          成功后必须把 ORDINARY_LEGACY_PERSONAL_RECOVERY_ENABLED 设回 false 并部署。不要删除或修改数据库记录来代替关闭通道。
        </div>
      </section>
    </main>
  );
}
