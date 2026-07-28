import { join } from "path";
import { readFile, readdir } from "fs/promises";

interface ManifestEntry {
  fileName: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

export async function execute(args: { olderThanDays?: number }) {
  const olderThanDays = args?.olderThanDays ?? 30;
  const pagesDir = join(process.cwd(), "src", "public", "pages");
  const manifestPath = join(pagesDir, "_manifest.json");

  let entries: ManifestEntry[] = [];
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [];
  } catch {
    // Manifest missing or unreadable - fall back to a directory listing so this
    // skill still works even if the manifest got out of sync or was never created.
    try {
      const files = await readdir(pagesDir);
      const now = new Date().toISOString();
      entries = files
        .filter((f) => f.endsWith(".html"))
        .map((fileName) => ({ fileName, createdAt: now, updatedAt: now, sizeBytes: 0 }));
    } catch {
      entries = [];
    }
  }

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const pages = entries.map((e) => ({
    ...e,
    stale: new Date(e.updatedAt).getTime() < cutoff,
  }));

  return {
    success: true,
    count: pages.length,
    olderThanDays,
    pages,
  };
}
