#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LegacyPersonalRecoveryOpsError,
  decryptRecoveryConfig,
} from "./generate-legacy-personal-recovery-encrypted-config.mjs";

const CASE_SECRET_NAME = "ORDINARY_LEGACY_PERSONAL_RECOVERY_CASE_JSON";
const HMAC_SECRET_NAME = "ORDINARY_LEGACY_PERSONAL_RECOVERY_HMAC_SECRET";

function fail(code) {
  throw new LegacyPersonalRecoveryOpsError(code);
}

export function parseInstallerArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) fail("installer_arguments_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--envelope", "--private-key", "--repo"].includes(name) ||
      values.has(name) ||
      typeof value !== "string" ||
      !value
    ) {
      fail("installer_arguments_invalid");
    }
    values.set(name, value);
  }
  const repository = values.get("--repo");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    fail("installer_arguments_invalid");
  }
  return {
    envelopePath: resolve(values.get("--envelope")),
    privateKeyPath: resolve(values.get("--private-key")),
    repository,
  };
}

function setGitHubSecret({
  repository,
  name,
  value,
  environment,
  spawnImpl = spawnSync,
}) {
  const result = spawnImpl(
    "gh",
    ["secret", "set", name, "--repo", repository],
    {
      input: value,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["pipe", "ignore", "pipe"],
      env: environment,
    },
  );
  if (!result || result.status !== 0) fail("github_secret_write_failed");
}

export function installRecoverySecrets({
  encryptedEnvelope,
  privateKeyPem,
  repository,
  spawnImpl = spawnSync,
  runtimeEnvironment = process.env,
}) {
  if (runtimeEnvironment.GITHUB_ACTIONS === "true") {
    fail("local_operator_required");
  }
  const childEnvironment = { ...runtimeEnvironment };
  delete childEnvironment.GITHUB_TOKEN;
  delete childEnvironment.GH_TOKEN;
  delete childEnvironment.GITHUB_ENTERPRISE_TOKEN;
  delete childEnvironment.GH_ENTERPRISE_TOKEN;
  const config = decryptRecoveryConfig(encryptedEnvelope, privateKeyPem);
  // Either partial state remains harmless because the recovery gate is never
  // enabled here. Re-running replaces both values before a separate deploy.
  setGitHubSecret({
    repository,
    name: HMAC_SECRET_NAME,
    value: config.hmacSecret,
    environment: childEnvironment,
    spawnImpl,
  });
  setGitHubSecret({
    repository,
    name: CASE_SECRET_NAME,
    value: config.caseJson,
    environment: childEnvironment,
    spawnImpl,
  });
  return { ok: true };
}

async function main() {
  const args = parseInstallerArguments(process.argv.slice(2));
  const [encryptedEnvelope, privateKeyPem] = await Promise.all([
    readFile(args.envelopePath, "utf8"),
    readFile(args.privateKeyPath, "utf8"),
  ]);
  installRecoverySecrets({
    encryptedEnvelope,
    privateKeyPem,
    repository: args.repository,
  });
  process.stdout.write(
    "[legacy-personal-recovery-ops] result=github_secrets_configured\n",
  );
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    const code =
      error instanceof LegacyPersonalRecoveryOpsError
        ? error.code
        : "installer_failed";
    process.stderr.write(
      `[legacy-personal-recovery-ops] result=${code}\n`,
    );
    process.exitCode = 1;
  });
}

export const LEGACY_PERSONAL_RECOVERY_INSTALL_SECRET_NAMES = {
  caseJson: CASE_SECRET_NAME,
  hmac: HMAC_SECRET_NAME,
};
