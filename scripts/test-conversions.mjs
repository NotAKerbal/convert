// Browser/WASM integration tests. Uses an ephemeral local server and real
// converter implementations; no production test routes or external services.
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(path.join(tmpdir(), "convert-audit-"));
let browser;
let server;
try {
  const db = new DatabaseSync(path.join(scratch, "sample.db"));
  db.exec(`CREATE TABLE "audit table" (name TEXT, note TEXT); INSERT INTO "audit table" VALUES ('Alice', 'one,two'), ('Bob', 'line 1' || char(10) || 'line 2');`);
  db.close();
  for (const [entry, name] of [["tests/browser-conversions.ts", "bundle.js"], ["src/handlers/flo.worker.ts", "flo.worker.ts"]]) {
    await build({ entryPoints: [path.join(root, entry)], outfile: path.join(scratch, name), bundle: true,
      format: "esm", platform: "browser", target: "esnext", logLevel: "warning", loader: { ".wasm": "file" } });
  }
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    res.setHeader("Cache-Control", "no-store");
    try {
      if (pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end('<!doctype html><html><body><script type="module" src="/bundle.js"></script></body></html>');
        return;
      }
      const file = ["/bundle.js", "/flo.worker.ts", "/sample.db"].includes(pathname)
        ? path.join(scratch, pathname.slice(1))
        : path.join(root, "public", pathname);
      if (!file.startsWith(root + "/public/") && !file.startsWith(scratch + "/")) { res.writeHead(403).end(); return; }
      const mime = file.endsWith(".wasm") ? "application/wasm"
        : /\.(?:m?js|ts)$/.test(file) ? "text/javascript" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
      res.setHeader("Content-Type", mime);
      res.end(await readFile(file));
    } catch { res.writeHead(404).end("Not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  page.on("console", (msg) => { if (msg.text().startsWith("AUDIT ")) console.log(msg.text().slice(6)); });
  page.on("pageerror", (error) => console.error("Browser:", error.message));
  await page.goto(address, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.runConversionAudit === "function");
  const results = await page.evaluate((filter) => window.runConversionAudit(filter), process.env.CONVERSION_FILTER);
  const reportPath = process.env.CONVERSION_REPORT || path.join(tmpdir(), "convert-conversion-results.json");
  await writeFile(reportPath, JSON.stringify(results, null, 2) + "\n");
  const failed = results.filter((r) => r.status === "Failed");
  if (process.env.UPDATE_CONVERSION_CACHE === "1" && failed.length === 0) {
    await writeFile(path.join(root, "public", "cache.json"), await page.evaluate(() => window.printSupportedFormatCache()));
  }
  console.log(`\n${results.length - failed.length}/${results.length} conversion checks passed. Report: ${reportPath}`);
  if (failed.length) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
