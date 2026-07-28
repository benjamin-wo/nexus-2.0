import { join, resolve } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";

export async function execute(args: { targetFile: string }) {
  const { targetFile } = args;

  if (!targetFile || typeof targetFile !== "string") {
    throw new Error("Parameter 'targetFile' is required — provide the relative path to the file to audit (e.g. 'src/index.html').");
  }

  // Resolve target file path relative to workspace and enforce security sandbox
  const workspaceRoot = process.cwd();
  const absolutePath = resolve(workspaceRoot, targetFile);

  if (!absolutePath.startsWith(workspaceRoot)) {
    throw new Error(`Permission denied: Cannot access file outside the workspace root.`);
  }

  if (!existsSync(absolutePath)) {
    throw new Error(`File not found: ${targetFile}`);
  }

  // 1. Fetch latest guidelines from Vercel repository
  const guidelinesUrl = "https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md";
  let guidelines = "";

  try {
    const res = await fetch(guidelinesUrl);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    guidelines = await res.text();
  } catch (err: any) {
    console.warn(`[Web Design Guidelines] Failed to fetch latest guidelines, using local fallback.`, err.message);
    guidelines = `# Web Interface Guidelines\n\nReview files for compliance with standard Web Interface Guidelines (accessibility, layout, typography, colors).`;
  }

  // 2. Read target file content
  const content = await readFile(absolutePath, "utf-8");

  return {
    success: true,
    guidelines,
    targetFilePath: targetFile,
    content,
  };
}
