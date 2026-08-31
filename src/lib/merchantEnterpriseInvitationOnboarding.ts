export const MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY = "onboarding";
export const MERCHANT_ENTERPRISE_INITIAL_PASSWORD_ONBOARDING = "initial-password";

export function addMerchantEnterpriseInitialPasswordOnboarding(redirectTo: string) {
  const redirect = new URL(redirectTo);
  redirect.searchParams.set(
    MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY,
    MERCHANT_ENTERPRISE_INITIAL_PASSWORD_ONBOARDING,
  );
  return redirect.toString();
}

export function hasMerchantEnterpriseInitialPasswordOnboarding(
  params: URLSearchParams,
) {
  return (
    params.getAll(MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY).length === 1 &&
    params.get(MERCHANT_ENTERPRISE_ONBOARDING_QUERY_KEY) ===
      MERCHANT_ENTERPRISE_INITIAL_PASSWORD_ONBOARDING
  );
}
