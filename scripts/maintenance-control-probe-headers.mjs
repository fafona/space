import { readMaintenanceProbeContext } from "./production-maintenance-control.mjs";

export function maintenanceProbeHeaders(target, method, environment = process.env, readContext = readMaintenanceProbeContext) {
  const context = readContext(environment);
  if (context === null) return {};
  if (!context || !/^[0-9a-f]{64}$/.test(context.token ?? "")) throw new Error("maintenance_probe_context_invalid");
  let base;
  let destination;
  try { base = new URL(context.publicSupabaseUrl); destination = new URL(target); } catch { throw new Error("maintenance_probe_url_invalid"); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
      destination.username || destination.password || destination.hash) throw new Error("maintenance_probe_url_invalid");
  if (destination.origin !== base.origin) return {};
  const prefix = base.pathname.replace(/\/+$/, "");
  if (!destination.pathname.startsWith(`${prefix}/`)) return {};
  const relative = destination.pathname.slice(prefix.length);
  const allowed = (method === "GET" && ["/rest/v1/", "/rest/v1/pages", "/auth/v1/settings"].includes(relative)) ||
    (method === "POST" && relative === "/auth/v1/token" && destination.search === "?grant_type=password");
  if (!allowed) return {};
  return { "x-faolla-maintenance-control": context.token };
}
