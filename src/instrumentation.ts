export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMerchantBookingAutomationRuntime } = await import("@/lib/merchantBookingAutomationRuntime");
  startMerchantBookingAutomationRuntime();
}
