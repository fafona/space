import { getAccountEmailVerificationStatus, type AccountEmailVerificationState } from "@/lib/accountEmailVerification";

export function AccountEmailVerificationStatus({account}: {account: AccountEmailVerificationState | null | undefined}) {
  const status = getAccountEmailVerificationStatus(account);
  return <span data-email-verification={status} className={`inline-flex w-fit rounded border px-2 py-0.5 text-xs ${
    status === "verified" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
    status === "unverified" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
    {status === "verified" ? "已验证" : status === "unverified" ? "未验证" : "验证状态待核验"}
  </span>;
}

export function VerifyAccountEmailButton({account, busy, pending = busy, onVerify}: {
  account: (AccountEmailVerificationState & {authUserId: string | null; accountId: string; email: string}) | null | undefined;
  busy: boolean;
  pending?: boolean;
  onVerify: () => void;
}) {
  if (getAccountEmailVerificationStatus(account) !== "unverified" || !account?.authUserId || !account.accountId || !account.email) return null;
  return <button type="button" className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 disabled:opacity-40"
    title="仅在已人工核实注册人身份后操作，免除此账号的注册邮箱验证码" disabled={busy} onClick={onVerify}>
    {pending ? "验证处理中…" : "验证账号"}
  </button>;
}
