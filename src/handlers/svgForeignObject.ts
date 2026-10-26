import type { FileData, FileFormat, FormatHandler } from "../FormatHandler.ts";

class svgForeignObjectHandler implements FormatHandler {

  public name: string = "svgForeignObject";

  public supportedFormats: FileFormat[] = [
    {
      name: "Hypertext Markup Language",
      format: "html",
      extension: "html",
      mime: "text/html",
      from: true,
      to: false,
      internal: "html"
    },
    {
      name: "Scalable Vector Graphics",
      format: "svg",
      extension: "svg",
      mime: "image/svg+xml",
      from: false,
      to: true,
      internal: "svg"
    }
  ];

  public ready: boolean = true;

  async init () {
    this.ready = true;
  }

  static mediaTimeout = 5000;

  static async normalizeHTML (html: string) {
    // To get the size of the input document, we need the
    // browser to actually render it.
    // Create a hidden "dummy" element on the DOM.
    const dummy = document.createElement("div");
    dummy.style.all = "initial";
    dummy.style.visibility = "hidden";
    dummy.style.position = "fixed";
    document.body.appendChild(dummy);

    // Add a DOM shadow to the dummy to "sterilize" it.
    const shadow = dummy.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ":host>div{display:flow-root;}";
    shadow.appendChild(style);

    // Create a div within the shadow DOM to act as
    // a container for our HTML payload.
    const container = document.createElement("div");
    container.innerHTML = html;
    shadow.appendChild(container);

    // Wait for all images to finish loading. This is required for layout
    // changes, not because we actually care about the image contents.
    // Media that never fires an event (no src, lazy-loaded, preload="none",
    // or a failing <source> child whose error doesn't bubble) must not hang
    // the conversion, so each wait is capped.
    const media = Array.from(container.querySelectorAll("img, video")) as (HTMLImageElement | HTMLVideoElement)[];
    const promises = media.map(element => new Promise(resolve => {
      if (element instanceof HTMLImageElement) {
        element.loading = "eager";
        if (element.complete) return resolve(null);
      } else if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        return resolve(null);
      }
      element.addEventListener("load", resolve);
      element.addEventListener("loadeddata", resolve);
      element.addEventListener("error", resolve, true);
      setTimeout(resolve, svgForeignObjectHandler.mediaTimeout);
    }));
    await Promise.all(promises);

    // Make sure the browser has had time to render.
    // This is probably redundant due to the async calls above.
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(resolve);
      });
    });

    // Finally, get the bounding box of the input and serialize it to XML.
    const rect = container.getBoundingClientRect();
    const bbox = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    const serializer = new XMLSerializer();
    const xml = serializer.serializeToString(container);

    container.remove();
    dummy.remove();

    return { xml, bbox };
  }

  async doConvert (
    inputFiles: FileData[],
    inputFormat: FileFormat,
    outputFormat: FileFormat
  ): Promise<FileData[]> {

    if (inputFormat.internal !== "html") throw "Invalid input format.";
    if (outputFormat.internal !== "svg") throw "Invalid output format.";

    const outputFiles: FileData[] = [];

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    for (const inputFile of inputFiles) {
      const { name, bytes } = inputFile;
      const html = decoder.decode(bytes);
      const { xml, bbox } = await svgForeignObjectHandler.normalizeHTML(html);
      const svg = (
        `<svg width="${bbox.width}" height="${bbox.height}" xmlns="http://www.w3.org/2000/svg">
        <foreignObject x="0" y="0" width="${bbox.width}" height="${bbox.height}">
        ${xml}
        </foreignObject>
        </svg>`);
      const outputBytes = encoder.encode(svg);
      const newName = (name.endsWith(".html") ? name.slice(0, -5) : name) + ".svg";
      outputFiles.push({ name: newName, bytes: outputBytes });
    }

    return outputFiles;

  }

}

export default svgForeignObjectHandler;
