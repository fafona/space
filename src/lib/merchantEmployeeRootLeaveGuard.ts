import type { MerchantEmployeeWorkspaceRoot } from "./merchantBusinessCapabilities";

/** One registration slot per mounted collaboration/authorization scope. Old
 * registration callbacks and cleanup closures never mutate a replacement slot. */
export function createMerchantEmployeeRootLeaveGuard(scopeKey: string) {
  let guard: (() => boolean) | null = null;
  return {
    scopeKey,
    register: (next: (() => boolean) | null) => { guard = next; },
    clear: () => { guard = null; },
    allowUserRootChange: (
      current: MerchantEmployeeWorkspaceRoot | null,
      next: MerchantEmployeeWorkspaceRoot,
    ) => current !== "collaboration" || next === current || guard === null || guard(),
  };
}
