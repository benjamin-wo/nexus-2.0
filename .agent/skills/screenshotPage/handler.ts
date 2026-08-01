import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

export async function execute(args: { htmlContent: string; viewport?: "desktop" | "mobile" }) {
  const { htmlContent, viewport = "desktop" } = args;

  if (!htmlContent || typeof htmlContent !== "string") {
    throw new Error("htmlContent is required.");
  }

  const dimensions = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  const isMac = process.platform === "darwin";
  const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    isMac && require("fs").existsSync(macChromePath)
      ? macChromePath
      : await chromium.executablePath();

  const browser = await puppeteer.launch({
    args: isMac ? ["--no-sandbox", "--disable-setuid-sandbox"] : chromium.args,
    defaultViewport: dimensions,
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "domcontentloaded", timeout: 15000 });
    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    const base64 = Buffer.from(screenshot).toString("base64");

    return {
      success: true,
      viewport,
      media: [{ mimeType: "image/png", data: base64 }],
    };
  } finally {
    await browser.close();
  }
}
