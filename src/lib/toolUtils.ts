export function downloadText(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  downloadUrl(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadUrl(url: string, name: string) {
  const focusedElement = document.activeElement;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  anchor.tabIndex = -1;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (focusedElement instanceof HTMLElement) {
    focusedElement.focus({ preventScroll: true });
  }
}

export type QrMode = "url" | "text" | "wifi" | "email";

export function buildQrPayload(
  mode: QrMode,
  fields: {
    url: string;
    text: string;
    ssid: string;
    password: string;
    security: string;
    hidden: boolean;
    email: string;
    subject: string;
    message: string;
  },
): { value: string; error: string } {
  if (mode === "url") {
    const value = fields.url.trim();
    if (!value) return { value: "", error: "" };
    try {
      const url = new URL(value);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      return { value, error: "" };
    } catch {
      return {
        value: "",
        error:
          "Enter a complete web address, starting with https:// or http://.",
      };
    }
  }
  if (mode === "text")
    return { value: fields.text.trim() ? fields.text : "", error: "" };
  if (mode === "wifi") {
    if (!fields.ssid.trim()) return { value: "", error: "" };
    const escape = (value: string) => value.replace(/([\\;,:\"])/g, "\\$1");
    return {
      value: `WIFI:T:${fields.security};S:${escape(fields.ssid)};P:${fields.security === "nopass" ? "" : escape(fields.password)};H:${fields.hidden};;`,
      error: "",
    };
  }
  const email = fields.email.trim();
  if (!email) return { value: "", error: "" };
  if (!/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email))
    return { value: "", error: "Enter a valid email address." };
  return {
    value: `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encodeURIComponent(fields.subject)}&body=${encodeURIComponent(fields.message)}`,
    error: "",
  };
}

export function getTextStats(text: string) {
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/u).length : 0,
    characters: Array.from(text).length,
    sentences: trimmed
      ? (trimmed.match(/[^.!?]+(?:[.!?]+|$)/gu)?.filter((part) => part.trim())
          .length ?? 0)
      : 0,
    paragraphs: trimmed ? trimmed.split(/\n\s*\n/u).length : 0,
  };
}
