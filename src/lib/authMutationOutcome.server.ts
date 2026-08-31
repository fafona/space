import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export function isDefinitiveAuthMutationRejection(error: unknown) {
  if (isAuthRetryableFetchError(error)) return false;
  const status = Number(
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : Number.NaN,
  );
  return Number.isInteger(status) && status >= 400 && status < 500;
}
