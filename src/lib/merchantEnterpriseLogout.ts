type AuthStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
type LogoutResult = { error: Error | null; localCleared: boolean };

/** Tab-local logout fencing. Never touches merchant auth or attendance drafts. */
export function createEnterpriseLogoutBoundary(base: AuthStorage, key: string) {
  if (!key.endsWith("-enterprise-auth-token")) throw new Error("enterprise_storage_key_required");
  const marker = key + ".logout-pending";
  const owned = [key, key + "-user", key + "-code-verifier"];
  let blocked = false;
  let revoking = false;
  let snapshot: string | null = null;
  let signingIn = false;
  let flight: Promise<LogoutResult> | null = null;
  let operation: string | null = null;
  const originals = new Map<string, string | null>();
  const remember = () => { try { base.setItem(marker, operation ?? "1"); } catch { /* Also purge the original session synchronously. */ } };
  const ownsIntent = () => { try { return operation !== null && base.getItem(marker) === operation; } catch { return false; } };
  const removeLogoutKey = (item: string) => {
    // An unloaded/restored document must not erase a new page's later login.
    // Without a durable marker, remove only the exact credential we captured.
    if (ownsIntent() || (originals.has(item) && base.getItem(item) === originals.get(item))) base.removeItem(item);
  };
  const purge = (clearMarker = true) => {
    for (const item of owned) { try { base.removeItem(item); } catch { /* Verify every owned key below. */ } }
    const cleared = owned.every(item => { try { return base.getItem(item) === null; } catch { return false; } });
    if (cleared && clearMarker) {
      try { base.removeItem(marker); return base.getItem(marker) === null; }
      catch { return false; }
    }
    else remember();
    return cleared;
  };
  // Runs before the SDK is constructed. A new page must not recover the
  // initiating page's RAM snapshot or a refresh that raced with its logout.
  try { if (base.getItem(marker) !== null) blocked = !purge(); }
  catch { blocked = !purge(); }

  const storage: AuthStorage = {
    getItem(item) {
      if (blocked && owned.includes(item)) return revoking && item === key ? snapshot : null;
      return base.getItem(item);
    },
    setItem(item, value) {
      if (blocked && owned.includes(item)) {
        if (!signingIn || item !== key) return;
        // Only the explicit subsequent login may open this boundary, after
        // its new SDK session was actually persisted. Failed logins cannot.
        base.setItem(item, value);
        if (base.getItem(item) !== value) throw new Error("无法保存员工登录状态，请检查浏览器存储设置。");
        base.removeItem(marker);
        if (base.getItem(marker) !== null) throw new Error("无法清除上次退出状态，请检查浏览器存储设置。");
        blocked = false;
        return;
      }
      base.setItem(item, value);
    },
    removeItem(item) {
      if (revoking && owned.includes(item)) removeLogoutKey(item);
      else base.removeItem(item);
    },
  };

  const signOut = (action: () => Promise<{ error: Error | null }>): Promise<LogoutResult> => {
    if (flight) return flight;
    if (signingIn) return Promise.resolve({ error: new Error("正在验证账号，请稍后再退出。"), localCleared: false });
    operation = globalThis.crypto.randomUUID();
    originals.clear();
    for (const item of owned) { try { originals.set(item, base.getItem(item)); } catch { /* Cleanup must report unverified storage. */ } }
    snapshot = originals.get(key) ?? null;
    blocked = true;
    revoking = true;
    remember();
    // Do not wait for the network before removing the reloadable credential.
    // The original SDK can still read the RAM snapshot to revoke remotely.
    purge(false);
    flight = Promise.resolve().then(async () => {
      let error: Error | null = null;
      try { error = (await action()).error; }
      catch { error = new Error("服务器退出请求未确认。"); }
      finally { snapshot = null; revoking = false; }
      for (const item of owned) { try { removeLogoutKey(item); } catch { /* Verify below. */ } }
      const localCleared = owned.every(item => {
        try {
          const current = base.getItem(item);
          return current === null || (!ownsIntent() && originals.has(item) && current !== originals.get(item));
        } catch { return false; }
      });
      if (localCleared && !error && ownsIntent()) { try { base.removeItem(marker); } catch { /* Recover the marker on next navigation. */ } }
      originals.clear();
      return { error: localCleared ? error : new Error("浏览器未能清除员工登录状态，请关闭此标签页并清理本站数据。"), localCleared };
    }).finally(() => { flight = null; });
    return flight;
  };

  const signIn = async <T>(action: () => Promise<T>): Promise<T> => {
    if (flight) await flight;
    if (signingIn) throw new Error("正在验证账号，请勿重复提交。");
    signingIn = true;
    try {
      const result = await action();
      if (result && typeof result === "object" && "error" in result && result.error) {
        blocked = true;
        purge();
      }
      return result;
    } catch (error) {
      blocked = true;
      purge();
      throw error;
    } finally { signingIn = false; }
  };
  return { storage, isBlocked: () => blocked, signOut, signIn };
}
