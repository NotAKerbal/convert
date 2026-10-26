import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import jsQR from "jsqr";

// Run against a built app: npm start -- --port 3100, then npm run test:browser.
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";
const artifacts = await mkdtemp(path.join(os.tmpdir(), "toolkit-check-"));
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
  await session.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: artifacts,
  });
  const click = (text) => page.locator(`button::-p-text(${text})`).click();
  // Use native input events for paste-sized values as well as short strings.
  // Puppeteer's long-value fill path bypasses React's controlled input tracker.
  async function fill(selector, value) {
    const field = await page.waitForSelector(selector);
    await field.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.sendCharacter(value);
  }
  const wait = (fn, ...args) =>
    page.waitForFunction(fn, { timeout: 20000 }, ...args);
  const noOverflow = async () =>
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Page should fit its viewport",
    );
  async function decodeQr() {
    await page.waitForSelector(".generated-qr");
    await wait(() => document.querySelector(".generated-qr")?.complete);
    const image = await page.evaluate(() => {
      const img = document.querySelector(".generated-qr");
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0);
      return {
        pixels: Array.from(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
        width: canvas.width,
        height: canvas.height,
      };
    });
    const decoded = jsQR(
      new Uint8ClampedArray(image.pixels),
      image.width,
      image.height,
    );
    assert.ok(decoded, "Generated QR image should decode");
    return decoded.data;
  }
  async function downloaded(name) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await readdir(artifacts)).includes(name))
        return path.join(artifacts, name);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Missing download: ${name}`);
  }

  const themePage = await browser.newPage();
  themePage.on("pageerror", (error) => errors.push(error.message));
  await themePage.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);
  await themePage.setViewport({ width: 1440, height: 1100 });
  // A preference saved by the former selector must not override the system.
  await themePage.evaluateOnNewDocument(() => {
    localStorage.setItem("convert-to-it.theme", "dark");
  });
  await themePage.goto(baseUrl, { waitUntil: "networkidle0" });
  assert.equal(
    await themePage.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    ),
    "rgb(250, 248, 244)",
  );
  assert.equal(await themePage.$(".hub-hero"), null);
  assert.equal(await themePage.$(".theme-toggle"), null);
  assert.equal(
    await themePage.$eval("h1", (heading) => heading.textContent),
    "Tools",
  );
  await themePage.screenshot({
    path: path.join(artifacts, "homepage-light-desktop.png"),
    fullPage: true,
  });
  await themePage.setViewport({ width: 375, height: 812 });
  assert.equal(
    await themePage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await themePage.screenshot({
    path: path.join(artifacts, "homepage-light-mobile.png"),
    fullPage: true,
  });
  await themePage.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
  ]);
  await themePage.waitForFunction(
    () => getComputedStyle(document.body).backgroundColor === "rgb(12, 10, 9)",
  );
  await themePage.reload({ waitUntil: "networkidle0" });
  assert.equal(
    await themePage.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    ),
    "rgb(12, 10, 9)",
  );
  await themePage.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "light" },
  ]);
  for (const slug of ["qr-code", "text", "json", "convert"]) {
    await themePage.goto(`${baseUrl}/tools/${slug}`, {
      waitUntil: "networkidle0",
    });
    assert.equal(
      await themePage.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
      "rgb(250, 248, 244)",
    );
    assert.equal(await themePage.$(".theme-toggle"), null);
    assert.equal(
      await themePage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (slug === "convert")
      await themePage.waitForSelector(".category-tile", { timeout: 60000 });
    await themePage.screenshot({
      path: path.join(artifacts, `${slug}-light-mobile.png`),
      fullPage: true,
    });
    await themePage.setViewport({ width: 1440, height: 1100 });
    await themePage.screenshot({
      path: path.join(artifacts, `${slug}-light-desktop.png`),
      fullPage: true,
    });
    await themePage.setViewport({ width: 375, height: 812 });
  }
  await themePage.close();
  console.log(
    "PASS: removed hero and theme selector; system theme changes apply immediately and ignore old saved overrides on all tool pages.",
  );

  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: "dark" },
  ]);
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  assert.equal(await page.$$eval(".tool-card", (cards) => cards.length), 4);
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "homepage-desktop.png"),
    fullPage: true,
  });
  await fill('input[aria-label="Search tools"]', "wifi");
  await wait(() => document.querySelectorAll(".tool-card").length === 1);
  assert.match(
    await page.$eval(".tool-card h3", (element) => element.textContent),
    /QR/,
  );
  await fill('input[aria-label="Search tools"]', "no-such-tool");
  await page.waitForSelector(".no-tools");
  await click("Clear filters");
  await page.locator(".category-filters button::-p-text(Files)").click();
  await wait(() => document.querySelectorAll(".tool-card").length === 1);
  await page.locator(".category-filters button::-p-text(All tools)").click();
  await page.setViewport({ width: 375, height: 812 });
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "homepage-mobile.png"),
    fullPage: true,
  });

  await page.goto(`${baseUrl}/tools/qr-code`, { waitUntil: "networkidle0" });
  assert.equal(
    await page.$eval(".download-actions button", (element) => element.disabled),
    true,
  );
  await fill('input[type="url"]', "https://example.com/hello?from=toolkit");
  assert.equal(await decodeQr(), "https://example.com/hello?from=toolkit");
  await click("Download PNG");
  await click("Download SVG");
  assert.equal(
    await page.evaluate(() => document.activeElement?.tagName),
    "BUTTON",
    "Downloads should preserve focus on their control",
  );
  const png = await readFile(await downloaded("qr-code.png"));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 512);
  assert.match(await readFile(await downloaded("qr-code.svg"), "utf8"), /<svg/);
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "qr-mobile.png"),
    fullPage: true,
  });
  await fill('input[type="url"]', "not-a-url");
  await page.waitForSelector("#qr-error");
  assert.equal(
    await page.$eval(".download-actions button", (element) => element.disabled),
    true,
  );
  await click("Text");
  await fill("textarea", "Hello 🌎!\nA private little message.");
  assert.equal(await decodeQr(), "Hello 🌎!\nA private little message.");
  await fill("textarea", "x".repeat(3000));
  await page.waitForSelector("#qr-error");
  assert.match(
    await page.$eval("#qr-error", (element) => element.textContent),
    /too long/,
  );
  await click("Wi-Fi");
  await fill('input[placeholder="Your Wi-Fi network"]', "Cafe;Guest");
  await fill('input[type="password"]', "secret:pass");
  assert.equal(
    await decodeQr(),
    "WIFI:T:WPA;S:Cafe\\;Guest;P:secret\\:pass;H:false;;",
  );
  await click("Email");
  await fill('input[type="email"]', "hello@example.com");
  await fill('input[placeholder="Say hello"]', "Hello & goodbye");
  await wait(
    () => !document.querySelector(".download-actions button").disabled,
  );
  assert.equal(
    await decodeQr(),
    "mailto:hello@example.com?subject=Hello%20%26%20goodbye&body=",
  );
  await page.setViewport({ width: 1440, height: 1000 });
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "qr-desktop.png"),
    fullPage: true,
  });

  await page.goto(`${baseUrl}/tools/text`, { waitUntil: "networkidle0" });
  await fill("textarea", " hello   WORLD \n\n another line ");
  assert.equal(
    await page.$eval(".stats-grid strong", (element) => element.textContent),
    "4",
  );
  await click("Clean up spaces");
  assert.equal(
    await page.$eval("textarea", (element) => element.value),
    "hello WORLD\n\nanother line",
  );
  await click("Title Case");
  assert.equal(
    await page.$eval("textarea", (element) => element.value),
    "Hello World\n\nAnother Line",
  );
  await click("Download .txt");
  assert.equal(
    await readFile(await downloaded("text.txt"), "utf8"),
    "Hello World\n\nAnother Line",
  );
  await browser
    .defaultBrowserContext()
    .overridePermissions(baseUrl, [
      "clipboard-read",
      "clipboard-sanitized-write",
    ]);
  await click("Copy text");
  await wait(() =>
    document.querySelector('[role="status"]').textContent.includes("Copied"),
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "Hello World\n\nAnother Line",
  );
  await page.setViewport({ width: 375, height: 812 });
  await noOverflow();

  await page.goto(`${baseUrl}/tools/json`, { waitUntil: "networkidle0" });
  await click("Load example");
  await click("Format JSON");
  assert.ok(
    await page.$eval("textarea[readonly]", (element) =>
      element.value.includes('\n  "hello"'),
    ),
  );
  await click("Minify");
  assert.equal(
    await page.$eval("textarea[readonly]", (element) =>
      element.value.includes("\n"),
    ),
    false,
  );
  await click("Download .json");
  assert.equal(
    JSON.parse(await readFile(await downloaded("formatted.json"), "utf8"))
      .local,
    true,
  );
  await fill("textarea:not([readonly])", '{"broken":}');
  await click("Format JSON");
  await page.waitForSelector("#json-error");
  assert.equal(
    await page.$eval("textarea[readonly]", (element) => element.value),
    "",
  );
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "json-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    requests.some((url) => /\.wasm(?:\?|$)/.test(url)),
    false,
    "Non-converter tools should not load conversion engines",
  );
  assert.deepEqual(
    errors,
    [],
    "Toolkit pages should have no uncaught browser errors",
  );
  console.log(
    "PASS: homepage search, categories, mobile layouts, QR decoding (all modes), PNG/SVG downloads, validation, text transformations, clipboard, JSON formatting, and downloads.",
  );

  await page.goto(`${baseUrl}/tools/convert`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".category-tile", { timeout: 60000 });
  assert.equal(
    await page.$eval("h1", (element) => element.textContent),
    "File converter",
  );
  const upload = await page.$('input[type="file"]');
  await upload.uploadFile(await downloaded("qr-code.png"));
  await page.waitForSelector(".category-chip", { timeout: 30000 });
  const outputSearch = await page.$('input[placeholder*="Search"]');
  assert.ok(outputSearch, "Converter should advance to output selection");
  await fill('input[placeholder="Search output formats..."]', "image/jpeg");
  await page.waitForSelector(".format-card");
  await page.locator(".format-card").click();
  await click("Convert Now");
  await page.waitForSelector(".results-title", { timeout: 60000 });
  assert.match(
    await page.$eval(".results-title", (element) => element.textContent),
    /Complete/,
  );
  assert.ok(
    await page.$(".results-list img"),
    "Converted JPEG should display an image preview",
  );
  await noOverflow();
  await page.screenshot({
    path: path.join(artifacts, "converter-mobile.png"),
    fullPage: true,
  });
  console.log(
    `PASS: converter loads its format cache and converts the generated PNG to JPEG. Artifacts: ${artifacts}`,
  );
} finally {
  await browser.close();
}
