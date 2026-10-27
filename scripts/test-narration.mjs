import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";

// End-to-end check of image/text narration in a real browser, with real OCR
// and the real Kokoro voice model (downloaded from Hugging Face on first use).
// Run against a built app: npm start -- --port 3100, then npm run test:narration.
// The first run downloads the voice model (~92 MB on CPU) into a fresh profile.

const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";
const artifacts = await mkdtemp(path.join(os.tmpdir(), "narration-check-"));
const profile = await mkdtemp(path.join(os.tmpdir(), "narration-profile-"));
const NARRATION_TIMEOUT = Number(process.env.NARRATION_TIMEOUT_MS || 20 * 60 * 1000);

const IMAGE_LINES = [
  "Hello from the local narration test.",
  "The quick brown fox jumps over the lazy dog.",
  "Reading this aloud happens in your browser.",
];
const TEXT_FIXTURE = [
  "Chapter one. The lighthouse keeper woke before dawn, as she had every day for thirty years.",
  "She climbed the spiral stairs, polished the great lens, and watched the grey sea turn silver. "
    + "Ships passed in the distance, their horns low and patient. Nobody visited anymore, "
    + "but she did not mind the quiet; it gave her time to read, to write letters she never sent, "
    + "and to listen to the gulls arguing over the harbour.",
  "One morning a small boat drifted toward the rocks. Its sail was torn and its oars were missing. "
    + "She ran down to the shore, waded into the cold water, and pulled it safely onto the sand. "
    + "Inside, wrapped in a blanket, was a basket of letters addressed to her, every one of them answered.",
].join("\n\n");

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  userDataDir: profile,
  // Narration waits can outlast Puppeteer's default 180 s protocol timeout.
  protocolTimeout: NARRATION_TIMEOUT + 60000,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const wordsOf = (text) => text.toLowerCase().match(/[a-z']+/g) ?? [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1000 });
  const errors = [];
  const requests = [];
  const consoleLines = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => consoleLines.push(message.text()));
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  const session = await page.createCDPSession();
  await session.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: artifacts });
  // Model files, ONNX Runtime, and Tesseract are fetched from web workers,
  // whose requests only show up on each worker's own session.
  page.on("workercreated", async (worker) => {
    requests.push({ url: worker.url(), method: "GET" });
    worker.client.on("Network.requestWillBeSent", ({ request }) =>
      requests.push({ url: request.url, method: request.method, worker: true }));
    await worker.client.send("Network.enable").catch(() => {});
  });

  const fill = async (selector, value) => {
    const field = await page.waitForSelector(selector);
    await field.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value);
  };
  async function downloaded(name) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const files = await readdir(artifacts);
      if (files.includes(name)) return path.join(artifacts, name);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Missing download: ${name}`);
  }
  const lazyRequests = () => requests.filter(({ url }) =>
    /huggingface\.co|hf\.co|\/wasm\/tesseract\/|\/wasm\/ort\/|kokoro/.test(url));

  // Generate fixtures with the browser's own text rendering.
  await page.goto(`${baseUrl}/tools/convert`, { waitUntil: "networkidle0" });
  const makePng = (lines) => page.evaluate((lines) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 80 + lines.length * 70;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.font = "44px Arial, Helvetica, sans-serif";
    lines.forEach((line, i) => ctx.fillText(line, 50, 90 + i * 70));
    return canvas.toDataURL("image/png").split(",")[1];
  }, lines);
  const imagePath = path.join(artifacts, "narration-fixture.png");
  await writeFile(imagePath, Buffer.from(await makePng(IMAGE_LINES), "base64"));
  const blankPath = path.join(artifacts, "no-text.png");
  await writeFile(blankPath, Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 600, 400);
    gradient.addColorStop(0, "#9cc3e6");
    gradient.addColorStop(1, "#f4d5a6");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 600, 400);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64"));
  const textPath = path.join(artifacts, "story.txt");
  await writeFile(textPath, TEXT_FIXTURE);
  const emptyPath = path.join(artifacts, "empty.txt");
  await writeFile(emptyPath, "  \n\n  ");

  // Lazy loading: after the converter has fully warmed up, nothing for OCR or
  // speech should have been fetched.
  await page.waitForFunction(() => window.formatCacheReady === true, { timeout: 120000 });
  assert.deepEqual(lazyRequests(), [], "Narration assets must not load before a narration starts");
  const cacheJson = JSON.parse(await readFile(new URL("../public/cache.json", import.meta.url), "utf8"));
  assert.deepEqual(
    await page.evaluate(() => window.supportedFormatCache.get("narration")),
    cacheJson.find(([name]) => name === "narration")?.[1],
    "public/cache.json should match the narration handler's formats"
  );
  console.log("PASS: converter warmed up without loading OCR or the voice model; static cache is current.");

  // Record every distinct progress message shown in the converter's popup.
  await page.evaluate(() => {
    window.__progress = [];
    new MutationObserver(() => {
      const text = document.querySelector(".popup")?.innerText.trim();
      if (text && window.__progress.at(-1) !== text) window.__progress.push(text);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  async function convert(file, outputSearch, formatName) {
    const upload = await page.$('input[type="file"]');
    await upload.uploadFile(file);
    await page.waitForSelector('input[placeholder="Search output formats..."]', { timeout: 30000 });
    await fill('input[placeholder="Search output formats..."]', outputSearch);
    // Several formats can share a MIME type (MP3 and MP2), so pick by name.
    const card = await page.waitForFunction((name) => [...document.querySelectorAll(".format-card")]
      .find((card) => card.querySelector(".name")?.textContent === name), {}, formatName);
    await card.asElement().click();
    const started = Date.now();
    await page.locator("button::-p-text(Convert Now)").click();
    await page.waitForSelector(".results-title", { timeout: NARRATION_TIMEOUT });
    return {
      seconds: (Date.now() - started) / 1000,
      title: await page.$eval(".results-title", (e) => e.textContent),
      route: await page.$eval(".results-path", (e) => e.textContent).catch(() => ""),
      failures: await page.$$eval(".failure-reason", (rows) => rows.map((r) => r.textContent)),
    };
  }
  async function restart() {
    await page.locator("button.restart-btn").click();
    await page.waitForSelector('input[type="file"]');
  }

  // Analyses decoded audio in the page: duration plus a waveform/envelope
  // summary, and renders a waveform image for the artifacts directory.
  async function analyseAudio(file) {
    const base64 = (await readFile(file)).toString("base64");
    return page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const context = new OfflineAudioContext(1, 1, 48000);
      const audio = await context.decodeAudioData(bytes.buffer);
      const data = audio.getChannelData(0);
      const frame = Math.round(audio.sampleRate * 0.02);
      const energies = [];
      let peak = 0;
      for (let i = 0; i + frame <= data.length; i += frame) {
        let sum = 0;
        for (let j = i; j < i + frame; j++) {
          sum += data[j] * data[j];
          peak = Math.max(peak, Math.abs(data[j]));
        }
        energies.push(Math.sqrt(sum / frame));
      }
      const voicedThreshold = 0.01;
      const voiced = energies.filter((e) => e > voicedThreshold);
      // Syllable-like bursts: envelope peaks at least 100 ms apart.
      let bursts = 0, lastBurst = -10;
      for (let i = 1; i < energies.length - 1; i++) {
        if (energies[i] > 0.03 && energies[i] >= energies[i - 1] && energies[i] > energies[i + 1] && i - lastBurst >= 5) {
          bursts++;
          lastBurst = i;
        }
      }
      let longestSilence = 0, run = 0;
      for (const e of energies) {
        run = e > voicedThreshold ? 0 : run + 1;
        longestSilence = Math.max(longestSilence, run);
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 300;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1600, 300);
      ctx.fillStyle = "#6d28d9";
      const step = data.length / 1600;
      for (let x = 0; x < 1600; x++) {
        let max = 0;
        for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i++) max = Math.max(max, Math.abs(data[i]));
        ctx.fillRect(x, 150 - max * 145, 1, Math.max(1, max * 290));
      }
      return {
        duration: audio.duration,
        peak,
        voicedRms: Math.sqrt(voiced.reduce((s, e) => s + e * e, 0) / Math.max(1, voiced.length)),
        voicedFraction: voiced.length / energies.length,
        bursts,
        longestSilence: longestSilence * 0.02,
        waveform: canvas.toDataURL("image/png").split(",")[1],
      };
    }, base64);
  }
  function assertSpeech(stats, wordCount, label) {
    const wordsPerMinute = wordCount / (stats.duration / 60);
    console.log(`${label}: ${stats.duration.toFixed(2)} s, ${Math.round(wordsPerMinute)} words/min, peak ${stats.peak.toFixed(2)}, `
      + `voiced ${(stats.voicedFraction * 100).toFixed(0)}%, ${stats.bursts} bursts, longest pause ${stats.longestSilence.toFixed(2)} s`);
    assert.ok(wordsPerMinute > 90 && wordsPerMinute < 260, `${label}: speaking rate ${wordsPerMinute} wpm is not speech-like`);
    assert.ok(stats.peak > 0.1 && stats.peak <= 1, `${label}: peak ${stats.peak}`);
    assert.ok(stats.voicedRms > 0.02, `${label}: voiced RMS ${stats.voicedRms}`);
    assert.ok(stats.voicedFraction > 0.4 && stats.voicedFraction < 0.98, `${label}: voiced fraction ${stats.voicedFraction}`);
    assert.ok(stats.bursts >= wordCount * 0.6, `${label}: only ${stats.bursts} syllable bursts for ${wordCount} words`);
    assert.ok(stats.longestSilence < 1.5, `${label}: ${stats.longestSilence} s of silence`);
  }
  function parseWav(buffer) {
    assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
    assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
    return {
      format: buffer.readUInt16LE(20),
      channels: buffer.readUInt16LE(22),
      sampleRate: buffer.readUInt32LE(24),
      bits: buffer.readUInt16LE(34),
      dataBytes: buffer.readUInt32LE(40),
    };
  }

  // 1. Image -> WAV: OCR, then Kokoro narration (first use downloads the model).
  const image = await convert(imagePath, "audio/wav", "WAV");
  const progress = await page.evaluate(() => window.__progress);
  await writeFile(path.join(artifacts, "progress-image.txt"), progress.join("\n---\n"));
  assert.equal(image.title, "Conversion Complete", image.failures.join("; "));
  assert.match(image.route, /png → wav/);
  assert.ok(progress.some((p) => /Reading text from the image/.test(p)), "OCR progress should be shown");
  assert.ok(progress.some((p) => /Kokoro voice model.*downloads it once from Hugging Face/s.test(p)), "First-use download should be explained");
  assert.ok(progress.some((p) => /Speaking part 1 of/.test(p)), "Narration progress should be shown");
  const ocrLine = consoleLines.find((line) => line.startsWith("[narration] OCR confidence"));
  assert.ok(ocrLine, "OCR result should be logged");
  const expectedWords = wordsOf(IMAGE_LINES.join(" "));
  const ocrWords = new Set(wordsOf(ocrLine.replace(/^\[narration\] OCR confidence \d+%:/, "")));
  const recognized = expectedWords.filter((w) => ocrWords.has(w)).length / expectedWords.length;
  console.log(`OCR: ${ocrLine}`);
  assert.ok(recognized >= 0.9, `OCR recognized only ${Math.round(recognized * 100)}% of the fixture's words`);
  const backend = consoleLines.find((line) => line.startsWith("[narration] Kokoro ready on"));
  console.log(`Backend: ${backend}`);
  assert.ok(backend, "The Kokoro backend should be logged");

  await page.locator("button.download-btn").click();
  const wavPath = await downloaded("narration-fixture.wav");
  const wav = parseWav(await readFile(wavPath));
  assert.deepEqual({ format: wav.format, channels: wav.channels, sampleRate: wav.sampleRate, bits: wav.bits },
    { format: 1, channels: 1, sampleRate: 24000, bits: 16 }, "Narration should be Kokoro's 24 kHz mono speech, not a 44.1 kHz spectrogram");
  const imageStats = await analyseAudio(wavPath);
  await writeFile(path.join(artifacts, "waveform-image.png"), Buffer.from(imageStats.waveform, "base64"));
  assert.ok(Math.abs(imageStats.duration - wav.dataBytes / 2 / 24000) < 0.05);
  assertSpeech(imageStats, expectedWords.length, "Image narration");
  // transformers.js and kokoro-js keep downloaded files in Cache Storage.
  const cachedUrls = await page.evaluate(async () => {
    const urls = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  console.log(`Cached model files: ${cachedUrls.map((url) => url.replace(/^.*resolve\/main\//, "")).join(", ")}`);
  assert.ok(cachedUrls.some((url) => /Kokoro-82M-v1\.0-ONNX\/resolve\/main\/onnx\/model.*\.onnx$/.test(url)),
    "The Kokoro model should be downloaded on first use and cached");
  assert.ok(cachedUrls.some((url) => /voices\/af_heart\.bin$/.test(url)), "The af_heart voice should be cached");
  assert.ok(lazyRequests().some(({ url }) => url.startsWith(`${baseUrl}/wasm/tesseract/`)), "Tesseract should load from this site");
  console.log(`PASS: image → WAV narrated in ${image.seconds.toFixed(1)} s (first use, including model download).`);
  await restart();

  // 2. Text -> MP3: narration, then the normal FFmpeg route; model is warm.
  await page.evaluate(() => { window.__progress = []; });
  const text = await convert(textPath, "audio/mpeg", "MP3");
  assert.equal(text.title, "Conversion Complete", text.failures.join("; "));
  assert.match(text.route, /text → wav → mp3/);
  const textProgress = await page.evaluate(() => window.__progress);
  await writeFile(path.join(artifacts, "progress-text.txt"), textProgress.join("\n---\n"));
  const parts = Math.max(...textProgress.map((p) => Number(p.match(/Speaking part \d+ of (\d+)/)?.[1] ?? 0)));
  assert.ok(parts >= 3, `Long text should be narrated in several chunks (saw ${parts})`);
  await page.locator("button.download-btn").click();
  const mp3Path = await downloaded("story.mp3");
  const mp3 = await readFile(mp3Path);
  assert.ok(mp3.toString("ascii", 0, 3) === "ID3" || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), "Output should be MP3");
  const textStats = await analyseAudio(mp3Path);
  await writeFile(path.join(artifacts, "waveform-text.png"), Buffer.from(textStats.waveform, "base64"));
  assertSpeech(textStats, wordsOf(TEXT_FIXTURE).length, "Text narration (MP3)");
  console.log(`PASS: text → MP3 narrated in ${text.seconds.toFixed(1)} s across ${parts} chunks (model already loaded).`);
  await restart();

  // 3. An image without text fails clearly instead of producing a spectrogram.
  const before = requests.length;
  const blank = await convert(blankPath, "audio/wav", "WAV");
  assert.equal(blank.title, "Conversion Failed");
  assert.match(blank.failures.join(" "), /No readable text was found in this image/);
  assert.equal(await page.$("audio"), null);
  assert.ok(!consoleLines.some((line) => /meyda/.test(line)), "meyda should not run");
  console.log(`PASS: textless image fails with: ${blank.failures[0]}`);
  await restart();

  // 4. An empty text file fails clearly too.
  const empty = await convert(emptyPath, "audio/wav", "WAV");
  assert.equal(empty.title, "Conversion Failed");
  assert.match(empty.failures.join(" "), /There is no text to read aloud/);
  console.log(`PASS: empty text fails with: ${empty.failures[0]}`);
  assert.ok(requests.length >= before);

  // Privacy: nothing is uploaded and nothing comes from script CDNs.
  const thirdParty = [...new Set(requests.map(({ url }) => new URL(url).host))]
    .filter((host) => host && host !== new URL(baseUrl).host);
  console.log(`Third-party hosts contacted: ${thirdParty.join(", ") || "none"}`);
  assert.ok(thirdParty.every((host) => /(^|\.)huggingface\.co$|(^|\.)hf\.co$/.test(host)), "Only the model hub should be contacted");
  assert.deepEqual(requests.filter(({ method }) => !["GET", "HEAD", "OPTIONS"].includes(method)), [], "Nothing should be uploaded");
  assert.deepEqual(errors, [], "No uncaught page errors");
  await page.screenshot({ path: path.join(artifacts, "narration-final.png"), fullPage: true });
  console.log(`PASS: narration end-to-end. Artifacts: ${artifacts}`);
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true });
}
