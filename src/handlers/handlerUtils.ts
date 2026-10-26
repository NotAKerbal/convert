/**
 * Small helpers shared by several handlers. Kept free of DOM access at module
 * scope so the pure functions can be unit-tested under Node.
 */

/** Removes the last extension of a file name, keeping other dots in the base name. */
export function stripExtension (name: string): string {
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  const base = dot > slash + 1 ? name.slice(0, dot) : name;
  return base || "output";
}

/** Replaces (or appends) the extension of a file name. */
export function replaceExtension (name: string, extension: string): string {
  return `${stripExtension(name)}.${extension}`;
}

/** Base64-encodes bytes without spreading huge arrays into a single call. */
export function bytesToBase64 (bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * Encodes a canvas to the given MIME type. Browsers silently fall back to PNG
 * for types they can't encode (e.g. WebP in Safari), so the result type is
 * checked to avoid returning PNG bytes labelled as another format.
 */
export function canvasToBytes (
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject("Canvas output failed.");
      if (blob.type && blob.type !== mime) {
        return reject(`This browser cannot encode ${mime} (got ${blob.type}).`);
      }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject);
    }, mime, quality);
  });
}

/** Formats that cannot store transparency and need a solid background. */
export function mimeLacksAlpha (mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/bmp";
}

/**
 * Loads image bytes into an HTMLImageElement. Object URLs are always revoked,
 * including when decoding fails.
 */
export async function loadImage (bytes: Uint8Array, mime: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve());
      image.addEventListener("error", () => reject(`Failed to decode ${mime} image.`));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
