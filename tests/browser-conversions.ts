import handlers from "../src/handlers/index.ts";
import { buildFormatLists, pickInputByFile, runConversion, revokeOutputFiles, supportedFormatCache } from "../src/lib/conversionEngine.ts";
import type { FileData, FileFormat, FormatHandler } from "../src/FormatHandler.ts";
import JSZip from "jszip";
import * as NBT from "nbtify";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { NtExecutable } from "pe-library";

interface Check { name: string; status: "Passed" | "Failed"; detail?: string }
declare global { interface Window { runConversionAudit: (filter?: string) => Promise<Check[]> } }
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

window.runConversionAudit = async (filter) => {
  const results: Check[] = [];
  async function check(name: string, action: () => Promise<void>) {
    if (filter && !name.startsWith("Initialize ") && !new RegExp(filter, "i").test(name)) return;
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([action(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out after 45 seconds")), 45000);
      })]);
      results.push({ name, status: "Passed" });
    } catch (err) { results.push({ name, status: "Failed", detail: String(err) }); }
    finally { clearTimeout(timer!); }
    console.log("AUDIT " + JSON.stringify(results.at(-1)));
  }
  for (const handler of handlers) await check(`Initialize ${handler.name}`, async () => {
    await handler.init();
    assert(handler.ready, "Handler did not become ready");
    assert(handler.supportedFormats?.length, "No supported formats");
    supportedFormatCache.set(handler.name, handler.supportedFormats);
  });
  window.printSupportedFormatCache = () => JSON.stringify([...supportedFormatCache]);
  function get(name: string) { const h = handlers.find((h) => h.name === name); assert(h, `Missing handler ${name}`); return h; }
  function format(h: FormatHandler, id: string, direction: "from" | "to") {
    const f = h.supportedFormats?.find((f) => f[direction] && (f.internal === id || f.format === id));
    assert(f, `${h.name} does not advertise ${direction} ${id}`); return f;
  }
  async function direct(name: string, source: string, target: string, files: FileData[]): Promise<FileData[]> {
    const h = get(name);
    const input = h.supportAnyInput ? { name: source, format: source, extension: source, mime: "application/octet-stream", from: true, to: false, internal: source } : format(h, source, "from");
    const result = await h.doConvert(files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })), input, format(h, target, "to"));
    assert(result.length, "No output files");
    assert(result.every((f) => f.name && f.bytes instanceof Uint8Array), "Invalid output files");
    return result;
  }
  async function image(bytes: Uint8Array, mime: string) {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    assert(bitmap.width > 0 && bitmap.height > 0, "Invalid image dimensions");
    bitmap.close();
  }
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 16;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#cc6633"; ctx.fillRect(0, 0, 16, 16);
  const pngBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  const png: FileData = { name: "sample.image.png", bytes: new Uint8Array(await pngBlob.arrayBuffer()) };
  const txt = { name: "sample.text.txt", bytes: encode("Hello conversion audit 😀") };
  const wavBytes = new Uint8Array(44 + 4410 * 2); const wavView = new DataView(wavBytes.buffer);
  wavBytes.set(encode("RIFF")); wavView.setUint32(4, wavBytes.length - 8, true); wavBytes.set(encode("WAVEfmt "), 8);
  wavView.setUint32(16, 16, true); wavView.setUint16(20, 1, true); wavView.setUint16(22, 1, true);
  wavView.setUint32(24, 44100, true); wavView.setUint32(28, 88200, true); wavView.setUint16(32, 2, true); wavView.setUint16(34, 16, true);
  wavBytes.set(encode("data"), 36); wavView.setUint32(40, wavBytes.length - 44, true);
  for (let i = 0; i < 4410; i++) wavView.setInt16(44 + i * 2, Math.sin(i * 440 * Math.PI * 2 / 44100) * 10000, true);
  const wav = { name: "sample.audio.wav", bytes: wavBytes };

  for (const target of ["jpeg", "webp", "text"]) await check(`canvas PNG → ${target}`, async () => {
    const [out] = await direct("canvasToBlob", "png", target, [png]);
    if (target !== "text") await image(out.bytes, `image/${target}`); else assert(out.bytes.length, "Empty ASCII art");
  });
  await check("canvas TXT → PNG", async () => { await image((await direct("canvasToBlob", "text", "png", [txt]))[0].bytes, "image/png"); });
  for (const target of ["png", "jpeg", "webp", "gif", "bmp", "tiff", "ico", "avif", "pdf"]) await check(`ImageMagick PNG → ${target}`, async () => {
    const [out] = await direct("ImageMagick", "PNG", target.toUpperCase(), [png]);
    assert(out.bytes.length > 8, "Missing encoded image");
    if (["png", "jpeg", "webp", "gif", "bmp", "avif", "ico"].includes(target)) await image(out.bytes, `image/${target}`);
    if (["tiff", "qoi"].includes(target)) await image((await direct("ImageMagick", target.toUpperCase(), "PNG", [out]))[0].bytes, "image/png");
    if (target === "pdf") assert(decode(out.bytes.subarray(0, 5)) === "%PDF-", "Invalid PDF");
  });
  const commonImages = new Set(["png", "jpeg", "webp", "gif", "bmp", "tiff", "ico", "avif", "pdf"]);
  for (const target of get("ImageMagick").supportedFormats!.filter((f) => f.to && !commonImages.has(f.format))) {
    await check(`ImageMagick PNG → ${target.format}`, async () => {
      const [out] = await direct("ImageMagick", "PNG", target.internal, [png]);
      assert(out.bytes.length > 0, "Empty image output");
      if (target.from) {
        const [back] = await direct("ImageMagick", target.internal, "PNG", [out]);
        await image(back.bytes, "image/png");
      }
    });
  }

  // A real, text-bearing two-page PDF, with byte-accurate xref offsets.
  const stream = "BT /F1 16 Tf 20 80 Td (Hello PDF audit) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 180 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 180 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"];
  let pdfText = "%PDF-1.4\n"; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(pdfText.length); pdfText += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdfText.length; pdfText += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdfText += offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  pdfText += `trailer << /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdf = { name: "sample.document.pdf", bytes: encode(pdfText) };
  for (const target of ["png", "jpeg"]) await check(`PDF → ${target} (all pages)`, async () => {
    const out = await direct("pdftoimg", "pdf", target, [pdf]); assert(out.length === 2, "Lost a PDF page");
    for (const f of out) await image(f.bytes, `image/${target}`);
  });
  await check("PDF → embedded TXT", async () => {
    const [out] = await direct("pdftotext", "pdf", "text", [pdf]);
    assert(decode(out.bytes).match(/Hello PDF audit/g)?.length === 2, "Missing PDF text");
    assert(pdf.bytes.length === encode(pdfText).length, "Detached input PDF");
  });
  await check("PDF → JPEG through routing and ZIP download", async () => {
    const options = buildFormatLists(true).allOptions;
    const input = options.find((o) => o.handler.name === "pdftoimg" && o.format.internal === "pdf")!;
    const target = options.find((o) => o.handler.name === "pdftoimg" && o.format.internal === "jpeg")!;
    const result = await runConversion({ selectedFiles: [new File([pdf.bytes as BlobPart], pdf.name, { type: "application/pdf" })], inputOption: input, outputOption: target, simpleMode: true, allOptions: options });
    try {
      assert(result.files[0].mime === "application/zip", "Multipage output not bundled");
      const zip = await JSZip.loadAsync(result.files[0].bytes); assert(Object.keys(zip.files).length === 2, "ZIP missing page");
    } finally { revokeOutputFiles(result.files); }
  });

  const markdown = { name: "sample.document.md", bytes: encode("# Conversion audit\n\nHello **world**.\n") };
  await check("DOCX → self-contained HTML preserves embedded images", async () => {
    let raw = ""; for (const b of png.bytes) raw += String.fromCharCode(b);
    const html = { name: "with-image.html", bytes: encode(`<h1>Image audit</h1><img src="data:image/png;base64,${btoa(raw)}">`) };
    const [docx] = await direct("pandoc", "html", "docx", [html]);
    const [back] = await direct("pandoc", "docx", "html", [docx]);
    assert(/src="data:image\/png;base64,/.test(decode(back.bytes)), "Embedded DOCX image was lost");
  });
  for (const target of ["html", "plain", "docx", "odt", "epub", "rtf", "latex", "rst", "gfm", "pptx"]) await check(`Pandoc Markdown → ${target}`, async () => {
    const [out] = await direct("pandoc", "markdown", target, [markdown]); assert(out.bytes.length > 5, "Empty document");
    if (target === "rtf") assert(decode(out.bytes).startsWith("{\\rtf"), "Missing standalone RTF header");
    if (target === "latex") assert(decode(out.bytes).includes("\\documentclass"), "Missing standalone LaTeX preamble");
    if (["docx", "odt", "epub", "pptx"].includes(target)) assert(Object.keys((await JSZip.loadAsync(out.bytes)).files).length > 1, "Invalid document archive");
    if (["docx", "odt", "epub", "rtf", "html"].includes(target)) {
      const [back] = await direct("pandoc", target, "plain", [out]);
      assert(decode(back.bytes).includes("Conversion audit") && decode(back.bytes).includes("world"), "Lost document text");
    }
  });
  const commonDocuments = new Set(["html", "plain", "docx", "odt", "epub", "rtf", "latex", "rst", "gfm", "pptx"]);
  for (const target of get("pandoc").supportedFormats!.filter((f) => f.to && !commonDocuments.has(f.format))) {
    await check(`Pandoc Markdown → ${target.format}`, async () => { await direct("pandoc", "markdown", target.internal, [markdown]); });
  }

  const csv = { name: "sample.data.csv", bytes: encode('name,note\nAlice,"one,two"\nBob,"line 1\nline 2"') };
  await check("CSV → JSON preserves final row, commas and multiline fields", async () => {
    const [out] = await direct("tojson", "csv", "json", [csv]); const obj = JSON.parse(decode(out.bytes));
    assert(obj.length === 2 && obj[0].note === "one,two" && obj[1].note === "line 1\nline 2", "CSV data lost");
  });
  const json = { name: "sample.data.json", bytes: encode(JSON.stringify([{ name: "Alice", note: "one,two" }, { name: "Bob", note: "line 1\nline 2" }])) };
  await check("CSV → generic JSON routes to data conversion rather than a document AST", async () => {
    const { allOptions, inputIndices, outputIndices } = buildFormatLists(true);
    const inputOption = allOptions[inputIndices.find((i) => allOptions[i].format.format === "csv")!]!;
    const outputOption = allOptions[outputIndices.find((i) => allOptions[i].format.format === "json")!]!;
    const result = await runConversion({ selectedFiles: [new File([csv.bytes as BlobPart], csv.name, { type: "text/csv" })], inputOption, outputOption, allOptions, simpleMode: true });
    try { const rows = JSON.parse(decode(result.files[0].bytes)); assert(Array.isArray(rows) && rows.length === 2, "Returned an AST instead of data rows"); }
    finally { revokeOutputFiles(result.files); }
  });
  for (const target of ["csv", "yaml", "xml"]) await check(`JSON → ${target} → JSON`, async () => {
    const [out] = await direct("fromjson", "json", target, [json]);
    const [back] = await direct("tojson", target, "json", [out]); const obj = JSON.parse(decode(back.bytes));
    if (target !== "xml") assert(JSON.stringify(obj) === decode(json.bytes), "Data did not roundtrip");
    else assert(obj && !decode(back.bytes).includes("parsererror"), "Invalid XML");
  });
  await check("XML → JSON → XML preserves attributes, namespaces and mixed text", async () => {
    const source = { name: "mixed.xml", bytes: encode('<x:root xmlns:x="urn:audit" id="7">Hello <x:b>world</x:b> &amp; friends<![CDATA[ <raw> ]]></x:root>') };
    const [json] = await direct("tojson", "xml", "json", [source]);
    const [out] = await direct("fromjson", "json", "xml", [json]);
    const doc = new DOMParser().parseFromString(decode(out.bytes), "application/xml");
    assert(!doc.querySelector("parsererror"), "Invalid roundtrip XML");
    assert(doc.documentElement.namespaceURI === "urn:audit" && doc.documentElement.getAttribute("id") === "7", "XML attributes or namespace lost");
    assert(doc.documentElement.textContent === "Hello world & friends <raw> ", "XML mixed text lost whitespace or CDATA");
  });
  const encoding = get("TextEncoding");
  for (const target of encoding.supportedFormats!.filter((f) => f.to && f.internal !== "text/utf8")) await check(`UTF-8 → ${target.format} → UTF-8`, async () => {
    const [out] = await direct("TextEncoding", "text/utf8", target.internal, [txt]);
    // UTF-8 BOM variants are output-only, so use the generic UTF-8 reader.
    const source = target.from ? target.internal : "text/utf8";
    const [back] = await direct("TextEncoding", source, "text/utf8", [out]);
    assert(decode(back.bytes) === decode(txt.bytes), "Unicode text did not roundtrip");
  });

  for (const target of ["mp3", "mp2", "flac", "ogg", "adts"]) await check(`FFmpeg WAV → ${target} → WAV`, async () => {
    const [out] = await direct("FFmpeg", "wav", target, [wav]); assert(out.bytes.length > 20, "Missing audio");
    // MP2 and AAC can be recognized by the generic MPEG/AAC readers.
    if (format(get("FFmpeg"), target, "to").from) {
      const [back] = await direct("FFmpeg", target, "wav", [out]); assert(decode(back.bytes.subarray(0, 4)) === "RIFF", "Invalid WAV output");
    }
  });
  await check("FFmpeg MP3 → MP2 through same-MIME routing", async () => {
    const [mp3] = await direct("FFmpeg", "wav", "mp3", [wav]); const options = buildFormatLists(true).allOptions;
    const h = get("FFmpeg");
    const inputOption = options.find((o) => o.handler === h && o.format.internal === "mp3")!;
    const outputOption = options.find((o) => o.handler === h && o.format.internal === "mp2")!;
    const result = await runConversion({ selectedFiles: [new File([mp3.bytes as BlobPart], "audio.mp3")], inputOption, outputOption, allOptions: options, simpleMode: true });
    try { assert(result.files[0].name.endsWith(".mp2") && result.files[0].size > 0, "MP3 was passed through unchanged"); }
    finally { revokeOutputFiles(result.files); }
  });
  await check("FFmpeg PNG → MP4 → MP3 fails without an audio stream", async () => {
    const [out] = await direct("FFmpeg", "apng", "mp4", [png]); assert(out.bytes.length > 20, "Missing MP4 video");
    let rejected = false;
    try { await direct("FFmpeg", "mp4", "mp3", [out]); } catch { rejected = true; }
    assert(rejected, "Silently accepted missing audio stream");
  });
  await check("FFmpeg SRT → WebVTT subtitles", async () => {
    const srt = { name: "captions.srt", bytes: encode("1\n00:00:00,000 --> 00:00:01,000\nHello subtitles\n") };
    const [vtt] = await direct("FFmpeg", "srt", "webvtt", [srt]);
    assert(decode(vtt.bytes).startsWith("WEBVTT") && decode(vtt.bytes).includes("Hello subtitles"), "Invalid WebVTT");
  });
  await check("FFmpeg video with audio → MP3 extraction", async () => {
    const [video] = await direct("FFmpeg", "wav", "mp4", [wav]);
    const [mp3] = await direct("FFmpeg", "mp4", "mp3", [video]);
    const audio = new AudioContext();
    try { const decoded = await audio.decodeAudioData(new Uint8Array(mp3.bytes).buffer); assert(decoded.duration > 0, "Empty extracted audio"); }
    finally { await audio.close(); }
  });
  for (const [container, extension, mime] of [["webm", "webm", "video/webm"], ["ogg", "ogg", "audio/ogg"], ["ogg", "oga", "audio/ogg"], ["opus", "opus", "audio/ogg"]]) {
    await check(`${extension.toUpperCase()} auto-detection → WAV preserves audio without a spectrogram bridge`, async () => {
      const [encoded] = await direct("FFmpeg", "wav", container, [wav]);
      const lists = buildFormatLists(true); const file = new File([encoded.bytes as BlobPart], `audio.${extension}`, { type: mime });
      const inputOption = pickInputByFile(file, lists.allOptions, lists.inputIndices); assert(inputOption, "Container not auto-detected");
      const outputOption = lists.allOptions.find((o) => o.handler.name === "FFmpeg" && o.format.internal === "wav" && o.format.to)!;
      const result = await runConversion({ selectedFiles: [file], inputOption, outputOption, allOptions: lists.allOptions, simpleMode: true });
      try {
        assert(result.path.length === 2 && result.path[1].handler.name === "FFmpeg", "Audio was converted through an image");
        const audio = new AudioContext();
        try { const decoded = await audio.decodeAudioData(new Uint8Array(result.files[0].bytes).buffer); assert(decoded.duration > 0.05 && decoded.duration < 0.5, "Audio duration was corrupted"); }
        finally { await audio.close(); }
      } finally { revokeOutputFiles(result.files); }
    });
  }

  await check("WAV → FLO → WAV", async () => {
    const [out] = await direct("floHandler", "wav", "flo", [wav]); assert(out.bytes.length, "Empty FLO");
    const [back] = await direct("floHandler", "flo", "wav", [out]); assert(decode(back.bytes.subarray(0, 4)) === "RIFF", "Invalid WAV");
  });
  await check("WAV → raw Float32 → WAV", async () => {
    const [pcm] = await direct("floHandler", "wav", "f32le", [wav]);
    assert(decode(pcm.bytes.subarray(0, 4)) !== "RIFF", "WAV bytes were mislabeled as raw audio");
    const [back] = await direct("floHandler", "f32le", "wav", [pcm]); assert(decode(back.bytes.subarray(0, 4)) === "RIFF", "Invalid WAV");
  });
  await check("ZIP accepts arbitrary input and preserves contents", async () => {
    const [out] = await direct("jszip", "zip", "zip", [txt]);
    const zip = await JSZip.loadAsync(out.bytes); assert(await zip.file(txt.name)!.async("string") === decode(txt.bytes), "ZIP contents changed");
  });
  await check("Image → HTML → SVG", async () => {
    const [html] = await direct("htmlEmbed", "png", "html", [png]);
    const [svg] = await direct("svgForeignObject", "html", "svg", [html]);
    assert(decode(svg.bytes).includes("foreignObject"), "Missing embedded document");
    await image((await direct("canvasToBlob", "svg", "png", [svg]))[0].bytes, "image/png");
  });
  await check("PNG → traced SVG", async () => {
    const [svg] = await direct("svgTrace", "png", "svg", [png]); assert(decode(svg.bytes).includes("<svg"), "Invalid traced SVG");
  });
  await check("SVG → Python turtle drawing", async () => {
    const svg = { name: "drawing.svg", bytes: encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0 L16 16" stroke="black"/></svg>') };
    const [py] = await direct("pyturtle", "svg", "py", [svg]); assert(decode(py.bytes).includes("turtle"), "Invalid turtle script");
  });
  await check("WAV → spectrum PNG", async () => {
    const [out] = await direct("meyda", "wav", "png", [wav]); await image(out.bytes, "image/png");
  });
  const snbt = { name: "sample.world.snbt", bytes: encode('{name:"audit",ticks:123L,values:[I;1,2,3]}') };
  await check("SNBT → NBT → SNBT and JSON (64-bit tags)", async () => {
    const [nbt] = await direct("nbt", "snbt", "nbt", [snbt]);
    const [back] = await direct("nbt", "nbt", "snbt", [nbt]); assert(decode(back.bytes).includes("audit"), "NBT lost data");
    const [json] = await direct("nbt", "nbt", "json", [nbt]); assert(JSON.parse(decode(json.bytes)).name === "audit", "Invalid NBT JSON");
  });
  await check("Minecraft map → RGB → PNG", async () => {
    const map = await NBT.write<NBT.CompoundTag>({ data: { colors: new Int8Array(128 * 128).fill(18) } }, { compression: "gzip" });
    const [rgb] = await direct("mcMap", "mcmap", "rgb", [{ name: "map.dat", bytes: map }]);
    assert(rgb.bytes.length === 128 * 128 * 3, "Invalid RGB byte count");
    await image((await direct("ImageMagick", "RGB", "PNG", [rgb]))[0].bytes, "image/png");
  });
  await check("SQLite → quoted CSV with spaces in table names", async () => {
    const db = { name: "sample.db", bytes: new Uint8Array(await (await fetch("/sample.db")).arrayBuffer()) };
    const [out] = await direct("sqlite3", "sqlite3", "csv", [db]);
    assert(out.name.endsWith(".csv"), "CSV output missing extension");
    const [json] = await direct("tojson", "csv", "json", [out]);
    const rows = JSON.parse(decode(json.bytes));
    assert(rows.length === 2 && rows[0].note === "one,two" && rows[1].note === "line 1\nline 2", "SQLite export lost data");
  });
  for (const target of ["png", "jpeg", "webp"]) await check(`GLB → ${target} renders translated geometry`, async () => {
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: "orange" }));
    box.position.set(100, 100, -100); scene.add(box);
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true }); assert(glb instanceof ArrayBuffer, "Invalid test GLB");
    const [out] = await direct("threejs", "glb", target, [{ name: "sample.model.glb", bytes: new Uint8Array(glb) }]);
    const bitmap = await createImageBitmap(new Blob([out.bytes as BlobPart]));
    const rendered = document.createElement("canvas"); rendered.width = bitmap.width; rendered.height = bitmap.height;
    const renderCtx = rendered.getContext("2d")!; renderCtx.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = renderCtx.getImageData(0, 0, rendered.width, rendered.height).data;
    let colored = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > pixels[i + 2] + 30 && pixels[i + 3] > 0) colored++;
    assert(colored > 100, "Model image is blank or unlit");
    box.geometry.dispose(); (box.material as THREE.Material).dispose();
  });
  for (const target of ["png", "jpeg", "webp"]) await check(`VTF → ${target}`, async () => {
    const bytes = new Uint8Array(80 + 16 * 16 * 4); const v = new DataView(bytes.buffer);
    bytes.set([0x56, 0x54, 0x46, 0]); v.setUint32(4, 7, true); v.setUint32(8, 2, true);
    v.setUint32(12, 80, true); v.setUint16(16, 16, true); v.setUint16(18, 16, true); v.setUint16(24, 1, true);
    v.setInt32(52, 0, true); bytes[56] = 1; v.setInt32(57, -1, true); v.setUint16(63, 1, true);
    for (let i = 80; i < bytes.length; i += 4) bytes.set([255, 80, 20, 255], i);
    await image((await direct("vtf", "vtf", target, [{ name: "sample.texture.vtf", bytes }]))[0].bytes, `image/${target}`);
  });
  for (const source of ["exe", "dll"]) await check(`${source.toUpperCase()} → extracted ZIP`, async () => {
    const exe = NtExecutable.createEmpty(true, source === "dll");
    const [out] = await direct("petozip", source, "zip", [{ name: `sample.${source}`, bytes: new Uint8Array(exe.generate()) }]);
    const zip = await JSZip.loadAsync(out.bytes); const metadata = JSON.parse(await zip.file("metadata.json")!.async("string"));
    assert(metadata.architecture.includes("32"), "Invalid PE metadata");
  });
  await check("FL Studio project → JSON metadata", async () => {
    const bytes = new Uint8Array(22); bytes.set(encode("FLhd")); const v = new DataView(bytes.buffer);
    v.setUint32(4, 6, true); v.setUint16(10, 1, true); v.setUint16(12, 96, true); bytes.set(encode("FLdt"), 14); v.setUint32(18, 0, true);
    const [out] = await direct("flptojson", "flp", "json", [{ name: "sample.project.flp", bytes }]);
    assert(JSON.parse(decode(out.bytes)).meta.ppq === 96, "FLP metadata lost");
  });
  return results;
};
