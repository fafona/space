import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import { createServerSupabaseServiceClient } from "../src/lib/superAdminServer";

export function parseTrafficRetentionArgs(args: string[], enabled = process.env.FAOLLA_TRAFFIC_RETENTION_ENABLED === "1") {
  if (args.some((arg) => arg !== "--apply" && !/^--batch=\d+$/.test(arg))) throw new Error("unknown_retention_argument");
  const apply = args.includes("--apply");
  const batches = args.filter((arg) => arg.startsWith("--batch="));
  if (batches.length > 1) throw new Error("duplicate_batch_argument");
  const batch = batches.length ? Number(batches[0].slice(8)) : 5000;
  if (!Number.isInteger(batch) || batch < 1 || batch > 10000) throw new Error("invalid_batch_size");
  if (apply && !enabled) throw new Error("traffic_retention_apply_not_enabled");
  return { apply, batch };
}

export async function maintainAccountTraffic(args = process.argv.slice(2)) {
  const { apply, batch } = parseTrafficRetentionArgs(args);
  const client = createServerSupabaseServiceClient();
  if (!client) throw new Error("traffic_database_unavailable");
  // One bounded batch, no endless draining loop and no maintenance-mode toggle.
  const { data, error } = await client.rpc("faolla_account_traffic_retention", { p_apply: apply, p_batch_size: batch })
    .abortSignal(AbortSignal.timeout(30000));
  if (error) throw new Error("traffic_retention_failed");
  if (!data || data.blockedMissingRollups > 0 || data.busy) throw new Error("traffic_retention_guard_blocked");
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", ...data }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  maintainAccountTraffic().catch((error) => { console.error(error instanceof Error ? error.message : "traffic_retention_failed"); process.exitCode = 1; });
}
