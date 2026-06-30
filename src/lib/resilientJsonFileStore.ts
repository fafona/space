import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readJsonFileWithBackup<T>(
  filePath: string,
  fallback: T,
  normalize: (value: unknown) => T | null,
): Promise<T> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const paths = [filePath, `${filePath}.bak`];
  for (const candidatePath of paths) {
    try {
      const raw = await readFile(candidatePath, "utf8");
      const normalized = normalize(JSON.parse(raw));
      if (normalized) return normalized;
    } catch {
      // Try the next copy.
    }
  }
  return fallback;
}

export async function writeJsonFileWithBackup(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await copyFile(filePath, `${filePath}.bak`).catch(() => null);
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}
