import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./toolkit.css";
import "./themes.css";
import { SiteHeader } from "../src/components/SiteHeader";

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0a09" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Convert to it! — Your everyday toolkit",
    template: "%s | Convert to it!",
  },
  description:
    "Convert files, create QR codes, work with text, and format JSON. Useful everyday tools that run right in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
