"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "For you", icon: "M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.3 9.2l6.1-.6z" },
  { href: "/swipe", label: "Swipe", icon: "M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zm-3 3v10M20 7v10" },
  { href: "/tonight", label: "Tonight", icon: "M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z" },
  { href: "/watchlist", label: "Watchlist", icon: "M6 3h12v18l-6-4-6 4z" },
  { href: "/graph", label: "Graph", icon: "M6 6a2 2 0 100-.01M18 8a2 2 0 100-.01M12 18a2 2 0 100-.01M7.5 7l3.5 9.5M16.5 9.5L13 16.5M8 6.3l8 1.4" },
];

export default function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 hidden border-b border-line/60 bg-bg/80 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4">
          <Link href="/" className="font-display text-2xl tracking-wide">
            Cine<span className="text-accent">Graph</span>
          </Link>
          <nav className="flex gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  active(l.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/settings"
            className={`ml-auto text-sm ${active("/settings") ? "text-ink" : "text-muted hover:text-ink"}`}
          >
            Import & settings
          </Link>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-6">
          {[...LINKS, { href: "/settings", label: "More", icon: "M5 12h.01M12 12h.01M19 12h.01" }].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${
                active(l.href) ? "text-accent" : "text-muted"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7}
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={l.icon} />
              </svg>
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
