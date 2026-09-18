type WorkspaceEntryInput = {
  desktopWorkspace: boolean;
  authenticated: boolean;
  merchantId: string;
  authorizedMerchantIds: readonly string[];
  profile: { id: string; permissionConfig?: object | null } | null | undefined;
};

// This only controls a loading screen. API authorization remains authoritative.
// A public profile, cached ID or URL alone must never enable the fast path.
export function canShowMerchantWorkspaceBeforeEditor(input: WorkspaceEntryInput): boolean {
  return (
    input.desktopWorkspace &&
    input.authenticated &&
    /^\d{8}$/.test(input.merchantId) &&
    input.authorizedMerchantIds.includes(input.merchantId) &&
    input.profile?.id === input.merchantId &&
    input.profile.permissionConfig != null
  );
}
