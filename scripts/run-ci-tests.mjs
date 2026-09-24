import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverLocalTests, runLocalTests } from "./run-local-tests.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const fixedGroups = {
  workflow: ["scripts/ci-workflow-contract.test.mjs"],
  topology: ["scripts/check-production-maintenance-topology.test.mjs", "scripts/check-production-maintenance-capabilities.test.mjs"],
  maintenance: ["scripts/maintenance-control-probe-headers.test.mjs", "scripts/pages-client-write-acl-migration-contract.test.mjs", "scripts/pages-acl-integration/run.test.mjs"],
  scheduler: ["scripts/maintenance-supabase-scheduler-profile.test.mjs", "scripts/maintenance-supabase-scheduler-acceptance.test.mjs"],
};
const maintenancePattern = /^scripts\/production-maintenance-[^/]+\.test\.mjs$/;

/** Every discovered unit/contract file belongs to exactly one mandatory CI step.
 * Keep this independent from arbitrary skip patterns, environment or CLI input.
 * Operational acceptance entrypoints are not unit tests and stay in their jobs.
 */
export function partitionCiTests(files) {
  if (!Array.isArray(files) || files.length === 0 || new Set(files).size !== files.length) {
    throw new Error("ci_test_inventory_invalid");
  }
  for (const file of files) {
    if (typeof file !== "string" || !/^(?:src|scripts)\/.+\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/.test(file)
      || file.includes("\\") || file.split("/").some((part) => part === ".." || part === "." || !part)) {
      throw new Error("ci_test_path_invalid");
    }
  }
  const inventory = new Set(files);
  const groups = Object.fromEntries(Object.entries(fixedGroups).map(([name, members]) => [name, [...members]]));
  for (const file of Object.values(fixedGroups).flat()) {
    if (!inventory.has(file)) throw new Error(`ci_required_test_missing:${file}`);
  }
  groups.maintenance.push(...files.filter((file) => maintenancePattern.test(file)));
  if (!groups.maintenance.includes("scripts/production-maintenance-native-proof.test.mjs")
    || !groups.maintenance.includes("scripts/production-maintenance-runtime.test.mjs")
    || !groups.maintenance.includes("scripts/production-maintenance-topology-workflow.test.mjs")) {
    throw new Error("ci_maintenance_proof_missing");
  }
  const explicit = Object.values(groups).flat();
  if (new Set(explicit).size !== explicit.length) throw new Error("ci_test_partition_overlap");
  const covered = new Set(explicit);
  groups.remaining = files.filter((file) => !covered.has(file));
  if (!groups.remaining.length) throw new Error("ci_remaining_tests_missing");
  for (const group of Object.values(groups)) group.sort();
  const partitioned = Object.values(groups).flat();
  if (partitioned.length !== files.length || new Set(partitioned).size !== inventory.size
    || partitioned.some((file) => !inventory.has(file))) throw new Error("ci_test_partition_incomplete");
  return groups;
}

export async function main(arguments_ = process.argv.slice(2), options = {}) {
  if (arguments_.length !== 1 || !["remaining", "--list"].includes(arguments_[0])) {
    throw new Error("ci_test_invocation_invalid");
  }
  const rootDirectory = options.rootDirectory ?? repositoryRoot;
  const stdout = options.stdout ?? process.stdout;
  const groups = partitionCiTests(discoverLocalTests(rootDirectory));
  const counts = Object.fromEntries(Object.entries(groups).map(([name, files]) => [name, files.length]));
  if (arguments_[0] === "--list") {
    stdout.write(`${JSON.stringify({ counts, groups }, null, 2)}\n`);
    return 0;
  }
  stdout.write(`[ci-tests] exact mandatory partitions ${JSON.stringify(counts)}\n`);
  // Native maintenance proofs already ran serially in their mandatory step;
  // never repeat those fixtures in the ordinary concurrent TypeScript batches.
  const result = await (options.runTests ?? runLocalTests)({ rootDirectory, stdout,
    files: groups.remaining, concurrency: 4, batchSize: 40 });
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error) => { process.stderr.write(`[ci-tests] ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; },
  );
}
