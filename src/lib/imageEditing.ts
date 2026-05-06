import type { OutputFile } from "./conversionEngine.ts";

export type CropAspectRatio = "free" | "1:1" | "4:3" | "16:9" | "3:4";
export type CropResizeHandle = "nw" | "ne" | "sw" | "se";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type RgbaColor = [number, number, number, number];

const ASPECT_RATIOS: Record<Exclude<CropAspectRatio, "free">, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "3:4": 3 / 4,
};

function roundRect(rect: CropRect): CropRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function clampCropRect(rect: CropRect, image: ImageSize): CropRect {
  const x = Math.max(0, Math.min(Math.round(rect.x), Math.max(0, image.width - 1)));
  const y = Math.max(0, Math.min(Math.round(rect.y), Math.max(0, image.height - 1)));
  const width = Math.max(1, Math.min(Math.round(rect.width), image.width - x));
  const height = Math.max(1, Math.min(Math.round(rect.height), image.height - y));
  return { x, y, width, height };
}

export function resizeCropWithAspectRatio(
  _current: CropRect,
  anchor: Point,
  pointer: Point,
  aspectRatio: CropAspectRatio,
  image: ImageSize
): CropRect {
  const rawWidth = pointer.x - anchor.x;
  const rawHeight = pointer.y - anchor.y;
  const directionX = rawWidth < 0 ? -1 : 1;
  const directionY = rawHeight < 0 ? -1 : 1;

  let width = Math.abs(rawWidth);
  let height = Math.abs(rawHeight);

  if (aspectRatio !== "free") {
    const ratio = ASPECT_RATIOS[aspectRatio];
    const pointerRatio = height === 0 ? Number.POSITIVE_INFINITY : width / height;
    if (pointerRatio > ratio) {
      width = height * ratio;
    } else {
      height = width / ratio;
    }
  }

  const x = directionX < 0 ? anchor.x - width : anchor.x;
  const y = directionY < 0 ? anchor.y - height : anchor.y;
  return clampCropRect(roundRect({ x, y, width, height }), image);
}

export function moveCropRect(rect: CropRect, delta: Point, image: ImageSize): CropRect {
  const x = Math.max(0, Math.min(Math.round(rect.x + delta.x), image.width - rect.width));
  const y = Math.max(0, Math.min(Math.round(rect.y + delta.y), image.height - rect.height));
  return { ...rect, x, y };
}

export function resizeCropRectFromHandle(
  rect: CropRect,
  handle: CropResizeHandle,
  pointer: Point,
  aspectRatio: CropAspectRatio,
  image: ImageSize
): CropRect {
  const anchor = {
    x: handle.includes("w") ? rect.x + rect.width : rect.x,
    y: handle.includes("n") ? rect.y + rect.height : rect.y,
  };
  return resizeCropWithAspectRatio(rect, anchor, pointer, aspectRatio, image);
}

export function getPixelColor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): RgbaColor {
  const safeX = Math.max(0, Math.min(Math.round(x), width - 1));
  const safeY = Math.max(0, Math.min(Math.round(y), height - 1));
  const offset = (safeY * width + safeX) * 4;
  return [
    pixels[offset] ?? 0,
    pixels[offset + 1] ?? 0,
    pixels[offset + 2] ?? 0,
    pixels[offset + 3] ?? 255,
  ];
}

function colorDistance(a: RgbaColor, b: RgbaColor): number {
  const red = a[0] - b[0];
  const green = a[1] - b[1];
  const blue = a[2] - b[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

export function removeBackgroundPixels(
  pixels: Uint8ClampedArray,
  targetColor: RgbaColor,
  tolerance: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(pixels);
  for (let offset = 0; offset < output.length; offset += 4) {
    const color: RgbaColor = [
      output[offset] ?? 0,
      output[offset + 1] ?? 0,
      output[offset + 2] ?? 0,
      output[offset + 3] ?? 255,
    ];
    if (colorDistance(color, targetColor) <= tolerance) {
      output[offset + 3] = 0;
    }
  }
  return output;
}

export function removeConnectedBackgroundPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  seeds: Point[],
  tolerance: number
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(pixels);
  const visited = new Uint8Array(width * height);
  const queue: Array<{ point: Point; color: RgbaColor }> = [];

  for (const seed of seeds) {
    const x = Math.max(0, Math.min(Math.round(seed.x), width - 1));
    const y = Math.max(0, Math.min(Math.round(seed.y), height - 1));
    queue.push({ point: { x, y }, color: getPixelColor(pixels, width, height, x, y) });
  }

  for (let i = 0; i < queue.length; i++) {
    const { point, color: seedColor } = queue[i];
    const x = Math.round(point.x);
    const y = Math.round(point.y);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) continue;
    visited[pixelIndex] = 1;

    const offset = pixelIndex * 4;
    const color: RgbaColor = [
      output[offset] ?? 0,
      output[offset + 1] ?? 0,
      output[offset + 2] ?? 0,
      output[offset + 3] ?? 255,
    ];
    if (colorDistance(color, seedColor) > tolerance) continue;

    output[offset + 3] = 0;
    queue.push(
      { point: { x: x + 1, y }, color: seedColor },
      { point: { x: x - 1, y }, color: seedColor },
      { point: { x, y: y + 1 }, color: seedColor },
      { point: { x, y: y - 1 }, color: seedColor }
    );
  }

  return output;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not render edited image."));
    }, mime);
  });
}

function replaceExtension(name: string, extension: string) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}.${extension}`;
  return `${name.slice(0, dot)}.${extension}`;
}

export async function cropOutputImage(file: OutputFile, crop: CropRect): Promise<OutputFile> {
  const image = await loadImage(file.url);
  const rect = clampCropRect(crop, { width: image.naturalWidth, height: image.naturalHeight });
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas editing is unavailable.");

  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height
  );

  const blob = await canvasToBlob(canvas, file.mime);
  const bytes = await blobToBytes(blob);
  return {
    name: file.name,
    bytes,
    url: URL.createObjectURL(blob),
    mime: blob.type || file.mime,
    size: bytes.byteLength,
  };
}

export async function getImageColorAt(file: OutputFile, point: Point): Promise<RgbaColor> {
  const image = await loadImage(file.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas editing is unavailable.");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return getPixelColor(data.data, data.width, data.height, point.x, point.y);
}

export async function removeBackgroundFromOutputImage(
  file: OutputFile,
  seeds: Point[],
  tolerance: number
): Promise<OutputFile> {
  const image = await loadImage(file.url);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas editing is unavailable.");
  ctx.drawImage(image, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const edited = removeConnectedBackgroundPixels(data.data, data.width, data.height, seeds, tolerance);
  data.data.set(edited);
  ctx.putImageData(data, 0, 0);

  const blob = await canvasToBlob(canvas, "image/png");
  const bytes = await blobToBytes(blob);
  return {
    name: replaceExtension(file.name, "png"),
    bytes,
    url: URL.createObjectURL(blob),
    mime: "image/png",
    size: bytes.byteLength,
  };
}
