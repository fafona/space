import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveRootDir() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..");
}

function resolveGitDir(rootDir) {
  const dotGitPath = path.join(rootDir, ".git");
  if (!fs.existsSync(dotGitPath)) return null;
  const stat = fs.lstatSync(dotGitPath);
  if (stat.isDirectory()) return dotGitPath;
  if (!stat.isFile()) return null;
  const raw = fs.readFileSync(dotGitPath, "utf8");
  const match = raw.match(/gitdir:\s*(.+)/i);
  if (!match) return null;
  return path.resolve(rootDir, match[1].trim());
}

function ensureExecutable(filePath) {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // Ignore permission issues on systems that do not support chmod.
  }
}

function installHook() {
  const rootDir = resolveRootDir();
  const sourceHookPath = path.join(rootDir, ".githooks", "pre-commit");
  if (!fs.existsSync(sourceHookPath)) {
    console.warn("[hooks] skip: .githooks/pre-commit not found");
    return;
  }
  const gitDir = resolveGitDir(rootDir);
  if (!gitDir) {
    console.warn("[hooks] skip: .git directory not found");
    return;
  }

  const hooksDir = path.join(gitDir, "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const targetHookPath = path.join(hooksDir, "pre-commit");
  const hookContent = fs.readFileSync(sourceHookPath, "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(targetHookPath, hookContent, "utf8");
  ensureExecutable(targetHookPath);
  console.log("[hooks] installed pre-commit -> .git/hooks/pre-commit");
}

installHook();
