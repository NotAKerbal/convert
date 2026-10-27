export const DOCUMENT_DRAFT_KEY = "convert-to-it.document.v1";

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function textToDocumentHtml(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`).join("");
}

// Rebuild a small, attribute-free HTML vocabulary. The inert template prevents
// imported scripts, styles, media, and resource URLs from reaching the page.
export function sanitizeDocumentHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set([
    "P", "DIV", "BR", "H1", "H2", "H3", "BLOCKQUOTE", "UL", "OL", "LI",
    "B", "STRONG", "I", "EM", "U", "S", "STRIKE",
  ]);
  const discard = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE",
    "HEAD", "TITLE", "LINK", "META", "IMG", "AUDIO", "VIDEO", "SOURCE", "NOSCRIPT",
  ]);
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
    if (!(node instanceof Element) || discard.has(node.tagName)) return "";
    const children = Array.from(node.childNodes, clean).join("");
    if (!allowed.has(node.tagName)) return children;
    const tag = node.tagName.toLowerCase();
    return tag === "br" ? "<br>" : `<${tag}>${children}</${tag}>`;
  };
  return Array.from(template.content.childNodes, clean).join("");
}

export function documentFilename(title: string) {
  return title.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "").slice(0, 120) || "Untitled document";
}

export function exportDocumentHtml(title: string, html: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title.trim() || "Untitled document")}</title>
<style>body{max-width:760px;margin:48px auto;padding:0 24px;color:#222;font:17px/1.7 system-ui,sans-serif;overflow-wrap:anywhere;white-space:pre-wrap}p,ul,ol,blockquote{margin:0 0 1em}li{margin:.25em 0}blockquote{border-left:3px solid #bbb;padding-left:1em;color:#555}h1,h2,h3{line-height:1.25}@media print{body{margin:0;max-width:none}}</style>
</head><body>${sanitizeDocumentHtml(html)}</body></html>`;
}
