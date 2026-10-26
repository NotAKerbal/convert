export type ToolIconName = "convert" | "qr" | "text" | "json";
export type ToolCategory = "Files" | "Create" | "Text & code";

// Add a tool here and create its route to include it in the directory and navigation.
export const tools = [
  {
    slug: "convert",
    href: "/tools/convert",
    name: "File converter",
    description:
      "A different format. A whole new possibility. Convert images, audio, video, documents, and more.",
    category: "Files",
    icon: "convert",
    accent: "amber",
    keywords:
      "image png jpg jpeg webp pdf document audio video mp3 mp4 zip file conversion",
    detail: "Images, audio, video & more",
  },
  {
    slug: "qr-code",
    href: "/tools/qr-code",
    name: "QR code generator",
    description:
      "Turn a link, a little text, or your Wi-Fi details into something worth scanning.",
    category: "Create",
    icon: "qr",
    accent: "mint",
    keywords: "qr code generator url link wifi wi-fi email scan png svg",
    detail: "Custom colors · PNG & SVG",
  },
  {
    slug: "text",
    href: "/tools/text",
    name: "Text tools",
    description:
      "Count words, change case, and give messy text a quick clean-up.",
    category: "Text & code",
    icon: "text",
    accent: "lavender",
    keywords:
      "word character count uppercase lowercase title case whitespace text",
    detail: "Count, transform & tidy up",
  },
  {
    slug: "json",
    href: "/tools/json",
    name: "JSON formatter",
    description:
      "Make your JSON easier to read. Validate, format, or minify in a click.",
    category: "Text & code",
    icon: "json",
    accent: "blue",
    keywords:
      "json format formatter validate minify pretty print developer code",
    detail: "Format, validate & minify",
  },
] as const satisfies readonly {
  slug: string;
  href: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon: ToolIconName;
  accent: string;
  keywords: string;
  detail: string;
}[];
