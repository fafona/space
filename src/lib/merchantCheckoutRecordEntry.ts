export function parsePersonalCheckoutEntryHint(input: unknown, accountId: string | undefined): string[] {
  if (typeof accountId !== "string" || !/^\d{8}$/.test(accountId) || !input || typeof input !== "object" || !("accountId" in input) || input.accountId !== accountId || !("siteIds" in input)
    || !Array.isArray(input.siteIds) || input.siteIds.length > 100 || !input.siteIds.every(id => typeof id === "string" && /^\d{8}$/.test(id))
    || new Set(input.siteIds).size !== input.siteIds.length) return [];
  return [...input.siteIds] as string[];
}
