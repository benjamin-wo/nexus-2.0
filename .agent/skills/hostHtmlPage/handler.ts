import { join, resolve } from "path";
import { writeFile, mkdir, readFile } from "fs/promises";

const RESERVED_NAMES = new Set(["index.html", "app.js", "style.css"]);

interface ManifestEntry {
  fileName: string;
  createdAt: string;
  updatedAt: string;
  sizeBytes: number;
}

async function readManifest(manifestPath: string): Promise<ManifestEntry[]> {
  try {
    const raw = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function execute(args: { fileName: string; htmlContent: string }) {
  const { fileName, htmlContent } = args;

  if (!fileName || !fileName.endsWith(".html")) {
    throw new Error("File name must end with '.html'.");
  }

  const lowerFileName = fileName.toLowerCase();
  if (RESERVED_NAMES.has(lowerFileName)) {
    throw new Error(
      `'${fileName}' is a reserved name (the live dashboard app). Choose a content-specific file name instead, e.g. 'travel-itinerary.html'.`
    );
  }

  // Validate filename to prevent directory traversal
  const nameWithoutExtension = fileName.slice(0, -5);
  if (!/^[a-zA-Z0-9_-]+$/.test(nameWithoutExtension)) {
    throw new Error("File name must be alphanumeric (letters, numbers, hyphens, and underscores only).");
  }

  const pagesDir = join(process.cwd(), "src", "public", "pages");
  const targetPath = resolve(join(pagesDir, fileName));

  // Security check: ensure targetPath is inside the pages folder
  if (!targetPath.startsWith(pagesDir)) {
    throw new Error("Security check failed: Path traversal outside the pages directory is blocked.");
  }

  // Ensure pages directory exists
  await mkdir(pagesDir, { recursive: true });

  // Write file
  await writeFile(targetPath, htmlContent, "utf-8");

  // Lightweight, non-blocking defense-in-depth check for remote script tags from
  // non-allowlisted domains. Generated pages legitimately load Google Fonts CSS via
  // <link>, so this only warns on <script src="http...">, and only warns (doesn't block),
  // since this is a single-user assistant generating its own HTML, not a multi-tenant CMS
  // accepting untrusted third-party markup.
  const ALLOWLISTED_SCRIPT_DOMAINS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"];
  const scriptSrcMatches = Array.from(htmlContent.matchAll(/<script[^>]+src=["'](https?:\/\/[^"'/]+)[^"']*["']/gi));
  const untrustedScriptDomains = scriptSrcMatches
    .map((m) => m[1].replace(/^https?:\/\//, ""))
    .filter((domain) => !ALLOWLISTED_SCRIPT_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`)));

  // Upsert manifest entry (preserves createdAt across overwrites, bumps updatedAt)
  const manifestPath = join(pagesDir, "_manifest.json");
  const manifest = await readManifest(manifestPath);
  const now = new Date().toISOString();
  const existing = manifest.find((e) => e.fileName === fileName);
  const sizeBytes = Buffer.byteLength(htmlContent, "utf-8");
  if (existing) {
    existing.updatedAt = now;
    existing.sizeBytes = sizeBytes;
  } else {
    manifest.push({ fileName, createdAt: now, updatedAt: now, sizeBytes });
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  // Determine hosted URL
  let hostedUrl = "";
  let warning: string | undefined;
  if (process.env.WEBAPP_URL) {
    const base = process.env.WEBAPP_URL.endsWith("/") 
      ? process.env.WEBAPP_URL.slice(0, -1) 
      : process.env.WEBAPP_URL;
    hostedUrl = `${base}/pages/${fileName}`;
  } else if (process.env.RAILWAY_STATIC_URL) {
    hostedUrl = `https://${process.env.RAILWAY_STATIC_URL}/pages/${fileName}`;
  } else {
    // Local fallback - only reachable on this machine
    const port = process.env.PORT || 3000;
    hostedUrl = `http://localhost:${port}/pages/${fileName}`;
    warning = "No WEBAPP_URL or RAILWAY_STATIC_URL configured - this link only works on this machine and is not reachable over the internet. Set WEBAPP_URL to get a real public link. Surface this warning to the user verbatim rather than presenting the link as shareable.";
  }

  if (untrustedScriptDomains.length > 0) {
    const scriptWarning = `The published HTML loads <script> tags from non-allowlisted domain(s): ${untrustedScriptDomains.join(", ")}. Double-check these are intentional and trustworthy.`;
    warning = warning ? `${warning} Also: ${scriptWarning}` : scriptWarning;
  }

  return {
    success: true,
    message: `HTML page has been successfully hosted!`,
    fileName,
    url: hostedUrl,
    ...(warning ? { warning } : {}),
  };
}
