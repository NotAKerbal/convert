"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tools } from "../lib/tools";
import { ToolIcon } from "./ToolIcon";

const navigation = [
  { slug: "convert", label: "Converter" },
  { slug: "qr-code", label: "QR generator" },
  { slug: "unit-converter", label: "Units" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="Convert to it! home">
          <span className="brand-mark">
            <ToolIcon name="grid" />
          </span>
          <span>
            convert<span className="brand-muted"> to it!</span>
            <span className="brand-dot">.</span>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Main navigation">
          <Link
            href="/"
            className={pathname === "/" ? "current" : ""}
            aria-current={pathname === "/" ? "page" : undefined}
          >
            All tools
          </Link>
          {navigation.map(({ slug, label }) => {
            const tool = tools.find((item) => item.slug === slug)!;
            return (
              <Link
                key={tool.slug}
                href={tool.href}
                className={pathname === tool.href ? "current" : ""}
                aria-current={pathname === tool.href ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <span className="local-badge">
          <span /> Made to stay local
        </span>
      </div>
    </header>
  );
}
