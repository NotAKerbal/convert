import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convert to it! - Modern UI",
  description: "Modern Next.js UI for a local-first universal file converter."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
