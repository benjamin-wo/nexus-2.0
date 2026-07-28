import { join, resolve } from "path";
import { readFile, writeFile, unlink } from "fs/promises";

interface ManifestEntry {
  fileName: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

export async function execute(args: { fileName?: string; olderThanDays?: number }) {
  const { fileName, olderThanDays } = args || {};

  if (!fileName && (olderThanDays === undefined || olderThanDays === null)) {
    throw new Error("Provide either 'fileName' to delete a specific page, or 'olderThanDays' to delete all pages older than that.");
  }

  const pagesDir = join(process.cwd(), "src", "public", "pages");
  const manifestPath = join(pagesDir, "_manifest.json");

  let entries: ManifestEntry[] = [];
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    entries = [];
  }

  let toDelete: ManifestEntry[];
  if (fileName) {
    if (!/^[a-zA-Z0-9_-]+\.html$/.test(fileName)) {
      throw new Error("Invalid file name.");
    }
    toDelete = entries.filter((e) => e.fileName === fileName);
    if (toDelete.length === 0) {
      return { success: false, error: `'${fileName}' was not found in the hosted pages manifest.` };
    }
  } else {
    const cutoff = Date.now() - (olderThanDays as number) * 24 * 60 * 60 * 1000;
    toDelete = entries.filter((e) => new Date(e.updatedAt).getTime() < cutoff);
  }

  const deleted: string[] = [];
  for (const entry of toDelete) {
    const targetPath = resolve(join(pagesDir, entry.fileName));
    if (!targetPath.startsWith(pagesDir)) continue; // defense-in-depth, mirrors hostHtmlPage's guard
    try {
      await unlink(targetPath);
      deleted.push(entry.fileName);
    } catch {
      // File already gone from disk - still remove its manifest entry below.
      deleted.push(entry.fileName);
    }
  }

  const remaining = entries.filter((e) => !deleted.includes(e.fileName));
  await writeFile(manifestPath, JSON.stringify(remaining, null, 2), "utf-8");

  return {
    success: true,
    deletedCount: deleted.length,
    deleted,
  };
}
