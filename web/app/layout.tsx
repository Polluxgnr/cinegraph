import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import Nav from "@/components/Nav";
import SWRegister from "@/components/SWRegister";
import "./globals.css";

const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: { default: "CineGraph", template: "%s · CineGraph" },
  description: "Your personal film and series recommender",
  applicationName: "CineGraph",
  appleWebApp: { capable: true, title: "CineGraph", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
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
        <main className="relative z-10 mx-auto max-w-6xl px-4 pb-28 pt-4 md:pb-12 md:pt-20">{children}</main>
        <SWRegister />
      </body>
    </html>
  );
}
