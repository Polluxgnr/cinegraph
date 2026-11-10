import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import AppShell from "@/components/AppShell";
import Nav from "@/components/Nav";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "CineGraph", template: "%s · CineGraph" },
  description: "A personal taste engine: films, series, documentaries, music, food, travel, cars and style.",
  applicationName: "CineGraph",
  manifest: `${BASE}/manifest.webmanifest`,
  appleWebApp: { capable: true, title: "CineGraph", statusBarStyle: "black-translucent" },
  icons: { icon: `${BASE}/icons/icon-192.png`, apple: `${BASE}/icons/apple-touch-icon.png` },
};

export const viewport: Viewport = {
  themeColor: "#0c0b0f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh antialiased">
        <Nav />
        <main className="relative z-10 px-4 pb-28 pt-4 md:ml-64 md:px-8 md:pb-12 md:pt-20"><div className="mx-auto max-w-6xl">{children}</div></main>
        <AppShell />
      </body>
    </html>
  );
}
