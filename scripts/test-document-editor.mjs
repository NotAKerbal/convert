import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";
const artifacts = await mkdtemp(path.join(os.tmpdir(), "document-editor-check-"));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(request.url()));
  await page.setViewport({ width: 1440, height: 1100 });
  const session = await page.createCDPSession();
  await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: artifacts });
  const click = (label) => page.locator(`button[aria-label="${label}"]`).click();
  const clickText = (text) => page.locator(`button::-p-text(${text})`).click();
  const wait = (fn, ...args) => page.waitForFunction(fn, { timeout: 15000 }, ...args);
  async function selectBody() {
    await page.focus(".document-content");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
  }
  async function fill(selector, value) {
    await page.focus(selector);
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.sendCharacter(value);
  }
  async function download(name) {
    await wait(() => document.querySelector(".tool-message").textContent.includes("Downloaded"));
    for (let i = 0; i < 50; i++) {
      if ((await readdir(artifacts)).includes(name)) return readFile(path.join(artifacts, name), "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Missing download: ${name}`);
  }
  const bodyText = () => page.$eval(".document-content", (element) => element.innerText);
  const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await fill('input[aria-label="Search tools"]', "document");
  await page.locator('a.tool-card[href="/tools/document"]').click();
  await wait(() => document.querySelector(".document-content")?.isContentEditable);
  await fill(".document-name input", "Field notes");
  await page.focus(".document-content");
  await page.keyboard.type("A small document");
  await selectBody();
  await click("Bold");
  await wait(() => document.querySelector(".document-content b, .document-content strong"));
  assert.equal(await page.$eval('button[aria-label="Bold"]', (button) => button.getAttribute("aria-pressed")), "true");
  await click("Undo");
  assert.equal(await page.$(".document-content b, .document-content strong"), null);
  await click("Redo");
  await wait(() => document.querySelector(".document-content b, .document-content strong"));
  await selectBody();
  await page.select('select[aria-label="Paragraph style"]', "h1");
  await wait(() => document.querySelector(".document-content h1"));
  await selectBody();
  await click("Italic");
  await click("Underline");
  assert.ok(await page.$(".document-content i, .document-content em"));
  assert.ok(await page.$(".document-content u"));
  assert.match(await page.$eval(".document-status", (element) => element.textContent), /3 words/);
  await wait(() => document.querySelector(".document-status").textContent.includes("Draft saved"));
  await page.reload({ waitUntil: "networkidle0" });
  assert.equal(await page.$eval(".document-name input", (input) => input.value), "Field notes");
  assert.equal(await bodyText(), "A small document");
  assert.ok(await page.$(".document-content h1"));
  assert.ok(await page.$(".document-content b, .document-content strong"));
  await clickText("Download .html");
  const html = await download("Field notes.html");
  assert.match(html, /<title>Field notes<\/title>/);
  assert.match(html, /<h1>/);
  await clickText("Download .txt");
  assert.equal(await download("Field notes.txt"), "A small document");

  // Leave the route before the debounce fires: unmount must still keep edits.
  await fill(".document-name input", "Latest title");
  await page.locator("a.back-to-tools").click();
  await page.locator('a.tool-card[href="/tools/document"]').click();
  await wait(() => document.querySelector(".document-name input")?.value === "Latest title");

  page.once("dialog", (dialog) => dialog.dismiss());
  await clickText("New document");
  assert.equal(await bodyText(), "A small document");
  page.once("dialog", (dialog) => dialog.accept());
  await clickText("New document");
  assert.equal(await bodyText(), "");
  await page.focus(".document-content");
  await click("Bullet list");
  await page.keyboard.type("First item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second item");
  assert.equal(await page.$$eval(".document-content ul li", (items) => items.length), 2);
  await selectBody();
  await click("Numbered list");
  assert.equal(await page.$$eval(".document-content ol li", (items) => items.length), 2);

  // The file remains inert even when it contains active content and fetch URLs.
  const hostileFile = path.join(artifacts, "Imported.html");
  await writeFile(hostileFile, `<!doctype html><html><head><title>Hidden title</title><style>body{display:none}</style></head><body><h2 onclick="window.editorAttack=1">Imported heading</h2><p>Safe <strong>formatting</strong><img src="https://example.invalid/editor-tracker" onerror="window.editorAttack=2"></p><script>window.editorAttack=3</script><a href="javascript:alert(1)">link text</a><iframe src="https://example.invalid/frame"></iframe><svg onload="window.editorAttack=4"></svg></body></html>`);
  page.once("dialog", (dialog) => dialog.accept());
  await (await page.$('input[type="file"]')).uploadFile(hostileFile);
  await wait(() => document.querySelector(".document-content h2")?.textContent === "Imported heading");
  assert.ok(await page.$(".document-content strong"));
  assert.equal(await page.$(".document-content script, .document-content img, .document-content iframe, .document-content a, .document-content svg, .document-content style"), null);
  assert.equal(await page.$$eval(".document-content *", (elements) => elements.some((element) => element.attributes.length)), false);
  assert.equal(await page.evaluate(() => window.editorAttack), undefined);
  assert.equal(requests.some((url) => url.includes("example.invalid")), false);

  const plainFile = path.join(artifacts, "Plain.txt");
  await writeFile(plainFile, "Hello <script>literal text</script>\nSecond line");
  page.once("dialog", (dialog) => dialog.accept());
  await (await page.$('input[type="file"]')).uploadFile(plainFile);
  await wait(() => document.querySelector(".document-name input").value === "Plain");
  assert.match(await bodyText(), /Hello <script>literal text<\/script>/);
  assert.equal(await page.$(".document-content script"), null);
  // Paste strips rich markup while preserving literal text and undo history.
  await selectBody();
  await page.evaluate(() => {
    // Paste immediately after changing the selection, before selectionchange
    // can refresh a toolbar's saved range.
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".document-content"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Pasted words");
    clipboardData.setData("text/html", '<img src="https://example.invalid/paste"><b>Pasted words</b>');
    document.querySelector(".document-content").dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await bodyText(), "Pasted words");
  assert.equal(await page.$(".document-content img"), null);
  await click("Undo");
  assert.match(await bodyText(), /literal text/);

  const unsupportedFile = path.join(artifacts, "Unsupported.docx");
  await writeFile(unsupportedFile, "not a supported format");
  await (await page.$('input[type="file"]')).uploadFile(unsupportedFile);
  await wait(() => document.querySelector(".tool-message").textContent.includes("aren’t supported"));
  assert.match(await bodyText(), /literal text/);

  // Print uses the document only and neutral paper colors in both themes.
  await page.evaluate(() => { window.print = () => { window.editorPrinted = true; }; });
  await clickText("Print / PDF");
  assert.equal(await page.evaluate(() => window.editorPrinted), true);
  await page.emulateMediaType("print");
  assert.equal(await page.$eval(".site-header", (element) => getComputedStyle(element).display), "none");
  assert.equal(await page.$eval(".document-toolbar", (element) => getComputedStyle(element).display), "none");
  assert.equal(await page.$eval(".document-content", (element) => getComputedStyle(element).color), "rgb(0, 0, 0)");
  await page.pdf({ path: path.join(artifacts, "document-print.pdf"), format: "A4" });
  await page.emulateMediaType("screen");
  for (const theme of ["light", "dark"]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    for (const width of [1440, 375]) {
      await page.setViewport({ width, height: 1000 });
      await noOverflow();
      await page.screenshot({ path: path.join(artifacts, `document-${theme}-${width}.png`), fullPage: true });
    }
  }

  const unavailable = await browser.newPage();
  unavailable.on("dialog", (dialog) => dialog.accept());
  await unavailable.evaluateOnNewDocument(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage unavailable", "QuotaExceededError"); };
  });
  await unavailable.goto(`${baseUrl}/tools/document`, { waitUntil: "networkidle0" });
  await unavailable.waitForFunction(() => document.querySelector(".document-status").textContent.includes("Autosave unavailable"));
  await unavailable.focus(".document-content");
  await unavailable.keyboard.type("Still editable");
  assert.match(await unavailable.$eval(".document-content", (element) => element.innerText), /Still editable/);
  await unavailable.close();
  assert.deepEqual(errors, []);
  assert.equal(requests.some((url) => /\.wasm(?:\?|$)/.test(url)), false);
  console.log(`PASS: formatting, undo/redo, lists, draft recovery and navigation, replacement confirmation, HTML/TXT downloads and imports, safe paste, print/PDF, storage failures, light/dark mobile layouts. Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}
