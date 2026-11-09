"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BASE } from "@/lib/data";

const LINKS = [
  { href: "/", label: "Home", icon: "M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" },
  { href: "/swipe/", label: "Swipe", icon: "M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zm-3 3v10M20 7v10" },
  { href: "/discover/", label: "Discover", icon: "M12 3a9 9 0 100 18 9 9 0 000-18zm3.5 5.5l-2 5-5 2 2-5z" },
  { href: "/lists/", label: "My lists", icon: "M6 3h12v18l-6-4-6 4z" },
  { href: "/me/", label: "My taste", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0" },
];
const MORE = [
  { href: "/tonight/", label: "Tonight" },
  { href: "/sagas/", label: "Sagas" },
  { href: "/vault/", label: "Vault" },
  { href: "/graph/", label: "Graph" },
  { href: "/settings/", label: "Settings" },
];

export default function Nav() {
  const raw = usePathname();
  const path = raw.startsWith(BASE) ? raw.slice(BASE.length) || "/" : raw;
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.replace(/\/$/, "")));
  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 hidden border-b border-line/60 bg-bg/85 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link href="/" className="font-display text-2xl tracking-wide">
            Cine<span className="text-accent">Graph</span>
          </Link>
          <nav className="flex gap-1">
            {[...LINKS, ...MORE.slice(0, 4)].map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-1.5 text-sm transition ${active(l.href) ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <Link href="/settings/" className={`ml-auto text-sm ${active("/settings/") ? "text-ink" : "text-muted hover:text-ink"}`}>
            Settings
          </Link>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${active(l.href) ? "text-accent" : "text-muted"}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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

export const MORE_LINKS = MORE;
