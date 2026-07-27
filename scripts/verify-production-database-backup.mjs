import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  validateDatabaseBackupArchiveEntries,
  validateDatabaseBackupNestedArchiveEntry,
  verifyDatabaseBackupManifestFiles,
} from "./database-backup-contract.mjs";

const MINIMUM_PASSPHRASE_LENGTH = 24;
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

export class DatabaseBackupVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseBackupVerificationError";
    this.code = code;
  }
}

function trimText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readArgument(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((entry) => entry.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});
    let stdout = "";
    let pendingLine = "";
    let timedOut = false;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      callback();
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout = `${stdout}${text}`.slice(-131_072);
      if (!options.onStdoutLine) return;
      pendingLine += text;
      let separator = pendingLine.indexOf("\n");
      while (separator >= 0) {
        options.onStdoutLine(pendingLine.slice(0, separator));
        pendingLine = pendingLine.slice(separator + 1);
        separator = pendingLine.indexOf("\n");
      }
    });
    child.stderr.resume();
    child.on("error", () => {
      finish(() =>
        reject(
          new DatabaseBackupVerificationError(
            options.errorCode || "verification_command_failed",
          ),
        ),
      );
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (options.onStdoutLine && pendingLine) {
        options.onStdoutLine(pendingLine);
      }
      if (timedOut) {
        finish(() =>
          reject(
            new DatabaseBackupVerificationError(
              `${options.errorCode || "verification_command"}_timeout`,
            ),
          ),
        );
        return;
      }
      if (code !== 0) {
        finish(() =>
          reject(
            new DatabaseBackupVerificationError(
              options.errorCode || "verification_command_failed",
            ),
          ),
        );
        return;
      }
      finish(() =>
        resolve({
          stdout,
          stdoutStreamed: Boolean(options.onStdoutLine),
        }),
      );
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

async function readPassphraseFromStdin() {
  let value = "";
  for await (const chunk of process.stdin) {
    value += chunk.toString("utf8");
    if (value.length > 16_384) {
      throw new DatabaseBackupVerificationError(
        "backup_passphrase_too_long",
      );
    }
  }
  return value.replace(/[\r\n]+$/, "");
}

function createNestedArchiveState(kind) {
  return {
    kind,
    entryCount: 0,
    invalid: false,
    hasPgsodiumRootKey: false,
    hasAppEnvironment: false,
    hasSupabaseEnvironment: false,
    hasComposeFile: false,
  };
}

function observeNestedArchiveEntry(state, value) {
  if (!value) return;
  const validation = validateDatabaseBackupNestedArchiveEntry(value);
  if (!validation.valid) {
    state.invalid = true;
    return;
  }
  if (validation.root) return;
  state.entryCount += 1;
  const entry = validation.entry;
  const baseName = entry.split("/").at(-1);
  if (
    state.kind === "postgres_config" &&
    baseName === "pgsodium_root.key"
  ) {
    state.hasPgsodiumRootKey = true;
  }
  if (state.kind === "app_config" && entry === ".env.local") {
    state.hasAppEnvironment = true;
  }
  if (state.kind === "supabase_config") {
    if (entry === ".env") state.hasSupabaseEnvironment = true;
    if (
      /^(?:docker-)?compose\.ya?ml$/i.test(baseName) ||
      /^docker-compose\.ya?ml$/i.test(baseName)
    ) {
      state.hasComposeFile = true;
    }
  }
}

function assertNestedArchiveState(state) {
  if (state.invalid) {
    throw new DatabaseBackupVerificationError(
      `${state.kind}_archive_entry_unsafe`,
    );
  }
  if (
    state.kind === "postgres_config" &&
    !state.hasPgsodiumRootKey
  ) {
    throw new DatabaseBackupVerificationError(
      "pgsodium_root_key_missing",
    );
  }
  if (state.kind === "app_config" && !state.hasAppEnvironment) {
    throw new DatabaseBackupVerificationError(
      "app_environment_backup_missing",
    );
  }
  if (
    state.kind === "supabase_config" &&
    (!state.hasSupabaseEnvironment || !state.hasComposeFile)
  ) {
    throw new DatabaseBackupVerificationError(
      "supabase_configuration_backup_incomplete",
    );
  }
}

async function inspectNestedArchive(commandRunner, archivePath, kind) {
  const state = createNestedArchiveState(kind);
  const result = await commandRunner("tar", ["-tzf", archivePath], {
    errorCode: `${kind}_archive_invalid`,
    onStdoutLine: (line) => observeNestedArchiveEntry(state, line),
  });
  if (!result.stdoutStreamed) {
    for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
      observeNestedArchiveEntry(state, line);
    }
  }
  assertNestedArchiveState(state);
  return {
    entryCount: state.entryCount,
  };
}

async function inspectOuterArchive(commandRunner, archivePath) {
  const entries = [];
  const addEntry = (line) => {
    if (line) entries.push(line);
  };
  const result = await commandRunner("tar", ["-tf", archivePath], {
    errorCode: "backup_archive_list_failed",
    onStdoutLine: addEntry,
  });
  if (!result.stdoutStreamed) {
    for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
      addEntry(line);
    }
  }
  const validation = validateDatabaseBackupArchiveEntries(entries);
  if (!validation.valid) {
    throw new DatabaseBackupVerificationError(validation.error);
  }
}

export async function withVerifiedProductionDatabaseBackup(input) {
  const requestedPath = trimText(input.inputPath);
  if (!requestedPath) {
    throw new DatabaseBackupVerificationError("encrypted_backup_missing");
  }
  const inputPath = path.resolve(requestedPath);
  let inputDetails;
  try {
    inputDetails = await stat(inputPath);
  } catch {
    throw new DatabaseBackupVerificationError("encrypted_backup_missing");
  }
  if (!inputDetails.isFile() || inputDetails.size <= 0) {
    throw new DatabaseBackupVerificationError("encrypted_backup_invalid");
  }
  const passphrase = String(input.passphrase ?? "");
  if (passphrase.length < MINIMUM_PASSPHRASE_LENGTH) {
    throw new DatabaseBackupVerificationError(
      "backup_passphrase_too_short",
    );
  }

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "faolla-database-verify-"),
  );
  const archivePath = path.join(temporaryDirectory, "backup.tar");
  const extractDirectory = path.join(temporaryDirectory, "extracted");
  const commandRunner = input.runCommand ?? runCommand;

  try {
    await commandRunner(
      "openssl",
      [
        "enc",
        "-d",
        "-aes-256-cbc",
        "-pbkdf2",
        "-iter",
        "200000",
        "-md",
        "sha256",
        "-in",
        inputPath,
        "-out",
        archivePath,
        "-pass",
        "stdin",
      ],
      {
        errorCode: "backup_decryption_failed",
        input: `${passphrase}\n`,
      },
    );
    await inspectOuterArchive(commandRunner, archivePath);

    await mkdir(extractDirectory, { recursive: true });
    await commandRunner(
      "tar",
      [
        "--no-same-owner",
        "--no-same-permissions",
        "-xf",
        archivePath,
        "-C",
        extractDirectory,
      ],
      {
        errorCode: "backup_archive_extract_failed",
      },
    );

    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(
          path.join(extractDirectory, "manifest.json"),
          "utf8",
        ),
      );
    } catch {
      throw new DatabaseBackupVerificationError("manifest_read_failed");
    }
    const verification = await verifyDatabaseBackupManifestFiles(
      extractDirectory,
      manifest,
    );
    if (!verification.valid) {
      throw new DatabaseBackupVerificationError(verification.error);
    }

    await commandRunner(
      "gzip",
      ["-t", path.join(extractDirectory, "database.sql.gz")],
      { errorCode: "database_dump_gzip_invalid" },
    );
    const nestedArchives = {
      postgresConfig: await inspectNestedArchive(
        commandRunner,
        path.join(extractDirectory, "postgres-config.tar.gz"),
        "postgres_config",
      ),
      storage: await inspectNestedArchive(
        commandRunner,
        path.join(extractDirectory, "storage.tar.gz"),
        "storage",
      ),
      supabaseConfig: await inspectNestedArchive(
        commandRunner,
        path.join(extractDirectory, "supabase-config.tar.gz"),
        "supabase_config",
      ),
      appConfig: await inspectNestedArchive(
        commandRunner,
        path.join(extractDirectory, "app-config.tar.gz"),
        "app_config",
      ),
    };

    const report = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      status: "verified",
      backupCreatedAt: verification.manifest.createdAt,
      format: verification.manifest.format,
      inputFile: path.basename(inputPath),
      inputBytes: inputDetails.size,
      source: verification.manifest.source,
      dumpFiles: verification.manifest.files.map((item) => ({
        name: item.name,
        bytes: item.bytes,
        sha256: item.sha256,
      })),
      nestedArchives,
    };
    const callbackResult = input.onVerified
      ? await input.onVerified({
          directory: extractDirectory,
          manifest: verification.manifest,
          report,
        })
      : undefined;
    return { report, callbackResult };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function verifyProductionDatabaseBackup(input) {
  return (await withVerifiedProductionDatabaseBackup(input)).report;
}

async function main() {
  const inputPath = readArgument("input");
  const passphrase = hasFlag("passphrase-stdin")
    ? await readPassphraseFromStdin()
    : String(process.env.FAOLLA_BACKUP_ENCRYPTION_PASSPHRASE ?? "");
  const report = await verifyProductionDatabaseBackup({
    inputPath,
    passphrase,
  });
  console.log(
    `[database-backup-verify] VERIFIED file=${report.inputFile} bytes=${report.inputBytes}`,
  );
  if (hasFlag("json")) console.log(JSON.stringify(report));
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseBackupVerificationError
        ? error.code
        : "database_backup_verification_failed";
    console.error(`[database-backup-verify] FAILED ${code}`);
    process.exitCode = 1;
  });
}
