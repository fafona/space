export type AccountEmailVerificationState = {
  emailConfirmed: boolean;
  emailVerificationKnown?: boolean;
};

export function getAccountEmailVerificationStatus(account: AccountEmailVerificationState | null | undefined) {
  if (!account || account.emailVerificationKnown === false) return "unknown";
  return account.emailConfirmed ? "verified" : "unverified";
}
