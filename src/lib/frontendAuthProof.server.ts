import { type PlatformAccountType } from "@/lib/platformAccounts";

export type FrontendAuthProofPayload = {
  accountType: PlatformAccountType;
  accountId: string;
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

export function createFrontendAuthProof(input: {
  accountType: PlatformAccountType | null | undefined;
  accountId?: string | null;
  userId?: string | null;
  email?: string | null;
}) {
  void input;
  // Emergency fail-closed boundary: browser-carried proofs were not scoped to
  // an origin/site and were replayable across merchant subdomains. A future
  // replacement must be audience-bound, short lived, and single use.
  return "";
}

export function verifyFrontendAuthProof(value: unknown): FrontendAuthProofPayload | null {
  void value;
  // Deliberately invalidate every previously issued proof immediately.
  return null;
}
