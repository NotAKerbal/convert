// Generates public/cache.json by loading the running dev/prod server in a
// headless browser and dumping the built format cache. This mirrors the
// workflow described in the README, adapted for the Next.js UI.
//
// Usage: node scripts/build-cache.mjs [url] [outputPath]

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const url = process.argv[2] || "http://localhost:3000/";
const outputPath = process.argv[3] || path.join(root, "public", "cache.json");

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

const page = await browser.newPage();
page.on("console", (msg) => console.log("[page]", msg.text()));
page.on("pageerror", (err) => console.log("[page error]", err.message));

console.log("Loading", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });

await page.waitForFunction(
  () => typeof window.printSupportedFormatCache === "function",
  { timeout: 0, polling: 1000 }
);

const cacheJSON = await page.evaluate(() => window.printSupportedFormatCache());
await writeFile(outputPath, cacheJSON);
console.log(`Wrote ${cacheJSON.length} bytes to ${outputPath}`);

await browser.close();
process.exit(0);
