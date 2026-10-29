import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

// Run against a built app: npm start -- --port 3100, then npm run test:units.
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";
const artifacts = await mkdtemp(path.join(os.tmpdir(), "unit-converter-check-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  const session = await page.createCDPSession();
  await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: artifacts });
  await browser.defaultBrowserContext().overridePermissions(baseUrl, ["clipboard-read", "clipboard-sanitized-write"]);

  const wait = (fn, ...args) => page.waitForFunction(fn, { timeout: 15000 }, ...args);
  const text = (selector) => page.$eval(selector, (element) => element.textContent.trim());
  const value = (selector) => page.$eval(selector, (element) => element.value);
  const clickText = (text) => page.locator(`button::-p-text(${text})`).click();
  const noOverflow = async () =>
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Page should fit its viewport");
  async function fill(selector, next) {
    const field = await page.waitForSelector(selector);
    await field.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    if (next) await page.keyboard.sendCharacter(next);
    else await page.keyboard.press("Backspace");
  }
  const valueInput = ".unit-value input";
  const fromSelect = ".unit-converter-row .unit-select:nth-of-type(2) select";
  const toSelect = ".unit-converter-row .unit-select:last-of-type select";
  const result = () => text(".unit-result-value");
  const resultIs = (expected) =>
    wait((expected) => document.querySelector(".unit-result-value")?.textContent.trim() === expected, expected).catch(async () => {
      throw new Error(`Expected result “${expected}”, saw “${await page.$eval(".unit-result", (element) => element.textContent)}”`);
    });
  async function downloaded(name) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await readdir(artifacts)).includes(name)) return path.join(artifacts, name);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Missing download: ${name}`);
  }

  // Directory and navigation.
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await fill('input[aria-label="Search tools"]', "celsius");
  await wait(() => document.querySelectorAll(".tool-card").length === 1);
  await page.locator(".category-filters button::-p-text(Calculate)").click();
  await page.locator('a.tool-card[href="/tools/unit-converter"]').click();
  await page.waitForSelector(valueInput);
  await wait(() => document.querySelector('.site-nav a[aria-current="page"]')?.textContent === "Units");
  assert.equal(await text(".tool-page-heading h1"), "Unit converter");
  assert.ok(await page.$('.more-tools a[href="/tools/convert"]'));

  // Default conversion is exact and live.
  await resultIs("0.3048 m");
  assert.equal(await text(".unit-badge"), "Exact");
  await fill(valueInput, "5280");
  await resultIs("1,609.344 m");

  // Swapping keeps the same quantity.
  await fill(valueInput, "1");
  await resultIs("0.3048 m");
  await page.locator('button[aria-label="Swap units"]').click();
  await resultIs("1 ft");
  assert.equal(await value(valueInput), "0.3048");
  assert.equal(await value(fromSelect), "m");
  assert.equal(await value(toSelect), "ft");
  await page.select(toSelect, "in");
  await resultIs("12 in");
  await page.screenshot({ path: path.join(artifacts, "unit-converter-desktop.png"), fullPage: true });

  // Fractions, mixed numbers, and scientific notation.
  await page.locator(".unit-categories button::-p-text(Volume)").click();
  await wait(() => document.querySelector(".unit-heading h2")?.textContent === "Volume");
  assert.equal(await value(fromSelect), "cup_us");
  await fill(valueInput, "1 1/2");
  await resultIs("354.8823548 mL");
  assert.equal(await text(".unit-badge"), "Rounded");
  await fill(valueInput, "2.5e-3");
  await resultIs("0.5914705913 mL");
  await fill(valueInput, "1,5");
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes("period for decimals"));
  assert.equal(await page.$eval(valueInput, (element) => element.getAttribute("aria-invalid")), "true");
  assert.equal(await page.$(".unit-result-value"), null);
  await fill(valueInput, "alert(1)");
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes("isn't a number"));

  // Absolute temperatures enforce absolute zero; differences do not.
  await page.locator(".unit-categories button::-p-text(Temperature)").click();
  await fill(valueInput, "98.6");
  await resultIs("37 °C");
  await fill(valueInput, "-500");
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes("absolute zero"));
  await page.locator(".unit-categories button::-p-text(Temperature difference)").click();
  await fill(valueInput, "-10");
  await resultIs("−18 Δ°F");

  // Fuel economy is reciprocal and rejects zero.
  await page.locator(".unit-categories button::-p-text(Fuel economy)").click();
  await fill(valueInput, "30");
  await resultIs("7.840486111 L/100 km");
  await fill(valueInput, "0");
  await wait(() => document.querySelector('[role="alert"]')?.textContent.includes("greater than zero"));

  // Typed conversions, including mixed units and ambiguity.
  await fill(".unit-quick input", "1 gal to L");
  await wait(() => document.querySelector("#unit-quick-preview")?.textContent.includes("US gallon"));
  await fill(".unit-quick input", "5 ft 3 in to cm");
  await wait(() => document.querySelector("#unit-quick-preview")?.textContent.includes("160.02 cm"));
  await page.keyboard.press("Enter");
  await resultIs("160.02 cm");
  assert.equal(await text(".unit-heading h2"), "Length");
  assert.equal(await value(fromSelect), "in");
  assert.equal(await value(valueInput), "63");
  assert.equal(await value(".unit-quick input"), "");

  // Every unit, mixed-unit output, and precision choices.
  await page.waitForSelector(".unit-table tbody tr");
  assert.ok((await page.$$eval(".unit-all tbody tr", (rows) => rows.length)) >= 20);
  assert.match(await text(".unit-composites"), /5 ft 3 in/);
  await fill('input[aria-label="Filter units"]', "furlong");
  await wait(() => document.querySelectorAll(".unit-all tbody tr").length === 1);
  await page.locator(".unit-all .unit-row-name").click();
  await wait(() => document.querySelector(".unit-converter-row .unit-select:last-of-type select")?.value === "furlong");
  await page.select(".unit-options label:first-child select", "scientific");
  await wait(() => document.querySelector(".unit-result-value")?.textContent.includes("× 10⁻³"));
  await page.select(".unit-options label:first-child select", "fixed");
  await wait(() => /^0\.01 fur$/.test(document.querySelector(".unit-result-value")?.textContent.trim()));
  await page.select(".unit-options label:first-child select", "auto");

  // Clipboard, favorites, and share links.
  await page.select(toSelect, "cm");
  await resultIs("160.02 cm");
  await clickText("Copy result");
  await wait(() => document.querySelector(".unit-converter-panel [role=status]").textContent.includes("Copied"));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "160.02");
  await clickText("☆ Save");
  await wait(() => document.querySelector('button[aria-pressed="true"]')?.textContent.includes("Saved"));
  assert.match(page.url(), /category=length&from=in&to=cm&value=63/);
  await page.reload({ waitUntil: "networkidle0" });
  await resultIs("160.02 cm");
  await wait(() => [...document.querySelectorAll(".unit-category-group button")].some((button) => button.textContent === "in → cm"));
  await page.goto(`${baseUrl}/tools/unit-converter?category=data-storage&from=TB&to=GiB&value=1`, { waitUntil: "networkidle0" });
  await resultIs("931.3225746 GiB");
  await page.goto(`${baseUrl}/tools/unit-converter?category=nope&from=x`, { waitUntil: "networkidle0" });
  await resultIs("0.3048 m");

  // Unit search jumps to the right category.
  await fill('input[aria-label="Search units and categories"]', "gibibyte");
  await page.locator(".unit-search-result::-p-text(gibibyte (GiB))").click();
  await wait(() => document.querySelector(".unit-heading h2")?.textContent === "Data storage");
  assert.equal(await value(fromSelect), "GiB");

  // A swap retains the exact fraction through reload; editing discards it.
  await page.goto(`${baseUrl}/tools/unit-converter?category=length&from=m&to=ft&value=1%2F3`, { waitUntil: "networkidle0" });
  await page.select(".unit-options label:nth-child(2) select", "30");
  await page.locator('button[aria-label="Swap units"]').click();
  const exactSwappedResult = await result();
  const swappedText = await value(valueInput);
  await wait(() => new URLSearchParams(location.search).has("n"));
  await page.reload({ waitUntil: "networkidle0" });
  await page.select(".unit-options label:nth-child(2) select", "30");
  await resultIs(exactSwappedResult);
  await fill(valueInput, "2");
  await fill(valueInput, swappedText);
  await wait(() => !new URLSearchParams(location.search).has("n"));
  assert.notEqual(await result(), exactSwappedResult, "An explicit edit uses the visible input rather than a retained fraction");
  await page.select(".unit-options label:nth-child(2) select", "10");

  // Batch conversion and CSV.
  await page.locator(".unit-categories button::-p-text(Length)").click();
  await fill(".unit-batch textarea", "1\n2.5\n5 ft 3 in\n12 psi to kPa\nnope\n=cmd()");
  await wait(() => document.querySelector(".unit-batch-summary")?.textContent.includes("6 lines"));
  assert.match(await text(".unit-batch-summary"), /2 need attention/);
  const batchCells = await page.$$eval(".unit-batch tbody tr td:last-child", (cells) => cells.map((cell) => cell.textContent));
  assert.deepEqual(batchCells.slice(0, 4), ["0.3048 m", "0.762 m", "1.6002 m", "≈ 82.73708752 kPa"]);
  await clickText("Download CSV");
  const csv = await readFile(await downloaded("unit-conversions.csv"), "utf8");
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Line,Input,Value,From unit,Result,To unit,Exact,Error");
  assert.equal(lines[1], "1,1,1,ft,0.3048,m,yes,");
  assert.match(lines[6], /^6,'=cmd\(\),/);

  // Mobile and light theme layouts.
  await page.setViewport({ width: 375, height: 812 });
  await noOverflow();
  assert.equal(await page.$eval(".unit-category-select", (element) => getComputedStyle(element).display), "flex");
  await page.select(".unit-category-select select", "pressure");
  await fill(valueInput, "32");
  await resultIs("2.206322334 bar");
  await noOverflow();
  await page.screenshot({ path: path.join(artifacts, "unit-converter-mobile.png"), fullPage: true });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await wait(() => getComputedStyle(document.body).backgroundColor === "rgb(250, 248, 244)");
  await noOverflow();
  await page.screenshot({ path: path.join(artifacts, "unit-converter-mobile-light.png"), fullPage: true });

  const origin = new URL(baseUrl).origin;
  assert.deepEqual(requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:")), [], "No external requests");
  assert.deepEqual(errors, [], "No page errors");
  console.log(`PASS: unit converter navigation, exact live conversion, swap, validation, absolute zero, reciprocal fuel economy, typed and mixed units, unit table, precision, clipboard, favorites, share links, search, batch CSV, and mobile/light layouts. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
