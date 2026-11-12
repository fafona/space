export type EmailVerificationTarget = {
  authUserId: string | null;
  accountId: string;
  accountType: "merchant" | "personal";
  email: string;
};
export type AccountEmailVerificationResult = EmailVerificationTarget & {
  emailConfirmed: true;
  emailVerificationKnown: true;
  emailConfirmedAt: string;
};

export async function confirmSuperAdminAccountEmail(account: EmailVerificationTarget, deps: {
  confirm: (message: string) => boolean;
  request: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const {confirm, request} = deps;
  if (!account.authUserId || !account.accountId || !account.email) throw Error("账号身份不完整，请刷新列表");
  if (!confirm(`确认已人工核实账号「${account.email}」（ID：${account.accountId}）的注册人身份？\n继续将由超级管理员完成该账号的邮箱验证，用户无需再输入注册验证码。不会修改密码、套餐或服务期限，也不会替用户登录。`)) return null;
  const response = await request("/api/super-admin/merchant-accounts", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({action: "verify_email", authUserId: account.authUserId, accountId: account.accountId,
      accountType: account.accountType, email: account.email, confirmed: true}),
  });
  const payload = await response.json().catch(() => null) as {verification?: AccountEmailVerificationResult; message?: string; alreadyVerified?: boolean} | null;
  const v = payload?.verification;
  if (!response.ok || !v || v.authUserId !== account.authUserId || v.accountId !== account.accountId ||
      v.accountType !== account.accountType || typeof v.email !== "string" || v.email.toLowerCase() !== account.email.trim().toLowerCase() ||
      v.emailConfirmed !== true || v.emailVerificationKnown !== true || !v.emailConfirmedAt || !Number.isFinite(Date.parse(v.emailConfirmedAt)))
    throw Error(payload?.message || "无法确认验证结果，请刷新账号状态后重试");
  return {verification: v, alreadyVerified: payload?.alreadyVerified === true};
}
