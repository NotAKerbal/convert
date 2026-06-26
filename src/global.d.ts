import type { FileFormat } from "./FormatHandler.js";

declare global {
  interface Window {
    supportedFormatCache: Map<string, FileFormat[]>;
    printSupportedFormatCache: () => string;
    /** Set true once background warm-up has initialized every handler. */
    formatCacheReady?: boolean;
    showPopup: (html: string) => void;
    hidePopup: () => void;
  }
}

export { };
