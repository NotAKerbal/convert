// Run against the real Next app: node scripts/test-conversions-ui.mjs [url]
import assert from "node:assert/strict";
import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:3000/";
const browser = await puppeteer.launch({ headless: true,
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.setDefaultTimeout(120000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  console.log("UI loaded; waiting for engine warm-up.");
  await page.waitForFunction(() => window.formatCacheReady === true, { timeout: 180000 });
  console.log("Engines ready; testing uploads.");
  async function chooseOutput(format) {
    try { await page.waitForSelector('input[placeholder="Search output formats..."]', { timeout: 15000 }); }
    catch (error) { console.error("Upload state:", await page.$eval("body", (el) => el.innerText)); throw error; }
    const search = await page.$('input[placeholder="Search output formats..."]');
    assert(search, "Output picker did not appear"); await search.type(format);
    await page.waitForFunction((f) => [...document.querySelectorAll(".format-card .name")].some((n) => n.textContent === f), {}, format);
    await page.evaluate((f) => {
      const name = [...document.querySelectorAll(".format-card .name")].find((n) => n.textContent === f);
      name.closest("button").click();
    }, format);
    await page.click(".convert-btn");
    await page.waitForFunction(() => document.querySelector(".results-title")?.textContent === "Conversion Complete");
  }
  await page.evaluate(() => {
    const file = new File(['name,note\nAlice,"one,two"\nBob,"line 1\nline 2"'], "sample.data.csv", { type: "text/plain" });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('input[type="file"]'); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await chooseOutput("JSON");
  const csvResult = await page.evaluate(async () => {
    const src = document.querySelector(".text-preview-content")?.textContent;
    return { name: document.querySelector(".result-name")?.textContent, text: src };
  });
  assert.equal(csvResult.name, "sample.data.json");
  await page.waitForFunction(() => document.querySelector(".text-preview-content")?.textContent?.includes("Alice"));
  const text = await page.$eval(".text-preview-content", (el) => el.textContent);
  const rows = JSON.parse(text);
  assert.equal(rows.length, 2); assert.equal(rows[1].note, "line 1\nline 2");
  console.log("Passed: real UI CSV → JSON preserves all records and offers the correct download.");
  await page.click(".restart-btn-large");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "red"; ctx.fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const file = new File([blob], "sample.image.png", { type: "image/png" });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector('input[type="file"]'); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await chooseOutput("JPEG");
  const result = await page.evaluate(async () => {
    const image = document.querySelector(".image-edit-surface img");
    const blob = await (await fetch(image.src)).blob();
    const bitmap = await createImageBitmap(blob); const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
    return { name: document.querySelector(".result-name")?.textContent, type: blob.type, dimensions };
  });
  assert.equal(result.name, "sample.image.jpg"); assert.equal(result.type, "image/jpeg"); assert.deepEqual(result.dimensions, [8, 8]);
  assert.deepEqual(errors, []);
  console.log("Passed: real UI PNG → JPEG generates a valid preview and download with the original base name.");
  await page.click(".restart-btn-large");
  await page.evaluate(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["Hello 😀 Unicode"], "unicode.txt", { type: "text/plain" }));
    const input = document.querySelector('input[type="file"]'); input.files = transfer.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await chooseOutput("TXT-UTF16LE");
  await page.waitForFunction(() => document.querySelector(".text-preview-content")?.textContent === "Hello 😀 Unicode");
  assert.deepEqual(errors, []);
  console.log("Passed: real UI UTF-16 download has a correct Unicode text preview.");
} finally { await browser.close(); }
