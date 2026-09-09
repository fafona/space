import { spawn } from "node:child_process";
import { lstatSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFilePattern = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;
const testRoots = ["src", "scripts"];
const maximumCommandLength = 7_000;

export function discoverLocalTests(rootDirectory = repositoryRoot) {
  const root = path.resolve(rootDirectory);
  const files = [];

  function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    const metadata = lstatSync(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`local_test_directory_invalid:${relativeDirectory}`);
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error(`local_test_symlink_not_supported:${relativePath}`);
      }
      if (entry.isDirectory()) visit(relativePath);
      else if (entry.isFile() && testFilePattern.test(entry.name)) files.push(relativePath);
    }
  }

  for (const directory of testRoots) visit(directory);
  files.sort();
  if (files.length === 0) throw new Error("local_test_files_missing");
  return files;
}

export function parseLocalTestArguments(arguments_) {
  const result = { list: false, concurrency: 4, batchSize: 40 };
  const seen = new Set();
  for (const argument of arguments_) {
    const name = argument.split("=", 1)[0];
    if (seen.has(name)) throw new Error(`duplicate_local_test_option:${name}`);
    seen.add(name);
    if (argument === "--list") {
      result.list = true;
      continue;
    }
    const match = /^(--concurrency|--batch-size)=([1-9]\d*)$/.exec(argument);
    if (!match) throw new Error(`unknown_local_test_option:${argument}`);
    const value = Number(match[2]);
    const limit = match[1] === "--concurrency" ? 16 : 64;
    if (!Number.isSafeInteger(value) || value > limit) {
      throw new Error(`local_test_option_out_of_range:${match[1]}`);
    }
    result[match[1] === "--concurrency" ? "concurrency" : "batchSize"] = value;
  }
  return result;
}

// Bound both file count and quoted command size: Windows command-line limits
// must not cause a discovered test to disappear from the run.
export function createLocalTestBatches(files, baseArguments, batchSize = 40) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 64) {
    throw new Error("local_test_batch_size_invalid");
  }
  const argumentLength = (argument) => String(argument).length * 2 + 3;
  const baseLength = [process.execPath, ...baseArguments].reduce(
    (total, argument) => total + argumentLength(argument),
    0,
  );
  const batches = [];
  let current = [];
  let commandLength = baseLength;
  for (const file of files) {
    if (!/^(?:src|scripts)\//.test(file) || file.split("/").includes("..")) {
      throw new Error(`local_test_path_invalid:${file}`);
    }
    const size = argumentLength(file);
    if (baseLength + size > maximumCommandLength) {
      throw new Error(`local_test_path_too_long:${file}`);
    }
    if (current.length && (current.length >= batchSize || commandLength + size > maximumCommandLength)) {
      batches.push(current);
      current = [];
      commandLength = baseLength;
    }
    current.push(file);
    commandLength += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function runLocalTests({
  rootDirectory = repositoryRoot,
  files = discoverLocalTests(rootDirectory),
  concurrency = 4,
  batchSize = 40,
  stdout = process.stdout,
  stderr = process.stderr,
  spawnProcess = spawn,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("local_test_concurrency_invalid");
  }
  if (files.length === 0) throw new Error("local_test_files_missing");
  const baseArguments = [
    "--import",
    pathToFileURL(require.resolve("tsx")).href,
    "--test",
    `--test-concurrency=${concurrency}`,
  ];
  const batches = createLocalTestBatches(files, baseArguments, batchSize);
  let failedBatches = 0;
  for (const [index, batch] of batches.entries()) {
    stdout.write(`[local-tests] batch ${index + 1}/${batches.length}; files=${batch.length}\n`);
    const result = await new Promise((resolve) => {
      let child;
      try {
        // Node's test runner sets this internal variable in isolated workers.
        // A nested invocation must start its own runner, not inherit worker IPC.
        const environment = { ...process.env };
        delete environment.NODE_TEST_CONTEXT;
        child = spawnProcess(process.execPath, [...baseArguments, ...batch], {
          cwd: path.resolve(rootDirectory),
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        stderr.write(`[local-tests] spawn failed: ${error instanceof Error ? error.message : String(error)}\n`);
        resolve({ code: null, signal: null });
        return;
      }
      child.stdout.on("data", (chunk) => stdout.write(chunk));
      child.stderr.on("data", (chunk) => stderr.write(chunk));
      child.once("error", (error) => {
        stderr.write(`[local-tests] spawn failed: ${error.message}\n`);
        resolve({ code: null, signal: null });
      });
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0 || result.signal) {
      failedBatches += 1;
      stderr.write(`[local-tests] batch ${index + 1} failed; exit=${result.code ?? "none"}; signal=${result.signal ?? "none"}\n`);
    }
  }
  const summary = { files: files.length, batches: batches.length, failedBatches };
  stdout.write(`[local-tests] ${JSON.stringify(summary)}\n`);
  return { ...summary, exitCode: failedBatches ? 1 : 0 };
}

export async function main(arguments_ = process.argv.slice(2), options = {}) {
  const parsed = parseLocalTestArguments(arguments_);
  const rootDirectory = options.rootDirectory ?? repositoryRoot;
  const stdout = options.stdout ?? process.stdout;
  const files = discoverLocalTests(rootDirectory);
  if (parsed.list) {
    stdout.write(`${JSON.stringify({ roots: testRoots, count: files.length, files }, null, 2)}\n`);
    return 0;
  }
  const result = await runLocalTests({ ...options, ...parsed, rootDirectory, files });
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error) => {
      process.stderr.write(`[local-tests] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
